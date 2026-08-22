require('dotenv').config();
const express = require('express');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'app_state.json');
const TEMP_DATA_FILE = path.join(__dirname, 'data', 'app_state.json.tmp');

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

let writeQueue = Promise.resolve();

function queued(task) {
    const run = writeQueue.then(task, task);
    writeQueue = run.catch(() => {});
    return run;
}

function defaultState() {
    return {
        changeRequests: [],
        issues: [],
        settings: {},
        users: [
            {
                username: 'admin',
                name: 'Administrator',
                email: process.env.GMAIL_USER || '',
                pass: 'admin1',
                role: 'admin'
            }
        ]
    };
}

async function readState() {
    try {
        const raw = await fsp.readFile(DATA_FILE, 'utf8');
        return JSON.parse(raw);
    } catch (e) {
        if (e.code === 'ENOENT') {
            return defaultState();
        }

        console.error('app_state.json could not be read:', e.message);

        try {
            const backupFile = `${DATA_FILE}.bak`;
            const backupRaw = await fsp.readFile(backupFile, 'utf8');
            return JSON.parse(backupRaw);
        } catch (backupError) {
            console.error('Backup app_state.json could not be read:', backupError.message);
            return defaultState();
        }
    }
}

async function writeState(state) {
    const dir = path.dirname(DATA_FILE);

    await fsp.mkdir(dir, { recursive: true });

    const json = JSON.stringify(state, null, 2);

    await fsp.writeFile(TEMP_DATA_FILE, json, 'utf8');
    await fsp.rename(TEMP_DATA_FILE, DATA_FILE);

    try {
        await fsp.writeFile(`${DATA_FILE}.bak`, json, 'utf8');
    } catch (e) {
        console.error('Could not update app_state backup:', e.message);
    }
}

const BACKUP_CHECK_INTERVAL_MS = 60 * 60 * 1000;

const BACKUP_FREQUENCIES_MS = {
    daily: 24 * 60 * 60 * 1000,
    weekly: 7 * 24 * 60 * 60 * 1000
};

async function runScheduledBackupIfDue(force = false) {
    const state = await queued(() => readState());
    const schedule = state.settings?.backupSchedule || {};

    if (!force) {
        if (!schedule.enabled) {
            return { ran: false, reason: 'disabled' };
        }

        const frequency =
            BACKUP_FREQUENCIES_MS[schedule.frequency] ||
            BACKUP_FREQUENCIES_MS.daily;

        const lastRun = schedule.lastRunAt || 0;

        if (Date.now() - lastRun < frequency) {
            return { ran: false, reason: 'not-due' };
        }
    }

    const channels = schedule.channels || {};
    const notifyEmail = state.settings?.notifyEmail;
    const discordWebhook = state.settings?.discordWebhook;

    const filename = `ccms-backup-${new Date().toISOString().split('T')[0]}.json`;

    const jsonString = JSON.stringify(
        {
            changeRequests: state.changeRequests || [],
            issues: state.issues || [],
            users: state.users || [],
            serverChanges: state.serverChanges || [],
            presetTags: state.presetTags || [],
            activityLog: state.activityLog || [],
            settings: state.settings || {},
            exportDate: new Date().toISOString()
        },
        null,
        2
    );

    let sentAny = false;

    if (channels.email && notifyEmail) {
        try {
            await transporter.sendMail({
                from: `"Change Control System" <${process.env.GMAIL_USER}>`,
                to: notifyEmail,
                subject: `Automated Backup — ${filename}`,
                html: `<p>Attached is the automated ${schedule.frequency || 'daily'} backup of your Change Control System data.</p>`,
                attachments: [
                    {
                        filename,
                        content: jsonString
                    }
                ]
            });

            sentAny = true;
        } catch (err) {
            console.error('Automated backup email failed:', err.message);
        }
    }

    if (channels.discord && discordWebhook) {
        try {
            const form = new FormData();

            form.append(
                'payload_json',
                JSON.stringify({
                    content: `🗄️ Automated ${schedule.frequency || 'daily'} backup — ${filename}`
                })
            );

            form.append(
                'file',
                new Blob([jsonString], { type: 'application/json' }),
                filename
            );

            const response = await fetch(discordWebhook, {
                method: 'POST',
                body: form
            });

            if (!response.ok) {
                throw new Error(`Discord rejected upload: ${response.status}`);
            }

            sentAny = true;
        } catch (err) {
            console.error('Automated backup Discord upload failed:', err.message);
        }
    }

    queued(async () => {
        const freshState = await readState();

        if (!freshState.settings) {
            freshState.settings = {};
        }

        if (!freshState.settings.backupSchedule) {
            freshState.settings.backupSchedule = {};
        }

        freshState.settings.backupSchedule.lastRunAt = Date.now();

        await writeState(freshState);
    });

    return {
        ran: true,
        sentAny
    };
}

