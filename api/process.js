const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const Anthropic = require('@anthropic-ai/sdk');

// Lazy-required at call time — pdf-parse reads test files on import which
// crashes Vercel's sandbox if required at module load.
let pdfParse;

// ---------------------------------------------------------------------------
// Subbie CIS profile — keyed by lowercase supplier name
// 20% = standard CIS deduction, 30% = higher rate, 0% = gross payment status
// ---------------------------------------------------------------------------
const CIS_PROFILES = {
  'paul grieveson': { rate: 20, status: 'verified' },
};

function getCisProfile(supplierName) {
  const key = (supplierName || '').toLowerCase().trim();
  if (CIS_PROFILES[key]) {
    return { ...CIS_PROFILES[key], flag: 'green' };
  }
  return { rate: null, status: 'unknown', flag: 'amber' };
}

// ---------------------------------------------------------------------------
// Gmail helpers
// ---------------------------------------------------------------------------
function buildGmailClient() {
  const raw = process.env.GMAIL_TOKENS;
  if (!raw) {
    throw new Error('GMAIL_TOKENS environment variable is not set. Complete Gmail OAuth and paste the logged token JSON into Vercel.');
  }

  const auth = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI
  );

  auth.setCredentials(JSON.parse(raw));
  return google.gmail({ version: 'v1', auth });
}

async function fetchUnreadInvoiceEmails(gmail) {
  const res = await gmail.users.messages.list({
    userId: 'invoicingjdcm@gmail.com',
    q: 'is:unread',
    maxResults: 20,
  });

  return res.data.messages || [];
}

async function getEmailContent(gmail, messageId) {
  const res = await gmail.users.messages.get({
    userId: 'invoicingjdcm@gmail.com',
    id: messageId,
    format: 'full',
  });

  const message = res.data;
  const headers = message.payload.headers;
  const subject = headers.find(h => h.name === 'Subject')?.value || '';
  const from = headers.find(h => h.name === 'From')?.value || '';

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

  // Handle both single-part and multipart messages
  if (message.payload.body?.data) {
    bodyText = Buffer.from(message.payload.body.data, 'base64url').toString('utf8');
  }
  walkParts(message.payload.parts);

  return { messageId, subject, from, bodyText, pdfAttachments };
}

async function extractPdfText(gmail, messageId, attachmentId) {
  const res = await gmail.users.messages.attachments.get({
    userId: 'invoicingjdcm@gmail.com',
    messageId,
    id: attachmentId,
  });

  if (!pdfParse) pdfParse = require('pdf-parse');
  const buffer = Buffer.from(res.data.data, 'base64url');
  const parsed = await pdfParse(buffer);
  return parsed.text;
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

  // Strip markdown code fences if Claude wraps the JSON
  const jsonText = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  return JSON.parse(jsonText);
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

async function handleProcess(req, res) {
  let gmail;
  try {
    gmail = buildGmailClient();
  } catch (err) {
    return res.status(500).json({ error: err.message });
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

      let rawText = email.bodyText;

      // Prefer PDF content over body text if attachments present
      if (email.pdfAttachments.length > 0) {
        console.log(`[process] ${msg.id}: Extracting text from PDF — ${email.pdfAttachments[0].filename}`);
        rawText = await extractPdfText(gmail, msg.id, email.pdfAttachments[0].attachmentId);
      }

      if (!rawText || rawText.trim().length < 20) {
        console.warn(`[process] ${msg.id}: Insufficient text content — skipping.`);
        results.push({ messageId: msg.id, status: 'skipped', reason: 'no_content' });
        continue;
      }

      const invoiceData = await extractInvoiceData(rawText, email.subject, email.from);

      const cisProfile = getCisProfile(invoiceData.supplier_name);

      const result = {
        messageId: msg.id,
        status: 'extracted',
        cis_flag: cisProfile.flag,
        cis_rate_percent: cisProfile.rate,
        invoice: invoiceData,
      };

      console.log('\n=== EXTRACTED INVOICE ===');
      console.log(JSON.stringify(result, null, 2));
      console.log('=========================\n');

      results.push(result);
    } catch (err) {
      console.error(`[process] Error processing message ${msg.id}:`, err.message);
      results.push({ messageId: msg.id, status: 'error', error: err.message });
    }
  }

  res.json({ processed: results.length, results });
}

// GET /api/process — browser-friendly trigger for testing
router.get('/', handleProcess);

// POST /api/process — production trigger
router.post('/', handleProcess);

module.exports = router;
