const express = require('express');
const router = express.Router();
const axios = require('axios');
const { google } = require('googleapis');
const { getValidAccessToken } = require('../lib/xeroToken');
const { getStore, getTokens } = require('../lib/tokenStore');

// ---------------------------------------------------------------------------
// CIS quarter calculation
// CIS quarters: 6 Apr–5 Jul, 6 Jul–5 Oct, 6 Oct–5 Jan, 6 Jan–5 Apr
// ---------------------------------------------------------------------------
function getCisQuarter(date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1; // 1-based
  const d = date.getDate();

  // Determine which quarter we're in and its start/end dates
  let start, end, label;

  if ((m > 4 || (m === 4 && d >= 6)) && (m < 7 || (m === 7 && d <= 5))) {
    start = new Date(y, 3, 6);   // 6 Apr
    end   = new Date(y, 6, 5);   // 5 Jul
    label = `6 April ${y} to 5 July ${y}`;
  } else if ((m > 7 || (m === 7 && d >= 6)) && (m < 10 || (m === 10 && d <= 5))) {
    start = new Date(y, 6, 6);   // 6 Jul
    end   = new Date(y, 9, 5);   // 5 Oct
    label = `6 July ${y} to 5 October ${y}`;
  } else if ((m > 10 || (m === 10 && d >= 6)) || m === 11 || m === 12) {
    start = new Date(y, 9, 6);   // 6 Oct
    end   = new Date(y + 1, 0, 5); // 5 Jan next year
    label = `6 October ${y} to 5 January ${y + 1}`;
  } else {
    // Jan 1 – Apr 5
    start = new Date(y - 1, 9, 6); // 6 Oct prev year — this branch only for Jan–Apr5
    // Re-scope: 6 Jan – 5 Apr of current year
    start = new Date(y, 0, 6);   // 6 Jan
    end   = new Date(y, 3, 5);   // 5 Apr
    label = `6 January ${y} to 5 April ${y}`;
  }

  return {
    start,
    end,
    label,
    fromStr: start.toISOString().slice(0, 10),
    toStr:   end.toISOString().slice(0, 10),
  };
}

