const express = require('express');
const router = express.Router();
const axios = require('axios');
const { google } = require('googleapis');
const Anthropic = require('@anthropic-ai/sdk');
const { extractText } = require('unpdf');
const { getValidAccessToken } = require('../lib/xeroToken');
const { getTokens, getStore } = require('../lib/tokenStore');

const GMAIL_USER = 'invoicingjdcm@gmail.com';
const PROCESSED_LABEL = 'SUBIDESK_PROCESSED';

// Hardcoded fallback used when Redis has no SUBBIE_PROFILES data yet
const FALLBACK_PROFILES = {
  'paul grieveson': { cis_rate: 20, active: true },
};

async function getCisProfile(supplierName) {
  const key = (supplierName || '').toLowerCase().trim();
  const profiles = (await getStore('SUBBIE_PROFILES')) || FALLBACK_PROFILES;
  const profile = profiles[key];

  if (profile && profile.active !== false) {
    const rate = Number(profile.cis_rate);
    const flag = rate === 20 ? 'green' : rate === 30 ? 'amber' : 'blue';
    return { rate, status: 'verified', flag };
  }
  return { rate: null, status: 'unknown', flag: 'amber' };
}

// ---------------------------------------------------------------------------
// Gmail helpers
// ---------------------------------------------------------------------------
async function buildGmailClient() {
  const gmailTokens = await getTokens('GMAIL_TOKENS');
  if (!gmailTokens) throw new Error('No Gmail tokens found. Complete Gmail OAuth at /api/auth?provider=gmail first.');

  const auth = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI
  );
  auth.setCredentials(gmailTokens);
  return google.gmail({ version: 'v1', auth });
}

// Returns the label ID for SUBIDESK_PROCESSED, creating the label if absent.
async function ensureProcessedLabel(gmail) {
  const res = await gmail.users.labels.list({ userId: GMAIL_USER });
  const existing = (res.data.labels || []).find(l => l.name === PROCESSED_LABEL);
  if (existing) return existing.id;

  const created = await gmail.users.labels.create({
    userId: GMAIL_USER,
    requestBody: {
      name:                  PROCESSED_LABEL,
      labelListVisibility:   'labelShow',
      messageListVisibility: 'show',
    },
  });
  console.log(`[process] Created Gmail label "${PROCESSED_LABEL}" (${created.data.id})`);
  return created.data.id;
}

async function fetchUnreadInvoiceEmails(gmail) {
  const res = await gmail.users.messages.list({
    userId: GMAIL_USER,
    q:      `is:unread -label:${PROCESSED_LABEL}`,
    maxResults: 20,
  });
  return res.data.messages || [];
}

async function getEmailContent(gmail, messageId) {
  const res = await gmail.users.messages.get({
    userId: GMAIL_USER,
    id:     messageId,
    format: 'full',
  });

  const message = res.data;
  const headers = message.payload.headers;
  const subject = headers.find(h => h.name === 'Subject')?.value || '';
  const from    = headers.find(h => h.name === 'From')?.value    || '';

  let bodyText = '';
  const pdfAttachments = [];

  function walkParts(parts) {
    if (!parts) return;
    for (const part of parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        bodyText += Buffer.from(part.body.data, 'base64url').toString('utf8');
      }
      if (part.mimeType === 'application/pdf' && part.body?.attachmentId) {
        pdfAttachments.push({ filename: part.filename, attachmentId: part.body.attachmentId });
      }
      if (part.parts) walkParts(part.parts);
    }
  }

  if (message.payload.body?.data) {
    bodyText = Buffer.from(message.payload.body.data, 'base64url').toString('utf8');
  }
  walkParts(message.payload.parts);

  return { messageId, subject, from, bodyText, pdfAttachments, labelIds: message.labelIds || [] };
}

async function extractPdfText(gmail, messageId, attachmentId) {
  const res = await gmail.users.messages.attachments.get({
    userId: GMAIL_USER,
    messageId,
    id: attachmentId,
  });

  const buffer = Buffer.from(res.data.data, 'base64url');
  const { text } = await extractText(new Uint8Array(buffer));
  return Array.isArray(text) ? text.join(' ') : String(text);
}

// Marks a message as read and applies the SUBIDESK_PROCESSED label.
async function markProcessed(gmail, messageId, processedLabelId) {
  await gmail.users.messages.modify({
    userId: GMAIL_USER,
    id:     messageId,
    requestBody: {
      addLabelIds:    [processedLabelId],
      removeLabelIds: ['UNREAD'],
    },
  });
  console.log(`[process] ${messageId}: marked read and labelled ${PROCESSED_LABEL}.`);
}

// ---------------------------------------------------------------------------
// Claude extraction
// ---------------------------------------------------------------------------
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function extractInvoiceData(rawText, subject, from) {
  const prompt = `You are an invoice data extraction assistant for a UK construction contractor.

Extract structured invoice data from the following content and return ONLY valid JSON with this exact shape:

{
  "supplier_name": "string",
  "invoice_number": "string or null",
  "invoice_date": "YYYY-MM-DD or null",
  "due_date": "YYYY-MM-DD or null",
  "job_reference": "string — look for dash-convention format like 'Work - Job - Client', or null",
  "line_items": [
    {
      "description": "string",
      "quantity": number or null,
      "unit_price": number or null,
      "amount": number
    }
  ],
  "subtotal": number or null,
  "vat_amount": number or null,
  "total_amount": number or null,
  "currency": "GBP"
}

Rules:
- All monetary values should be numbers (not strings), in GBP
- For job references, look for patterns like "Work - Job - Client" or similar dash-separated descriptions
- If a field cannot be determined, use null
- Do not include any explanation outside the JSON

Email subject: ${subject}
Email from: ${from}

Content:
${rawText}`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = response.content[0].text.trim();
  const jsonText = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  return JSON.parse(jsonText);
}