setInterval(() => {
    runScheduledBackupIfDue().catch(err => {
        console.error('Backup check failed:', err.message);
    });
}, BACKUP_CHECK_INTERVAL_MS);

runScheduledBackupIfDue().catch(err => {
    console.error('Initial backup check failed:', err.message);
});

const SESSION_LEASE_MS = 15 * 1000;

app.get('/api/data', async (req, res) => {
    try {
        const state = await queued(() => readState());
        res.json(state);
    } catch (e) {
        console.error('Failed to read application data:', e.message);
        res.status(500).json({
            error: 'Failed to read data'
        });
    }
});

app.post('/api/data', (req, res) => {
    const appState = req.body;

    if (!appState || typeof appState !== 'object') {
        return res.status(400).json({
            error: 'Invalid application state'
        });
    }

    queued(() => writeState(appState))
        .then(() => {
            res.json({
                success: true
            });
        })
        .catch(err => {
            console.error('Error writing app_state.json:', err.message);

            res.status(500).json({
                error: 'Failed to save data'
            });
        });
});

app.post('/api/session/release', (req, res) => {
    const { username, sessionId } = req.body || {};

    if (!username || !sessionId) {
        return res.status(400).json({
            error: 'username and sessionId are required'
        });
    }

    queued(async () => {
        const state = await readState();
        const users = Array.isArray(state.users) ? state.users : [];

        const index = users.findIndex(
            user => user.username === username
        );

        if (index === -1) {
            return {
                status: 'not-found'
            };
        }

        const user = users[index];

        if (user.activeSessionId !== sessionId) {
            return {
                status: 'stale'
            };
        }

        users[index] = {
            ...user,
            activeSessionId: null,
            activeSessionAt: null,
            lastOnline: Date.now()
        };

        state.users = users;

        await writeState(state);

        return {
            status: 'ok'
        };
    })
        .then(result => {
            res.json(result);
        })
        .catch(err => {
            console.error('Error releasing session:', err.message);

            res.status(500).json({
                error: 'Failed to release session'
            });
        });
});

app.post('/api/session/heartbeat', (req, res) => {
    const { username, sessionId } = req.body || {};

    if (!username || !sessionId) {
        return res.status(400).json({
            error: 'username and sessionId are required'
        });
    }

    queued(async () => {
        const state = await readState();
        const users = Array.isArray(state.users) ? state.users : [];

        const index = users.findIndex(
            user => user.username === username
        );

        if (index === -1) {
            return {
                status: 'not-found'
            };
        }

        const user = users[index];

        if (user.revokedSessionId === sessionId) {
            return {
                status: 'revoked',
                reason: user.revokedReason || null
            };
        }

        const now = Date.now();

        if (
            user.activeSessionId &&
            user.activeSessionId !== sessionId &&
            user.activeSessionAt &&
            now - user.activeSessionAt < SESSION_LEASE_MS
        ) {
            return {
                status: 'other-session'
            };
        }

        users[index] = {
            ...user,
            activeSessionId: sessionId,
            activeSessionAt: now,
            lastOnline: now
        };

        state.users = users;

        await writeState(state);

        return {
            status: 'ok'
        };
    })
        .then(result => {
            res.json(result);
        })
        .catch(err => {
            console.error('Heartbeat failed:', err.message);

            res.status(500).json({
                error: 'Failed to process heartbeat'
            });
        });
});

