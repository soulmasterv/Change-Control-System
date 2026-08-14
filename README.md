# README md Complete Version
## Change Control System
README | Changelog
A web-based change control system for tracking small-project change requests, issues, and approvals — with email and Discord notifications.
## Stack

* Backend: Node.js / Express
* Frontend: Single-page index.html (vanilla JS, no framework)
* Storage: Flat JSON file (data/app_state.json) — no database
* Email: Nodemailer via Gmail SMTP
* Chat notifications: Discord webhooks
* Process manager: PM2

## Features

* Login system with roles: admin, staff, guest, suspect, disabled
* Change requests (CR-001 format) with summary, priority, impact, device, description, rollback plan, tags, linked CR, status, author, comments, and created date
* Status flow: pending-review → in-progress → accepted → implemented / rejected
* Issues & Fixes log linked to change requests
* Bulk status changes with checkboxes
* Search by ID or title, filter by status/priority
* Notifications on new requests and status changes — per-action toggle for Email, Discord, or both
* Activity log (logins, logouts, new requests, status changes, deletes)
* Backup export/import as JSON
* URL hash routing (#dashboard, #requests, #users, #issues, #changelog, #settings, #activity)
* Session persistence across refresh via localStorage

## Setup

git clone https://github.com/Soulmasterv/Change-Control-System.git
cd Change-Control-System
npm install

Copy the example environment file and fill in your real values:

cp .env.example .env

## Environment Configuration
Edit your .env file to look exactly like this, ensuring each item is on its own line:

PORT=3000
GMAIL_USER=your-email@gmail.com
GMAIL_APP_PASSWORD=your-16-char-app-password

GMAIL_APP_PASSWORD is a Gmail App Password, not your regular account password. Generate one at myaccount.google.com/apppasswords (requires 2-Step Verification enabled).
## Running

pm2 start server.js --name change-control-system

Or for local dev without PM2:

node server.js

The app runs at http://localhost:3000 (or your configured PORT).
## Common PM2 commands

pm2 restart change-control-system
pm2 logs change-control-system --lines 20
pm2 stop change-control-system

## API Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | /api/data | Load all app data |
| POST | /api/data | Save all app data |
| POST | /api/notify | Send an email notification |
| POST | /api/discord | Relay a message to a Discord webhook |

## Data model
All data lives in data/app_state.json:

{
  "changeRequests": [],
  "issues": [],
  "users": [],
  "settings": {}
}

This file is git-ignored — it's your live, local data and never gets pushed.
## Notifications
In Settings, configure your Discord webhook URL. Each place you can trigger a notification (new CR, editing a CR, changing status) has:

* A main Send notifications checkbox (default on) that sends via both channels
* If unchecked, two sub-checkboxes appear to choose Email and/or Discord individually

## Default login
On first run (empty data/app_state.json), a default admin user is created:

* Username: admin
* Password: admin1

Change this immediately, especially before exposing the app beyond your local network.
## Security notes

* Never commit .env — it's already in .gitignore
* Rotate the Gmail app password if it's ever been shared in plaintext (chat, screenshot, committed file, etc.)
* Change the default admin password before exposing this publicly
* If exposing beyond your LAN, prefer a mechanism like Tailscale Funnel over raw port-forwarding — it gives you a public HTTPS URL without opening your router or exposing your home IP

## Known issues

* Email formatting could be improved (plain HTML strings currently)

## License
Private project — not licensed for external use.