// ---------------------------------------------------------------------------
// Xero helpers
// ---------------------------------------------------------------------------
async function getXeroTenantId(accessToken) {
  const res = await axios.get('https://api.xero.com/connections', {
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
  });
  if (!res.data || res.data.length === 0) throw new Error('No Xero organisations connected.');
  return res.data[0].tenantId;
}

function buildXeroBill(invoiceData, cisProfile) {
  const lineItems = (invoiceData.line_items || []).map(item => ({
    Description: item.description || 'Invoice line item',
    Quantity:    item.quantity   ?? 1,
    UnitAmount:  item.unit_price ?? item.amount,
    AccountCode: '429',
    TaxType:     'NONE',
  }));

  if (cisProfile.rate === 20 || cisProfile.rate === 30) {
    const labourTotal = (invoiceData.line_items || []).reduce((sum, i) => sum + (i.amount || 0), 0);
    const cisAmount   = +(labourTotal * (cisProfile.rate / 100)).toFixed(2);
    lineItems.push({
      Description: `CIS Deduction @ ${cisProfile.rate}%`,
      Quantity:    1,
      UnitAmount:  -cisAmount,
      AccountCode: '',
      TaxType:     'NONE',
    });
  }

  const bill = {
    Type:            'ACCPAY',
    Status:          'DRAFT',
    Contact:         { Name: invoiceData.supplier_name || 'Unknown Supplier' },
    LineItems:       lineItems,
    LineAmountTypes: 'NoTax',
  };

  if (invoiceData.invoice_number) bill.InvoiceNumber = invoiceData.invoice_number;
  if (invoiceData.invoice_date)   bill.Date          = invoiceData.invoice_date;
  if (invoiceData.due_date)       bill.DueDate       = invoiceData.due_date;
  if (invoiceData.job_reference)  bill.Reference     = invoiceData.job_reference;

  return bill;
}

async function postBillToXero(bill, accessToken, tenantId) {
  const res = await axios.post(
    'https://api.xero.com/api.xro/2.0/Invoices',
    { Invoices: [bill] },
    {
      headers: {
        Authorization:    `Bearer ${accessToken}`,
        'Xero-Tenant-Id': tenantId,
        'Content-Type':   'application/json',
        Accept:           'application/json',
      },
    }
  );
  return res.data.Invoices?.[0] || res.data;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------
async function handleProcess(req, res) {
  let gmail;
  try {
    gmail = await buildGmailClient();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  // Ensure the tracking label exists before we start fetching emails
  let processedLabelId;
  try {
    processedLabelId = await ensureProcessedLabel(gmail);
  } catch (err) {
    return res.status(500).json({ error: `Failed to ensure Gmail label: ${err.message}` });
  }

  let accessToken, tenantId;
  try {
    accessToken = await getValidAccessToken();
    tenantId    = await getXeroTenantId(accessToken);
    console.log(`[process] Xero tenant: ${tenantId}`);
  } catch (err) {
    return res.status(500).json({ error: `Xero auth failed: ${err.message}` });
  }

  const messages = await fetchUnreadInvoiceEmails(gmail);

  if (messages.length === 0) {
    console.log('[process] No unread emails found.');
    return res.json({ processed: 0, results: [] });
  }

  console.log(`[process] Found ${messages.length} unread email(s). Processing...`);

  const results = [];

  for (const msg of messages) {
    try {
      const email = await getEmailContent(gmail, msg.id);

      // Belt-and-braces: skip if the label somehow slipped through the query filter
      if (email.labelIds.includes(processedLabelId)) {
        console.log(`[process] ${msg.id}: already processed — skipping.`);
        results.push({ messageId: msg.id, status: 'skipped', reason: 'already_processed' });
        continue;
      }

      let rawText = email.bodyText;

      if (email.pdfAttachments.length > 0) {
        console.log(`[process] ${msg.id}: Extracting text from PDF — ${email.pdfAttachments[0].filename}`);
        rawText = await extractPdfText(gmail, msg.id, email.pdfAttachments[0].attachmentId);
      }

      if (!rawText || rawText.trim().length < 20) {
        console.warn(`[process] ${msg.id}: Insufficient text content — skipping.`);
        results.push({ messageId: msg.id, status: 'skipped', reason: 'no_content' });
        continue;
      }

      const invoiceData  = await extractInvoiceData(rawText, email.subject, email.from);
      const cisProfile   = await getCisProfile(invoiceData.supplier_name);
      const bill         = buildXeroBill(invoiceData, cisProfile);
      const xeroResponse = await postBillToXero(bill, accessToken, tenantId);

      // Mark read and label only after a confirmed successful Xero post
      await markProcessed(gmail, msg.id, processedLabelId);

      const result = {
        messageId:        msg.id,
        status:           'created',
        cis_flag:         cisProfile.flag,
        cis_rate_percent: cisProfile.rate,
        invoice:          invoiceData,
        xero_bill:        xeroResponse,
      };

      console.log('\n=== XERO BILL CREATED ===');
      console.log(JSON.stringify(result, null, 2));
      console.log('=========================\n');

      results.push(result);
    } catch (err) {
      const detail = err.response?.data || err.message;
      console.error(`[process] Error processing message ${msg.id}:`, detail);
      results.push({ messageId: msg.id, status: 'error', error: err.message, detail });
    }
  }

  res.json({ processed: results.length, results });
}

// GET /api/process — browser-friendly trigger for testing
router.get('/', handleProcess);

// POST /api/process — production trigger
router.post('/', handleProcess);

module.exports = router;