app.post('/api/session/force-logout', (req, res) => {
    const { username, reason } = req.body || {};

    if (!username) {
        return res.status(400).json({
            error: 'username is required'
        });
    }

    queued(async () => {
        const state = await readState();
        const users = Array.isArray(state.users) ? state.users : [];

        const index = users.findIndex(
            user => user.username === username
        );

        if (index === -1) {
            return {
                status: 'not-found'
            };
        }

        const user = users[index];

        if (!user.activeSessionId) {
            return {
                status: 'already-logged-out',
                name: user.name
            };
        }

        users[index] = {
            ...user,
            revokedSessionId: user.activeSessionId,
            revokedReason:
                typeof reason === 'string' && reason.trim()
                    ? reason.trim().slice(0, 300)
                    : null,
            activeSessionId: null,
            activeSessionAt: null,
            lastOnline: Date.now()
        };

        state.users = users;

        await writeState(state);

        return {
            status: 'ok',
            name: user.name
        };
    })
        .then(result => {
            res.json(result);
        })
        .catch(err => {
            console.error('Force logout failed:', err.message);

            res.status(500).json({
                error: 'Failed to force logout'
            });
        });
});

app.post('/api/settings', (req, res) => {
    const incoming = req.body || {};

    if (
        typeof incoming !== 'object' ||
        Array.isArray(incoming)
    ) {
        return res.status(400).json({
            error: 'Invalid settings'
        });
    }

    queued(async () => {
        const state = await readState();

        state.settings = {
            ...(state.settings || {}),
            ...incoming,
            lastSavedAt: Date.now()
        };

        await writeState(state);

        return state.settings;
    })
        .then(settings => {
            res.json({
                success: true,
                settings
            });
        })
        .catch(err => {
            console.error('Error saving settings:', err.message);

            res.status(500).json({
                error: 'Failed to save settings'
            });
        });
});

app.post('/api/users/update', (req, res) => {
    const { originalUsername, user } = req.body || {};

    if (
        !originalUsername ||
        !user ||
        !user.username
    ) {
        return res.status(400).json({
            error: 'originalUsername and user are required'
        });
    }

    queued(async () => {
        const state = await readState();
        const users = Array.isArray(state.users)
            ? state.users
            : [];

        const index = users.findIndex(
            item => item.username === originalUsername
        );

        if (index === -1) {
            return {
                status: 'not-found'
            };
        }

        if (
            user.username !== originalUsername &&
            users.some(item => item.username === user.username)
        ) {
            return {
                status: 'username-taken'
            };
        }

        users[index] = {
            ...users[index],
            ...user
        };

        state.users = users;

        await writeState(state);

        return {
            status: 'ok',
            users
        };
    })
        .then(result => {
            res.json(result);
        })
        .catch(err => {
            console.error('Error updating user:', err.message);

            res.status(500).json({
                error: 'Failed to update user'
            });
        });
});

app.post('/api/staff-chat/purge', (req, res) => {
    const { username } = req.body || {};

    if (!username) {
        return res.status(400).json({
            error: 'username is required'
        });
    }

    queued(async () => {
        const state = await readState();

        const users = Array.isArray(state.users)
            ? state.users
            : [];

        const user = users.find(
            item =>
                String(item.username || '').toLowerCase() ===
                String(username || '').toLowerCase()
        );

        if (!user) {
            return {
                status: 'not-found'
            };
        }

        if (user.role !== 'admin') {
            return {
                status: 'forbidden'
            };
        }

        if (!state.settings) {
            state.settings = {};
        }

        state.settings.staffChatMessages = [];
        state.settings.staffChatPurgedAt = Date.now();
        state.settings.staffChatPurgedBy = user.username;

        await writeState(state);

        return {
            status: 'ok'
        };
    })
        .then(result => {
            if (result.status === 'not-found') {
                return res.status(404).json({
                    error: 'Admin user not found'
                });
            }

            if (result.status === 'forbidden') {
                return res.status(403).json({
                    error: 'Only administrators can purge staff chat'
                });
            }

            res.json({
                success: true
            });
        })
        .catch(err => {
            console.error('Staff chat purge failed:', err.message);

            res.status(500).json({
                error: 'Failed to purge staff chat'
            });
        });
});