function fmtDate(isoStr) {
  if (!isoStr) return '—';
  // Xero dates come as /Date(timestamp)/ or ISO
  const ts = isoStr.match(/\/Date\((\d+)\)\//);
  const d = ts ? new Date(parseInt(ts[1])) : new Date(isoStr);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtGBP(n) {
  return '£' + Number(n || 0).toFixed(2);
}

// ---------------------------------------------------------------------------
// Xero helpers
// ---------------------------------------------------------------------------
async function getXeroTenantId(accessToken) {
  const res = await axios.get('https://api.xero.com/connections', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.data || res.data.length === 0) throw new Error('No Xero organisations connected.');
  return res.data[0].tenantId;
}

async function getXeroContactId(accessToken, tenantId, contactName) {
  const res = await axios.get('https://api.xero.com/api.xro/2.0/Contacts', {
    headers: { Authorization: `Bearer ${accessToken}`, 'Xero-Tenant-Id': tenantId, Accept: 'application/json' },
    params:  { SearchTerm: contactName },
  });
  const contacts = res.data.Contacts || [];
  const match = contacts.find(c => c.Name.toLowerCase() === contactName.toLowerCase());
  return match ? match.ContactID : null;
}

async function getXeroBillsForContact(accessToken, tenantId, contactId, fromStr, toStr) {
  const res = await axios.get('https://api.xero.com/api.xro/2.0/Invoices', {
    headers: {
      Authorization:    `Bearer ${accessToken}`,
      'Xero-Tenant-Id': tenantId,
      Accept:           'application/json',
    },
    params: {
      Type:       'ACCPAY',
      Statuses:   'AUTHORISED,PAID',
      ContactIDs: contactId,
      DateFrom:   fromStr,
      DateTo:     toStr,
    },
  });
  return res.data.Invoices || [];
}

// ---------------------------------------------------------------------------
// Statement data — parse invoices into display rows
// ---------------------------------------------------------------------------
function parseInvoiceRows(invoices) {
  return invoices.map(inv => {
    const lines = inv.LineItems || [];
    const gross = lines
      .filter(l => (l.UnitAmount || 0) > 0)
      .reduce((s, l) => s + (l.LineAmount || l.UnitAmount * (l.Quantity || 1)), 0);
    const cisDeducted = lines
      .filter(l => (l.UnitAmount || 0) < 0)
      .reduce((s, l) => s + Math.abs(l.LineAmount || l.UnitAmount * (l.Quantity || 1)), 0);
    const net = gross - cisDeducted;

    return {
      date:         fmtDate(inv.Date),
      invoiceNumber: inv.InvoiceNumber || inv.InvoiceID?.slice(0, 8) || '—',
      reference:    inv.Reference || '—',
      gross,
      cisDeducted,
      net,
    };
  });
}

function calcTotals(rows) {
  return rows.reduce((acc, r) => ({
    gross:       acc.gross       + r.gross,
    cisDeducted: acc.cisDeducted + r.cisDeducted,
    net:         acc.net         + r.net,
  }), { gross: 0, cisDeducted: 0, net: 0 });
}

// ---------------------------------------------------------------------------
// HTML statement generator
// ---------------------------------------------------------------------------
function renderStatement(subbie, rows, totals, quarter) {
  const invoiceRows = rows.length
    ? rows.map(r => `
        <tr>
          <td>${r.date}</td>
          <td>${r.invoiceNumber}</td>
          <td>${r.reference}</td>
          <td class="num">${fmtGBP(r.gross)}</td>
          <td class="num cis">${fmtGBP(r.cisDeducted)}</td>
          <td class="num">${fmtGBP(r.net)}</td>
        </tr>`).join('')
    : `<tr><td colspan="6" class="empty">No approved invoices found for this quarter.</td></tr>`;

  const totalsRow = rows.length ? `
    <tr class="totals-row">
      <td colspan="3"><strong>Totals</strong></td>
      <td class="num"><strong>${fmtGBP(totals.gross)}</strong></td>
      <td class="num cis"><strong>${fmtGBP(totals.cisDeducted)}</strong></td>
      <td class="num"><strong>${fmtGBP(totals.net)}</strong></td>
    </tr>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CIS Statement — ${subbie.name}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
      background: #ffffff;
      color: #1a1a1a;
      font-size: 14px;
      padding: 40px;
      max-width: 800px;
      margin: 0 auto;
    }

    /* Header */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 3px solid #c9a84c;
      padding-bottom: 20px;
      margin-bottom: 28px;
    }

    .company-name {
      font-size: 24px;
      font-weight: 800;
      color: #1a1a1a;
      letter-spacing: -0.5px;
    }

    .company-sub {
      color: #666;
      font-size: 12px;
      margin-top: 4px;
    }

    .doc-label {
      text-align: right;
    }

    .doc-label h2 {
      font-size: 18px;
      font-weight: 700;
      color: #c9a84c;
    }

    .doc-label p {
      font-size: 12px;
      color: #666;
      margin-top: 4px;
    }

    /* Subbie details */
    .details {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      background: #f8f7f4;
      border-radius: 6px;
      padding: 18px 20px;
      margin-bottom: 28px;
    }

    .detail-group label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #999;
      font-weight: 600;
      display: block;
      margin-bottom: 4px;
    }

    .detail-group p {
      font-weight: 600;
      color: #1a1a1a;
    }

    /* Table */
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 28px;
      font-size: 13px;
    }

    thead tr {
      background: #1a1a1a;
      color: #ffffff;
    }

    th {
      padding: 10px 12px;
      text-align: left;
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    th.num, td.num { text-align: right; }

    td {
      padding: 10px 12px;
      border-bottom: 1px solid #eeeeee;
    }

    tr:nth-child(even) td { background: #fafafa; }

    td.cis  { color: #c0392b; }
    th.cis  { background: #2a1a1a; }

    .totals-row td {
      background: #f0ead8 !important;
      border-top: 2px solid #c9a84c;
      border-bottom: 2px solid #c9a84c;
    }

    .empty { text-align: center; color: #999; padding: 24px; }

    /* Summary boxes */
    .summary {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
      margin-bottom: 32px;
    }

    .summary-box {
      border: 1px solid #e0e0e0;
      border-radius: 6px;
      padding: 14px 16px;
      text-align: center;
    }

    .summary-box.highlight { border-color: #c9a84c; background: #fffbf0; }

    .summary-box label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #999;
      display: block;
      margin-bottom: 6px;
    }

    .summary-box .amount {
      font-size: 20px;
      font-weight: 800;
      color: #1a1a1a;
    }

    .summary-box.highlight .amount { color: #c9a84c; }
    .summary-box .cis-amount { color: #c0392b; }

    /* Footer */
    .footer {
      border-top: 1px solid #e0e0e0;
      padding-top: 16px;
      font-size: 12px;
      color: #888;
      text-align: center;
      line-height: 1.6;
    }

    .footer strong { color: #555; }

    @media print {
      body { padding: 20px; }
    }
  </style>
</head>
<body>

  <div class="header">
    <div>
      <div class="company-name">JDCM Ltd</div>
      <div class="company-sub">JD Construction Management<br>CIS Contractor</div>
    </div>
    <div class="doc-label">
      <h2>CIS Statement</h2>
      <p>Issued: ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}</p>
    </div>
  </div>

  <div class="details">
    <div class="detail-group">
      <label>Subcontractor</label>
      <p>${subbie.name}</p>
    </div>
    <div class="detail-group">
      <label>UTR Number</label>
      <p>${subbie.utr || 'Not provided'}</p>
    </div>
    <div class="detail-group">
      <label>Company Type</label>
      <p>${subbie.company_type === 'ltd' ? 'Limited Company' : 'Sole Trader'}</p>
    </div>
    <div class="detail-group">
      <label>CIS Quarter</label>
      <p>${quarter.label}</p>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>Invoice No.</th>
        <th>Reference</th>
        <th class="num">Gross</th>
        <th class="num cis">CIS Deducted</th>
        <th class="num">Net Paid</th>
      </tr>
    </thead>
    <tbody>
      ${invoiceRows}
      ${totalsRow}
    </tbody>
  </table>

  <div class="summary">
    <div class="summary-box">
      <label>Total Gross</label>
      <div class="amount">${fmtGBP(totals.gross)}</div>
    </div>
    <div class="summary-box">
      <label>CIS Deducted</label>
      <div class="amount cis-amount">${fmtGBP(totals.cisDeducted)}</div>
    </div>
    <div class="summary-box highlight">
      <label>Net Paid</label>
      <div class="amount">${fmtGBP(totals.net)}</div>
    </div>
  </div>

  <div class="footer">
    <strong>CIS deductions have been paid to HMRC on your behalf. Keep this statement for your tax return.</strong><br>
    JDCM Ltd &bull; CIS Contractor &bull; This statement was generated automatically by SubiDesk
  </div>

</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Gmail send
// ---------------------------------------------------------------------------
async function buildGmailClient() {
  const tokens = await getTokens('GMAIL_TOKENS');
  if (!tokens) throw new Error('No Gmail tokens. Complete Gmail OAuth at /api/auth?provider=gmail first.');
  const auth = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI
  );
  auth.setCredentials(tokens);
  return google.gmail({ version: 'v1', auth });
}

function buildMimeEmail({ to, subject, htmlBody, fromName = 'JDCM Ltd' }) {
  const from = `${fromName} <invoicingjdcm@gmail.com>`;
  const mime = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    '',
    htmlBody,
  ].join('\r\n');

  return Buffer.from(mime).toString('base64url');
}

async function sendStatementEmail(gmail, subbie, html, quarter) {
  const subject = `CIS Statement — ${quarter.label}`;
  const raw = buildMimeEmail({ to: subbie.email, subject, htmlBody: html });
  await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
}

// ---------------------------------------------------------------------------
// Core logic — build statement data for one subbie
// ---------------------------------------------------------------------------
async function buildSubbieStatement(subbie, accessToken, tenantId, quarter) {
  const contactId = await getXeroContactId(accessToken, tenantId, subbie.name);
  if (!contactId) {
    return { subbie: subbie.name, status: 'skipped', reason: 'not_found_in_xero' };
  }

  const invoices = await getXeroBillsForContact(accessToken, tenantId, contactId, quarter.fromStr, quarter.toStr);
  const rows     = parseInvoiceRows(invoices);
  const totals   = calcTotals(rows);
  const html     = renderStatement(subbie, rows, totals, quarter);

  return { subbie: subbie.name, contactId, invoiceCount: rows.length, totals, html };
}

// ---------------------------------------------------------------------------
// GET /api/statements/preview/:name — browser preview, no email sent
// ---------------------------------------------------------------------------
router.get('/preview/:name', async (req, res) => {
  const name = decodeURIComponent(req.params.name).toLowerCase();
  const profiles = await getStore('SUBBIE_PROFILES');

  if (!profiles || !profiles[name]) {
    return res.status(404).send(`Subbie "${req.params.name}" not found in profiles.`);
  }

  let accessToken, tenantId;
  try {
    accessToken = await getValidAccessToken();
    tenantId    = await getXeroTenantId(accessToken);
  } catch (err) {
    return res.status(500).send(`Xero auth failed: ${err.message}`);
  }

  const quarter = getCisQuarter();

  try {
    const result = await buildSubbieStatement(profiles[name], accessToken, tenantId, quarter);
    if (result.status === 'skipped') return res.status(404).send(result.reason);
    res.setHeader('Content-Type', 'text/html');
    res.send(result.html);
  } catch (err) {
    res.status(500).send(`Error building statement: ${err.message}`);
  }
});

// ---------------------------------------------------------------------------
// GET /api/statements — send statements to all active subbies
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  const profiles = await getStore('SUBBIE_PROFILES');

  if (!profiles || Object.keys(profiles).length === 0) {
    return res.json({ sent: 0, skipped: 0, errors: 0, results: [], reason: 'No subbie profiles found.' });
  }

  const active = Object.values(profiles).filter(s => s.active !== false && s.email);

  let accessToken, tenantId, gmail;
  try {
    accessToken = await getValidAccessToken();
    tenantId    = await getXeroTenantId(accessToken);
  } catch (err) {
    return res.status(500).json({ error: `Xero auth failed: ${err.message}` });
  }

  try {
    gmail = await buildGmailClient();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  const quarter = getCisQuarter();
  console.log(`[statements] Quarter: ${quarter.label} | Subbies with email: ${active.length}`);

  const results = [];

  for (const subbie of active) {
    try {
      const data = await buildSubbieStatement(subbie, accessToken, tenantId, quarter);

      if (data.status === 'skipped') {
        console.log(`[statements] ${subbie.name}: skipped — ${data.reason}`);
        results.push({ name: subbie.name, status: 'skipped', reason: data.reason });
        continue;
      }

      await sendStatementEmail(gmail, subbie, data.html, quarter);
      console.log(`[statements] ${subbie.name}: statement sent to ${subbie.email} (${data.invoiceCount} invoices)`);

      results.push({
        name:          subbie.name,
        email:         subbie.email,
        status:        'sent',
        invoiceCount:  data.invoiceCount,
        totals:        data.totals,
      });
    } catch (err) {
      console.error(`[statements] ${subbie.name}: error — ${err.message}`);
      results.push({ name: subbie.name, status: 'error', error: err.message });
    }
  }

  const summary = {
    quarter: quarter.label,
    sent:    results.filter(r => r.status === 'sent').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    errors:  results.filter(r => r.status === 'error').length,
    results,
  };

  console.log(`[statements] Done — sent: ${summary.sent}, skipped: ${summary.skipped}, errors: ${summary.errors}`);
  res.json(summary);
});

module.exports = router;
