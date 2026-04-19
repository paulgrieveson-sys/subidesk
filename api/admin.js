const express = require('express');
const router = express.Router();
const { getStore, setStore } = require('../lib/tokenStore');

const STORE_KEY = 'SUBBIE_PROFILES';

// ---------------------------------------------------------------------------
// Subbie store helpers
// ---------------------------------------------------------------------------
async function getAllSubbies() {
  return (await getStore(STORE_KEY)) || {};
}

async function saveAllSubbies(subbies) {
  await setStore(STORE_KEY, subbies);
}

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------
function cisRateBadge(rate) {
  const n = Number(rate);
  if (n === 20) return `<span class="badge green">20%</span>`;
  if (n === 30) return `<span class="badge amber">30%</span>`;
  if (n === 0)  return `<span class="badge blue">Gross</span>`;
  return `<span class="badge">${rate}%</span>`;
}

function activeBadge(active) {
  return active
    ? `<span class="badge green">Active</span>`
    : `<span class="badge muted">Inactive</span>`;
}

function renderPage(subbies) {
  const rows = Object.values(subbies).map(s => `
    <tr>
      <td>${s.name}</td>
      <td>${s.email || '—'}</td>
      <td>${s.whatsapp || '—'}</td>
      <td>${s.utr || '—'}</td>
      <td>${s.company_type === 'ltd' ? 'Ltd' : 'Sole Trader'}</td>
      <td>${cisRateBadge(s.cis_rate)}</td>
      <td>${activeBadge(s.active)}</td>
      <td>
        <form method="POST" action="/admin/subbies/${encodeURIComponent(s.name)}/delete">
          <button type="submit" class="btn-danger">Remove</button>
        </form>
      </td>
    </tr>`).join('');

  const emptyRow = `<tr><td colspan="8" class="empty">No subbies added yet.</td></tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SubiDesk Admin</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0f0f0f;
      color: #e0e0e0;
      min-height: 100vh;
      padding: 2rem;
    }

    header {
      display: flex;
      align-items: center;
      gap: 1rem;
      margin-bottom: 2.5rem;
      border-bottom: 1px solid #2a2a2a;
      padding-bottom: 1.5rem;
    }

    header h1 {
      font-size: 1.6rem;
      font-weight: 700;
      color: #c9a84c;
      letter-spacing: -0.5px;
    }

    header span {
      font-size: 0.85rem;
      color: #666;
    }

    h2 {
      font-size: 1rem;
      font-weight: 600;
      color: #c9a84c;
      margin-bottom: 1rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    section { margin-bottom: 3rem; }

    /* Table */
    .table-wrap { overflow-x: auto; }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.875rem;
    }

    thead tr { border-bottom: 1px solid #2a2a2a; }

    th {
      text-align: left;
      padding: 0.6rem 0.75rem;
      color: #888;
      font-weight: 500;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    td {
      padding: 0.75rem;
      border-bottom: 1px solid #1a1a1a;
      vertical-align: middle;
    }

    tr:hover td { background: #161616; }

    .empty { color: #555; text-align: center; padding: 2rem; }

    /* Badges */
    .badge {
      display: inline-block;
      padding: 0.2em 0.6em;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .badge.green  { background: #1a3a1a; color: #4caf50; }
    .badge.amber  { background: #3a2a00; color: #c9a84c; }
    .badge.blue   { background: #0d2a3a; color: #4ab0e0; }
    .badge.muted  { background: #1e1e1e; color: #555; }

    /* Form */
    .card {
      background: #161616;
      border: 1px solid #2a2a2a;
      border-radius: 8px;
      padding: 1.5rem;
      max-width: 700px;
    }

    .form-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
    }

    .form-group { display: flex; flex-direction: column; gap: 0.4rem; }
    .form-group.full { grid-column: 1 / -1; }

    label { font-size: 0.8rem; color: #888; font-weight: 500; }

    input, select {
      background: #0f0f0f;
      border: 1px solid #2a2a2a;
      border-radius: 5px;
      color: #e0e0e0;
      padding: 0.5rem 0.75rem;
      font-size: 0.875rem;
      width: 100%;
      transition: border-color 0.15s;
    }

    input:focus, select:focus {
      outline: none;
      border-color: #c9a84c;
    }

    select option { background: #1a1a1a; }

    .form-actions { margin-top: 1.25rem; }

    .btn-primary {
      background: #c9a84c;
      color: #0f0f0f;
      border: none;
      border-radius: 5px;
      padding: 0.55rem 1.4rem;
      font-size: 0.875rem;
      font-weight: 700;
      cursor: pointer;
      transition: background 0.15s;
    }
    .btn-primary:hover { background: #dbbf6a; }

    .btn-danger {
      background: transparent;
      color: #c0392b;
      border: 1px solid #3a1a1a;
      border-radius: 4px;
      padding: 0.3rem 0.65rem;
      font-size: 0.75rem;
      cursor: pointer;
      transition: background 0.15s;
    }
    .btn-danger:hover { background: #2a0a0a; }

    @media (max-width: 600px) {
      .form-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header>
    <h1>SubiDesk</h1>
    <span>Admin Dashboard</span>
  </header>

  <section>
    <h2>Subcontractor Profiles</h2>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>WhatsApp</th>
            <th>UTR</th>
            <th>Type</th>
            <th>CIS Rate</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${rows || emptyRow}
        </tbody>
      </table>
    </div>
  </section>

  <section>
    <h2>Add Subcontractor</h2>
    <div class="card">
      <form method="POST" action="/admin/subbies">
        <div class="form-grid">
          <div class="form-group">
            <label for="name">Full Name *</label>
            <input type="text" id="name" name="name" required placeholder="e.g. Paul Grieveson" />
          </div>
          <div class="form-group">
            <label for="email">Email</label>
            <input type="email" id="email" name="email" placeholder="paul@example.com" />
          </div>
          <div class="form-group">
            <label for="whatsapp">WhatsApp Number</label>
            <input type="tel" id="whatsapp" name="whatsapp" placeholder="+447700900000" />
          </div>
          <div class="form-group">
            <label for="utr">UTR Number</label>
            <input type="text" id="utr" name="utr" placeholder="1234567890" />
          </div>
          <div class="form-group">
            <label for="company_type">Company Type</label>
            <select id="company_type" name="company_type">
              <option value="sole_trader">Sole Trader</option>
              <option value="ltd">Limited Company</option>
            </select>
          </div>
          <div class="form-group">
            <label for="cis_rate">CIS Rate</label>
            <select id="cis_rate" name="cis_rate">
              <option value="20">20% — Standard</option>
              <option value="30">30% — Higher</option>
              <option value="0">0% — Gross Payment Status</option>
            </select>
          </div>
          <div class="form-group">
            <label for="active">Status</label>
            <select id="active" name="active">
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </div>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn-primary">Add Subcontractor</button>
        </div>
      </form>
    </div>
  </section>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET /admin — dashboard HTML
router.get('/', async (req, res) => {
  const subbies = await getAllSubbies();
  res.setHeader('Content-Type', 'text/html');
  res.send(renderPage(subbies));
});

// GET /admin/subbies — all profiles as JSON
router.get('/subbies', async (req, res) => {
  const subbies = await getAllSubbies();
  res.json(subbies);
});

// POST /admin/subbies — add a new subbie
router.post('/subbies', async (req, res) => {
  const { name, email, whatsapp, utr, company_type, cis_rate, active } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).send('Name is required.');
  }

  const subbies = await getAllSubbies();
  const key = name.trim().toLowerCase();

  subbies[key] = {
    name:         name.trim(),
    email:        email?.trim()        || '',
    whatsapp:     whatsapp?.trim()     || '',
    utr:          utr?.trim()          || '',
    company_type: company_type         || 'sole_trader',
    cis_rate:     Number(cis_rate)     ?? 20,
    active:       active === 'true',
  };

  await saveAllSubbies(subbies);
  res.redirect('/admin');
});

// POST /admin/subbies/:name/delete — remove a subbie
router.post('/subbies/:name/delete', async (req, res) => {
  const key = decodeURIComponent(req.params.name).toLowerCase();
  const subbies = await getAllSubbies();

  delete subbies[key];
  await saveAllSubbies(subbies);
  res.redirect('/admin');
});

module.exports = router;