app.post('/api/notify', async (req, res) => {
    const {
        subject,
        body,
        to
    } = req.body;

    try {
        await transporter.sendMail({
            from: `"Change Control System" <${process.env.GMAIL_USER}>`,
            to: to || process.env.GMAIL_USER,
            subject: subject || 'Change Control Notification',
            html: body
        });

        console.log(
            `Email sent: "${subject}" -> ${to || process.env.GMAIL_USER}`
        );

        res.json({
            success: true
        });
    } catch (err) {
        console.error('Email error:', err.message);

        res.status(500).json({
            error: err.message
        });
    }
});

app.post('/api/discord', async (req, res) => {
    const {
        message,
        embed,
        components,
        webhookUrl
    } = req.body;

    if (!webhookUrl) {
        return res.status(400).json({
            error: 'No webhook URL'
        });
    }

    if (!message && !embed) {
        return res.status(400).json({
            error: 'No message or embed provided'
        });
    }

    try {
        const payload = {};

        if (message) {
            payload.content = message;
        }

        if (embed) {
            payload.embeds = [embed];
        }

        if (Array.isArray(components) && components.length) {
            payload.components = components;
        }

        const separator = webhookUrl.includes('?')
            ? '&'
            : '?';

        const discordUrl =
            webhookUrl +
            separator +
            'wait=true&with_components=true';

        const response = await fetch(discordUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const details = await response.text().catch(() => '');

            console.error(
                `Discord webhook rejected (${response.status}):`,
                details.slice(0, 500)
            );

            return res.status(500).json({
                error: 'Discord rejected the request',
                status: response.status,
                details: details.slice(0, 500)
            });
        }

        console.log('Discord notification sent successfully.');

        res.json({
            success: true
        });
    } catch (err) {
        console.error('Discord notify error:', err.message);

        res.status(500).json({
            error: err.message
        });
    }
});

app.post('/api/backup/run-now', async (req, res) => {
    try {
        const result = await runScheduledBackupIfDue(true);

        res.json(result);
    } catch (err) {
        res.status(500).json({
            error: err.message
        });
    }
});

function buildStatusReportData(state) {
    const requests = Array.isArray(state.changeRequests)
        ? state.changeRequests
        : [];

    const issues = Array.isArray(state.issues)
        ? state.issues
        : [];

    const users = Array.isArray(state.users)
        ? state.users
        : [];

    const activityLog = Array.isArray(state.activityLog)
        ? state.activityLog
        : [];

    const serverChanges = Array.isArray(state.serverChanges)
        ? state.serverChanges
        : [];

    const counts = {
        total: requests.length,
        pending: requests.filter(
            r => r.status === 'pending-review'
        ).length,
        inProgress: requests.filter(
            r =>
                r.status === 'accepted' ||
                r.status === 'in-progress'
        ).length,
        accepted: requests.filter(
            r => r.status === 'accepted'
        ).length,
        implemented: requests.filter(
            r => r.status === 'implemented'
        ).length,
        rejected: requests.filter(
            r => r.status === 'rejected'
        ).length,
        archived: requests.filter(
            r => r.archived
        ).length
    };

    const escalated = requests.filter(
        r => r.escalated
    );

    const activeIssues = issues.filter(
        i => i.status === 'Active' || !i.status
    );

    const pendingUsers = users.filter(
        u => u.role === 'pending'
    );

    const recentActivity = activityLog.slice(0, 8);
    const latestChange = serverChanges[0] || null;

    return {
        counts,
        escalated,
        activeIssues,
        pendingUsers,
        recentActivity,
        latestChange
    };
}

