require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'app_state.json');

app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD
    }
});

app.get('/api/data', (req, res) => {
    if (fs.existsSync(DATA_FILE)) {
        fs.readFile(DATA_FILE, 'utf8', (err, data) => {
            if (err) return res.status(500).json({ error: 'Failed to read data' });
            try {
                res.json(JSON.parse(data));
            } catch (e) {
                res.json({ changeRequests: [], issues: [], settings: {}, users: [] });
            }
        });
    } else {
        res.json({
            changeRequests: [],
            issues: [],
            settings: {},
            users: [{ username: 'admin', name: 'Administrator', email: process.env.GMAIL_USER || '', pass: 'admin1', role: 'admin' }]
        });
    }
});

app.post('/api/data', (req, res) => {
    const appState = req.body;
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFile(DATA_FILE, JSON.stringify(appState, null, 2), (err) => {
        if (err) return res.status(500).json({ error: 'Failed to save data' });
        res.json({ success: true });
    });
});

app.post('/api/notify', async (req, res) => {
    const { subject, body, to } = req.body;
    try {
        await transporter.sendMail({
            from: `"Change Control System" <${process.env.GMAIL_USER}>`,
            to: to || process.env.GMAIL_USER,
            subject: subject || 'Change Control Notification',
            html: body
        });
        res.json({ success: true });
    } catch (err) {
        console.error('Email error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/discord', async (req, res) => {
    const { message, webhookUrl } = req.body;
    if (!webhookUrl) return res.status(400).json({ error: 'No webhook URL' });
    try {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: message })
        });
        if (!response.ok) return res.status(500).json({ error: 'Discord rejected the request' });
        res.json({ success: true });
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Change Control System running at http://localhost:${PORT}`);
});
