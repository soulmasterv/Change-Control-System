# Change Control System

**[README](README.md) | [Changelog](CHANGELOG.md)**

A web-based change control system for tracking small-project change requests, issues, and approvals — with email and Discord notifications.

## Stack

- **Backend:** Node.js / Express
- **Frontend:** Single-page `index.html` (vanilla JS, no framework)
- **Storage:** Flat JSON file (`data/app_state.json`) — no database
- **Email:** Nodemailer via Gmail SMTP
- **Chat notifications:** Discord webhooks
- **Process manager:** PM2

## Features

- Login system with roles: `admin`, `staff`, `guest`, `suspect`, `disabled`
- Change requests (`CR-001` format) with summary, priority, impact, device, description, rollback plan, tags, linked CR, status, author, comments, and created date
- Status flow: `pending-review` → `in-progress` → `accepted` → `implemented` / `rejected`
- Issues & Fixes log linked to change requests
- Bulk status changes with checkboxes
- Search by ID or title, filter by status/priority
- Notifications on new requests and status changes — per-action toggle for **Email**, **Discord**, or both
- Activity log (logins, logouts, new requests, status changes, deletes)
- Backup export/import as JSON
- URL hash routing (`#dashboard`, `#requests`, `#users`, `#issues`, `#changelog`, `#settings`, `#activity`)
- Session persistence across refresh via `localStorage`

## Setup

```bash
git clone https://github.com/Soulmasterv/Change-Control-System.git
cd Change-Control-System
npm install
```

Copy the example environment file and fill in your real values:

```bash
cp .env.example .env
```

Edit `.env`:


