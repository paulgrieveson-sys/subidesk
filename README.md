# SubiDesk

AI invoice automation for UK construction contractors. Monitors a Gmail inbox for invoices, reads them with Claude, and creates/manages them in Xero — including automated payment reminders.

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js (Vercel Serverless Functions) |
| Accounting | Xero API (OAuth2) |
| Email | Gmail API (OAuth2) |
| AI | Anthropic Claude API |

## Project Structure

```
subidesk/
├── api/
│   ├── auth.js        # Initiates OAuth2 flows for Xero and Gmail
│   ├── callback.js    # Handles OAuth2 redirect callbacks, exchanges code for tokens
│   ├── process.js     # Reads invoice emails, extracts data via Claude, creates Xero invoices
│   └── remind.js      # Checks Xero for overdue invoices, sends payment reminder emails
├── .env.example       # Environment variable template
├── package.json
└── README.md
```

## Setup

1. Clone the repo and install dependencies:
   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in your credentials:
   ```bash
   cp .env.example .env
   ```

3. Create a Xero app at [developer.xero.com](https://developer.xero.com) and set the redirect URI to `/api/callback`.

4. Create a Google Cloud project, enable the Gmail API, and set the redirect URI to `/api/callback`.

5. Add your Anthropic API key from [console.anthropic.com](https://console.anthropic.com).

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/auth` | GET | Start OAuth2 login for Xero or Gmail |
| `/api/callback` | GET | OAuth2 redirect handler |
| `/api/process` | POST | Process incoming invoice emails |
| `/api/remind` | POST | Send overdue payment reminders |

## Deployment

Deploy to Vercel with:
```bash
vercel deploy
```

Set all environment variables from `.env.example` in your Vercel project settings.
