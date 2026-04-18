require('dotenv').config();
const express = require('express');

const app = express();
app.use(express.json());

app.use('/api/auth', require('./api/auth'));
app.use('/api/callback', require('./api/callback'));
app.use('/api/process', require('./api/process'));
app.use('/api/remind', require('./api/remind'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SubiDesk running on port ${PORT}`));