function buildStatusReportEmailHtml(data) {
    const {
        counts,
        escalated,
        activeIssues,
        pendingUsers,
        recentActivity,
        latestChange
    } = data;

    const listOrNone = (items, mapFn) =>
        items.length
            ? `<ul style="margin:4px 0 0;padding-left:18px">${items.map(mapFn).join('')}</ul>`
            : '<p style="margin:4px 0 0;color:#888">None</p>';

    return `
    <div style="font-family:Arial,sans-serif;max-width:600px">
      <h1 style="font-size:18px;margin-bottom:4px">System Status Report</h1>
      <p style="color:#888;margin-top:0">${new Date().toLocaleString('en-GB', {
          dateStyle: 'full',
          timeStyle: 'short'
      })}</p>

      <h2 style="font-size:14px;margin-bottom:6px">Requests Overview</h2>
      <p style="margin:0">
        Total: <b>${counts.total}</b>
        &nbsp; Pending review: <b>${counts.pending}</b>
        &nbsp; In progress: <b>${counts.inProgress}</b><br>
        Accepted: <b>${counts.accepted}</b>
        &nbsp; Implemented: <b>${counts.implemented}</b>
        &nbsp; Rejected: <b>${counts.rejected}</b>
        &nbsp; Archived: <b>${counts.archived}</b>
      </p>

      <h2 style="font-size:14px;margin:16px 0 6px">Escalated Requests (${escalated.length})</h2>
      ${listOrNone(
          escalated,
          r =>
              `<li>${r.id} — ${r.summary || ''} (${r.priority || '—'})</li>`
      )}

      <h2 style="font-size:14px;margin:16px 0 6px">Active Issues (${activeIssues.length})</h2>
      ${listOrNone(
          activeIssues,
          i =>
              `<li>${i.id} — ${i.title || ''} (${i.severity || '—'})</li>`
      )}

      <h2 style="font-size:14px;margin:16px 0 6px">Pending Account Approvals (${pendingUsers.length})</h2>
      ${listOrNone(
          pendingUsers,
          u =>
              `<li>${u.username}${u.name ? ' — ' + u.name : ''}</li>`
      )}

      <h2 style="font-size:14px;margin:16px 0 6px">Recent Activity</h2>
      ${listOrNone(
          recentActivity,
          a =>
              `<li>${a.time} — ${a.user}: ${a.action}${a.detail ? ' — ' + a.detail : ''}</li>`
      )}

      <h2 style="font-size:14px;margin:16px 0 6px">Latest Changelog Entry</h2>
      ${
          latestChange
              ? `<p style="margin:0">v${latestChange.version || '—'} — "${latestChange.title || ''}" (${latestChange.author || '—'}, ${latestChange.date || '—'})</p>`
              : '<p style="margin:0;color:#888">None</p>'
      }

      <p style="margin-top:20px;color:#888;font-size:12px">Change Control System · Automated report</p>
    </div>`;
}

