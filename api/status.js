const express = require('express');
const router = express.Router();
const { getStore } = require('../lib/tokenStore');

function todayKey() {
  return `INVOICES_TODAY_${new Date().toISOString().slice(0, 10)}`;
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London',
  });
}

function statusDot(ok) {
  return `<span class="dot ${ok ? 'green' : 'amber'}"></span>`;
}

async function renderStatus() {
  const [subbies, todayCount, last] = await Promise.all([
    getStore('SUBBIE_PROFILES'),
    getStore(todayKey()),
    getStore('LAST_PROCESSED_INVOICE'),
  ]);

  const subbieCount  = Object.keys(subbies || {}).length;
  const invoiceCount = Number(todayCount) || 0;

  const lastBlock = last ? `
    <div class="card">
      <div class="card-label">Last Processed Invoice</div>
      <div class="last-grid">
        <div class="last-row"><span class="lk">Supplier</span><span class="lv">${last.supplier_name || '—'}</span></div>
        <div class="last-row"><span class="lk">Invoice #</span><span class="lv">${last.invoice_number || '—'}</span></div>
        <div class="last-row"><span class="lk">Amount</span><span class="lv">${last.total_amount != null ? '£' + Number(last.total_amount).toFixed(2) : '—'}</span></div>
        <div class="last-row"><span class="lk">Job Ref</span><span class="lv">${last.job_reference || '—'}</span></div>
        <div class="last-row"><span class="lk">Processed</span><span class="lv">${formatDate(last.processed_at)}</span></div>
        <div class="last-row"><span class="lk">Xero Bill</span><span class="lv">${last.xero_invoice_id || '—'}</span></div>
      </div>
    </div>` : `
    <div class="card muted-card">
      <div class="card-label">Last Processed Invoice</div>
      <p class="empty">No invoices processed yet.</p>
    </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SubiDesk — Status</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0f0f0f;
      color: #e0e0e0;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2rem;
    }

    .container { width: 100%; max-width: 560px; }

    /* Header */
    .logo { font-size: 2rem; font-weight: 800; color: #c9a84c; letter-spacing: -1px; }
    .tagline { color: #555; font-size: 0.875rem; margin-top: 0.25rem; margin-bottom: 2.5rem; }

    /* Status pill */
    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: #161616;
      border: 1px solid #2a2a2a;
      border-radius: 999px;
      padding: 0.4rem 1rem;
      font-size: 0.8rem;
      font-weight: 600;
      color: #4caf50;
      margin-bottom: 2rem;
    }

    .dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      display: inline-block;
    }
    .dot.green { background: #4caf50; box-shadow: 0 0 6px #4caf50; }
    .dot.amber { background: #c9a84c; box-shadow: 0 0 6px #c9a84c; }

    /* Stat cards row */
    .stats {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
      margin-bottom: 1rem;
    }

    .card {
      background: #161616;
      border: 1px solid #2a2a2a;
      border-radius: 10px;
      padding: 1.25rem;
    }

    .card.full { grid-column: 1 / -1; }
    .muted-card { border-color: #1a1a1a; }

    .card-label {
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #555;
      font-weight: 600;
      margin-bottom: 0.5rem;
    }

    .stat-value {
      font-size: 2.5rem;
      font-weight: 800;
      color: #c9a84c;
      line-height: 1;
    }

    .stat-sub { font-size: 0.75rem; color: #555; margin-top: 0.4rem; }

    /* Last invoice grid */
    .last-grid { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.25rem; }
    .last-row  { display: flex; justify-content: space-between; font-size: 0.85rem; }
    .lk { color: #555; }
    .lv { color: #e0e0e0; font-weight: 500; text-align: right; max-width: 65%; word-break: break-word; }

    .empty { color: #444; font-size: 0.875rem; padding: 0.5rem 0; }

    /* Links */
    .links {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
      margin-top: 1rem;
    }

    a.link-card {
      display: flex;
      align-items: center;
      justify-content: center;
      background: #161616;
      border: 1px solid #2a2a2a;
      border-radius: 10px;
      padding: 1rem;
      text-decoration: none;
      color: #c9a84c;
      font-weight: 600;
      font-size: 0.875rem;
      transition: background 0.15s, border-color 0.15s;
    }

    a.link-card:hover {
      background: #1e1e1e;
      border-color: #c9a84c;
    }

    .footer {
      margin-top: 2.5rem;
      font-size: 0.75rem;
      color: #333;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">SubiDesk</div>
    <div class="tagline">AI invoice automation for construction contractors</div>

    <div class="status-pill">
      ${statusDot(true)} System running
    </div>

    <div class="stats">
      <div class="card">
        <div class="card-label">Subbies on file</div>
        <div class="stat-value">${subbieCount}</div>
        <div class="stat-sub">registered profiles</div>
      </div>
      <div class="card">
        <div class="card-label">Invoices today</div>
        <div class="stat-value">${invoiceCount}</div>
        <div class="stat-sub">${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Europe/London' })}</div>
      </div>
      <div class="card full">
        ${lastBlock}
      </div>
    </div>

    <div class="links">
      <a class="link-card" href="/admin">Admin Dashboard</a>
      <a class="link-card" href="/api/process">Run Processing</a>
    </div>

    <div class="footer">SubiDesk &mdash; built for JD Construction Management</div>
  </div>
</body>
</html>`;
}

// GET /
router.get('/', async (req, res) => {
  const html = await renderStatus();
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

module.exports = router;
