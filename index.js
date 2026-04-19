require('dotenv').config();
const express = require('express');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/admin', require('./api/admin'));
app.use('/api/auth', require('./api/auth'));
app.use('/api/callback', require('./api/callback'));
app.use('/callback', require('./api/callback')); // Xero may redirect to /callback
app.use('/api/process', require('./api/process'));
app.use('/api/remind', require('./api/remind'));

// Local dev: listen on a port. Vercel ignores this and uses the export below.
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`SubiDesk running on port ${PORT}`));
}

module.exports = app;