function buildStatusReportDiscordEmbed(data) {
    const {
        counts,
        escalated,
        activeIssues,
        pendingUsers,
        recentActivity,
        latestChange
    } = data;

    const listOrNone = (items, mapFn) =>
        items.length
            ? items.map(mapFn).join('\n')
            : 'None';

    return {
        title: '🗓️ System Status Report',
        color: 0x2563EB,
        fields: [
            {
                name: '📋 Requests Overview',
                value:
                    `Total: **${counts.total}**  ` +
                    `Pending review: **${counts.pending}**  ` +
                    `In progress: **${counts.inProgress}**\n` +
                    `Accepted: **${counts.accepted}**  ` +
                    `Implemented: **${counts.implemented}**  ` +
                    `Rejected: **${counts.rejected}**  ` +
                    `Archived: **${counts.archived}**`,
                inline: false
            },
            {
                name: `🚨 Escalated Requests (${escalated.length})`,
                value: listOrNone(
                    escalated,
                    r =>
                        `• ${r.id} — ${r.summary || ''} (${r.priority || '—'})`
                ),
                inline: false
            },
            {
                name: `🛠️ Active Issues (${activeIssues.length})`,
                value: listOrNone(
                    activeIssues,
                    i =>
                        `• ${i.id} — ${i.title || ''} (${i.severity || '—'})`
                ),
                inline: false
            },
            {
                name: `👤 Pending Account Approvals (${pendingUsers.length})`,
                value: listOrNone(
                    pendingUsers,
                    u =>
                        `• ${u.username}${u.name ? ' — ' + u.name : ''}`
                ),
                inline: false
            },
            {
                name: '📝 Recent Activity',
                value: listOrNone(
                    recentActivity,
                    a =>
                        `• ${a.time} — ${a.user}: ${a.action}`
                ),
                inline: false
            },
            {
                name: '📦 Latest Changelog Entry',
                value: latestChange
                    ? `v${latestChange.version || '—'} — "${latestChange.title || ''}" (${latestChange.author || '—'}, ${latestChange.date || '—'})`
                    : 'None',
                inline: false
            }
        ],
        footer: {
            text: 'Change Control System · Automated report'
        },
        timestamp: new Date().toISOString()
    };
}

async function sendStatusReport({
    email,
    discord
}) {
    const state = await queued(() => readState());
    const settings = state.settings || {};
    const data = buildStatusReportData(state);

    const results = {
        email: null,
        discord: null
    };

    if (email) {
        try {
            await transporter.sendMail({
                from: `"Change Control System" <${process.env.GMAIL_USER}>`,
                to:
                    settings.notifyEmail ||
                    process.env.GMAIL_USER,
                subject:
                    `System Status Report — ${new Date().toLocaleDateString('en-GB')}`,
                html: buildStatusReportEmailHtml(data)
            });

            results.email = 'ok';
        } catch (err) {
            console.error(
                'Status report email failed:',
                err.message
            );

            results.email = err.message;
        }
    }

    if (discord) {
        if (!settings.discordWebhook) {
            results.discord =
                'No Discord webhook configured';
        } else {
            try {
                const response = await fetch(
                    settings.discordWebhook,
                    {
                        method: 'POST',
                        headers: {
                            'Content-Type':
                                'application/json'
                        },
                        body: JSON.stringify({
                            embeds: [
                                buildStatusReportDiscordEmbed(
                                    data
                                )
                            ]
                        })
                    }
                );

                if (!response.ok) {
                    const details =
                        await response.text().catch(
                            () => ''
                        );

                    results.discord =
                        `Discord rejected the request (${response.status}): ${details.slice(0, 300)}`;
                } else {
                    results.discord = 'ok';
                }
            } catch (err) {
                results.discord = err.message;
            }
        }
    }

    return results;
}

app.get('/api/status-report/settings', async (req, res) => {
    try {
        const state = await queued(() => readState());
        const settings = state.settings || {};
        res.json({
            enabled: !!settings.statusReportEnabled,
            email: !!settings.statusReportEmail,
            discord: !!settings.statusReportDiscord
        });
    } catch (err) {
        res.status(500).json({
            error: err.message
        });
    }
});

app.post('/api/status-report/settings', (req, res) => {
    const {
        enabled,
        email,
        discord
    } = req.body || {};

    queued(async () => {
        const state = await readState();

        state.settings = {
            ...(state.settings || {}),
            statusReportEnabled: !!enabled,
            statusReportEmail: !!email,
            statusReportDiscord: !!discord
        };

        await writeState(state);

        return state.settings;
    })
        .then(settings => {
            res.json({
                success: true,
                settings: {
                    enabled: !!settings.statusReportEnabled,
                    email: !!settings.statusReportEmail,
                    discord: !!settings.statusReportDiscord
                }
            });
        })
        .catch(err => {
            console.error('Error saving status report settings:', err.message);

            res.status(500).json({
                error: 'Failed to save status report settings'
            });
        });
});

app.post('/api/status-report/send-now', async (req, res) => {
    try {
        const state = await queued(() => readState());
        const settings = state.settings || {};
        const email = !!settings.statusReportEmail;
        const discord = !!settings.statusReportDiscord;

        if (!email && !discord) {
            return res.status(400).json({
                error: 'No status report channels are enabled in settings'
            });
        }

        const results = await sendStatusReport({
            email,
            discord
        });

        const failed = Object.entries(results).filter(
            ([key, value]) =>
                value && value !== 'ok'
        );

        if (failed.length) {
            return res.status(500).json({
                error: failed
                    .map(
                        ([key, value]) =>
                            `${key}: ${value}`
                    )
                    .join('; ')
            });
        }

        res.json({
            success: true,
            results
        });
    } catch (err) {
        res.status(500).json({
            error: err.message
        });
    }
});

app.post('/api/status-report/test', async (req, res) => {
    const {
        email,
        discord
    } = req.body || {};

    if (!email && !discord) {
        return res.status(400).json({
            error:
                'Select at least one channel (email or Discord)'
        });
    }

    try {
        const results = await sendStatusReport({
            email: !!email,
            discord: !!discord
        });

        const failed = Object.entries(results).filter(
            ([key, value]) =>
                value && value !== 'ok'
        );

        if (failed.length) {
            return res.status(500).json({
                error: failed
                    .map(
                        ([key, value]) =>
                            `${key}: ${value}`
                    )
                    .join('; ')
            });
        }

        res.json({
            success: true,
            results
        });
    } catch (err) {
        res.status(500).json({
            error: err.message
        });
    }
});

const STATUS_REPORT_INTERVAL_MS =
    6 * 60 * 60 * 1000;

function msUntilNextReportBoundary() {
    const now = new Date();
    const next = new Date(now);

    next.setMinutes(0, 0, 0);

    const currentHour = now.getHours();
    const nextBoundaryHour =
        Math.ceil((currentHour + 1) / 6) * 6;

    next.setHours(nextBoundaryHour);

    return next.getTime() - now.getTime();
}

function scheduleStatusReports() {
    const delay = msUntilNextReportBoundary();

    console.log(
        `Next automated status report in ${Math.round(
            delay / 60000
        )} minute(s).`
    );

    setTimeout(async () => {
        await runScheduledStatusReport();

        setInterval(
            runScheduledStatusReport,
            STATUS_REPORT_INTERVAL_MS
        );
    }, delay);
}

async function runScheduledStatusReport() {
    try {
        const state = await queued(() => readState());
        const settings = state.settings || {};

        if (!settings.statusReportEnabled) {
            return;
        }

        if (
            !settings.statusReportEmail &&
            !settings.statusReportDiscord
        ) {
            return;
        }

        const results = await sendStatusReport({
            email: !!settings.statusReportEmail,
            discord: !!settings.statusReportDiscord
        });

        console.log(
            'Automated status report sent:',
            results
        );
    } catch (err) {
        console.error(
            'Automated status report failed:',
            err.message
        );
    }
}

app.use((req, res, next) => {
    if (
        req.method !== 'GET' ||
        req.path.startsWith('/api/')
    ) {
        return next();
    }

    res.sendFile(
        path.join(__dirname, 'index.html')
    );
});

app.listen(PORT, () => {
    console.log(
        `Change Control System running at http://localhost:${PORT}`
    );
    console.log(
        'Server Operations controls are active.'
    );
    console.log(
        'Presence updates use the dedicated server-side endpoint.'
    );
    console.log(
        'Durable 6-hour status reporting is active.'
    );
});