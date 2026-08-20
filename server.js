require('dotenv').config();

const express = require('express');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const nodemailer = require('nodemailer');

const app = express();

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'app_state.json');

app.use(express.json({ limit: '10mb' }));

// ============================================================================
// SERIALIZED DATA ACCESS
// ============================================================================

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
    } catch (err) {
        if (err.code === 'ENOENT') {
            return defaultState();
        }

        console.error(
            'app_state.json could not be read:',
            err.message
        );

        return {
            changeRequests: [],
            issues: [],
            settings: {},
            users: []
        };
    }
}

async function writeState(state) {
    const dir = path.dirname(DATA_FILE);

    await fsp.mkdir(dir, {
        recursive: true
    });

    await fsp.writeFile(
        DATA_FILE,
        JSON.stringify(state, null, 2)
    );
}

// ============================================================================
// SERVER OPERATIONS
// ============================================================================

function getServerOperationsSettings(state) {
    const settings =
        state &&
        state.settings &&
        typeof state.settings === 'object'
            ? state.settings
            : {};

    const test =
        settings.serverOperationsTest &&
        typeof settings.serverOperationsTest === 'object'
            ? settings.serverOperationsTest
            : {};

    return {
        enabled: test.enabled === true,

        mainServer:
            test.enabled === true &&
            test.mainServer === true,

        api:
            test.enabled === true &&
            test.api === true,

        notifications:
            test.enabled === true &&
            test.notifications === true,

        tempDisableAllNotifications:
            settings.tempDisableAllNotifications === true
    };
}

function notificationsAreDisabled(settings) {
    if (!settings || typeof settings !== 'object') {
        return false;
    }

    const test =
        settings.serverOperationsTest &&
        typeof settings.serverOperationsTest === 'object'
            ? settings.serverOperationsTest
            : {};

    return (
        settings.tempDisableAllNotifications === true ||
        (
            test.enabled === true &&
            test.notifications === true
        )
    );
}

// ============================================================================
// SERVER OPERATIONS STATUS
// ============================================================================

app.get('/api/server-operations', async (req, res) => {
    try {
        const state = await readState();

        const ops =
            getServerOperationsSettings(state);

        res.status(200).json({
            success: true,

            ...ops,

            notificationsDisabled:
                notificationsAreDisabled(
                    state.settings || {}
                )
        });
    } catch (err) {
        console.error(
            '[Server Operations] GET failed:',
            err
        );

        res.status(500).json({
            success: false,
            error:
                'Failed to read server operation state',
            details:
                err.message
        });
    }
});

// ============================================================================
// SERVER OPERATIONS UPDATE
// ============================================================================
//
// IMPORTANT:
//
// This endpoint is deliberately ABOVE the API failure middleware.
//
// That means when "API Failure" is enabled, this endpoint still works.
// Otherwise you could turn API failure ON but would have no way to turn it
// back OFF from the UI.
// ============================================================================

app.post('/api/server-operations', async (req, res) => {
    try {
        const incoming =
            req.body &&
            typeof req.body === 'object'
                ? req.body
                : {};

        const state = await readState();

        if (
            !state.settings ||
            typeof state.settings !== 'object'
        ) {
            state.settings = {};
        }

        if (
            !state.settings.serverOperationsTest ||
            typeof state.settings.serverOperationsTest !== 'object'
        ) {
            state.settings.serverOperationsTest = {
                enabled: false,
                mainServer: false,
                api: false,
                notifications: false
            };
        }

        const test =
            state.settings.serverOperationsTest;

        // ------------------------------------------------------------
        // Always-available notification disable switch
        // ------------------------------------------------------------

        if (
            typeof incoming.tempDisableAllNotifications ===
            'boolean'
        ) {
            state.settings.tempDisableAllNotifications =
                incoming.tempDisableAllNotifications;
        }

        // ------------------------------------------------------------
        // Test Mode master switch
        // ------------------------------------------------------------

        if (
            typeof incoming.enabled === 'boolean'
        ) {
            test.enabled =
                incoming.enabled;
        }

        // ------------------------------------------------------------
        // Individual test switch
        // ------------------------------------------------------------

        const validServices = [
            'mainServer',
            'api',
            'notifications'
        ];

        if (
            validServices.includes(
                incoming.service
            ) &&
            typeof incoming.checked === 'boolean'
        ) {
            test[incoming.service] =
                incoming.checked;
        }

        // ------------------------------------------------------------
        // Turning Test Mode OFF clears every test
        // ------------------------------------------------------------

        if (test.enabled !== true) {
            test.enabled = false;
            test.mainServer = false;
            test.api = false;
            test.notifications = false;
        }

        await writeState(state);

        const ops =
            getServerOperationsSettings(state);

        console.log(
            '[Server Operations] Updated:',
            ops
        );

        res.status(200).json({
            success: true,

            ...ops,

            notificationsDisabled:
                notificationsAreDisabled(
                    state.settings || {}
                )
        });

    } catch (err) {
        console.error(
            '[Server Operations] POST failed:',
            err
        );

        res.status(500).json({
            success: false,
            error:
                'Failed to update server operations',
            details:
                err.message
        });
    }
});

// ============================================================================
// REAL SERVER-SIDE SERVICE GATES
// ============================================================================
//
// These are NOT visual simulations.
//
// API Failure:
//     Real /api/* requests return HTTP 503.
//
// Main Server Offline:
//     Normal website requests return HTTP 503.
//
// Notifications:
//     Actual email/Discord delivery is blocked below.
//
// /api/server-operations is explicitly exempt so recovery is always possible.
// ============================================================================

app.use(async (req, res, next) => {

    // NEVER block the recovery endpoint.
    if (
        req.path === '/api/server-operations'
    ) {
        return next();
    }

    try {
        const state =
            await readState();

        const ops =
            getServerOperationsSettings(state);

        // ------------------------------------------------------------
        // REAL API FAILURE
        // ------------------------------------------------------------

        if (
            ops.api &&
            req.path.startsWith('/api/')
        ) {
            return res.status(503).json({
                success: false,

                error:
                    'API intentionally unavailable.',

                testMode: true
            });
        }

        // ------------------------------------------------------------
        // REAL MAIN SERVER FAILURE
        // ------------------------------------------------------------

        if (
            ops.mainServer &&
            !req.path.startsWith('/api/')
        ) {
            return res
                .status(503)
                .send(
                    '<!doctype html>' +
                    '<html><head><title>503</title></head>' +
                    '<body style="font-family:Arial;padding:40px">' +
                    '<h1>503 Service Unavailable</h1>' +
                    '<p>Main server is intentionally offline.</p>' +
                    '</body></html>'
                );
        }

    } catch (err) {
        console.error(
            '[Server Operations] Gate error:',
            err.message
        );
    }

    next();
});

// ============================================================================
// STATIC FRONTEND
// ============================================================================

app.use(express.static(__dirname));

// ============================================================================
// EMAIL
// ============================================================================

const transporter =
    nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,

        auth: {
            user:
                process.env.GMAIL_USER,

            pass:
                process.env.GMAIL_APP_PASSWORD
        }
    });

// ============================================================================
// DATA API
// ============================================================================

app.get('/api/data', async (req, res) => {
    try {
        const state =
            await readState();

        res.status(200).json(state);

    } catch (err) {
        console.error(
            'GET /api/data failed:',
            err.message
        );

        res.status(500).json({
            error:
                'Failed to read data'
        });
    }
});

app.post('/api/data', (req, res) => {
    const appState =
        req.body;

    if (
        !appState ||
        typeof appState !== 'object'
    ) {
        return res.status(400).json({
            error:
                'Invalid application state'
        });
    }

    queued(async () => {
        await writeState(appState);
    })
        .then(() => {
            res.status(200).json({
                success: true
            });
        })
        .catch(err => {
            console.error(
                'POST /api/data failed:',
                err.message
            );

            res.status(500).json({
                error:
                    'Failed to save data'
            });
        });
});

// ============================================================================
// SESSION HEARTBEAT
// ============================================================================

const SESSION_LEASE_MS =
    15 * 1000;

app.post(
    '/api/session/heartbeat',
    (req, res) => {

        const {
            username,
            sessionId
        } = req.body || {};

        if (
            !username ||
            !sessionId
        ) {
            return res.status(400).json({
                error:
                    'username and sessionId are required'
            });
        }

        queued(async () => {
            const state =
                await readState();

            const users =
                Array.isArray(state.users)
                    ? state.users
                    : [];

            const idx =
                users.findIndex(
                    u =>
                        u.username ===
                        username
                );

            if (idx === -1) {
                return {
                    status:
                        'not-found'
                };
            }

            const user =
                users[idx];

            if (
                user.revokedSessionId ===
                sessionId
            ) {
                return {
                    status:
                        'revoked',

                    reason:
                        user.revokedReason ||
                        null
                };
            }

            const now =
                Date.now();

            if (
                user.activeSessionId &&
                user.activeSessionId !==
                    sessionId &&
                user.activeSessionAt &&
                (
                    now -
                    user.activeSessionAt
                ) < SESSION_LEASE_MS
            ) {
                return {
                    status:
                        'other-session'
                };
            }

            users[idx] = {
                ...user,

                activeSessionId:
                    sessionId,

                activeSessionAt:
                    now,

                lastOnline:
                    now
            };

            state.users =
                users;

            await writeState(
                state
            );

            return {
                status:
                    'ok'
            };
        })
            .then(result =>
                res.status(200).json(
                    result
                )
            )
            .catch(err => {
                console.error(
                    'Heartbeat failed:',
                    err.message
                );

                res.status(500).json({
                    error:
                        'Failed to process heartbeat'
                });
            });
    }
);

// ============================================================================
// FORCE LOGOUT
// ============================================================================

app.post(
    '/api/session/force-logout',
    (req, res) => {

        const {
            username,
            reason
        } = req.body || {};

        if (!username) {
            return res.status(400).json({
                error:
                    'username is required'
            });
        }

        queued(async () => {
            const state =
                await readState();

            const users =
                Array.isArray(state.users)
                    ? state.users
                    : [];

            const idx =
                users.findIndex(
                    u =>
                        u.username ===
                        username
                );

            if (idx === -1) {
                return {
                    status:
                        'not-found'
                };
            }

            const user =
                users[idx];

            if (
                !user.activeSessionId
            ) {
                return {
                    status:
                        'already-logged-out',

                    name:
                        user.name
                };
            }

            users[idx] = {
                ...user,

                revokedSessionId:
                    user.activeSessionId,

                revokedReason:
                    typeof reason === 'string' &&
                    reason.trim()
                        ? reason
                            .trim()
                            .slice(
                                0,
                                300
                            )
                        : null,

                activeSessionId:
                    null,

                activeSessionAt:
                    null,

                lastOnline:
                    Date.now()
            };

            state.users =
                users;

            await writeState(
                state
            );

            return {
                status:
                    'ok',

                name:
                    user.name
            };
        })
            .then(result =>
                res.status(200).json(
                    result
                )
            )
            .catch(err => {
                console.error(
                    'Force logout failed:',
                    err.message
                );

                res.status(500).json({
                    error:
                        'Failed to force logout'
                });
            });
    }
);

// ============================================================================
// SETTINGS
// ============================================================================

app.post(
    '/api/settings',
    (req, res) => {

        const incoming =
            req.body || {};

        queued(async () => {

            const state =
                await readState();

            state.settings = {
                ...(state.settings || {}),
                ...incoming,

                lastSavedAt:
                    Date.now()
            };

            await writeState(
                state
            );

            return state.settings;

        })
            .then(settings =>
                res.status(200).json({
                    success: true,
                    settings
                })
            )
            .catch(err => {
                console.error(
                    'Settings save failed:',
                    err.message
                );

                res.status(500).json({
                    error:
                        'Failed to save settings'
                });
            });
    }
);

// ============================================================================
// USER UPDATE
// ============================================================================

app.post(
    '/api/users/update',
    (req, res) => {

        const {
            originalUsername,
            user
        } = req.body || {};

        if (
            !originalUsername ||
            !user ||
            !user.username
        ) {
            return res.status(400).json({
                error:
                    'originalUsername and user are required'
            });
        }

        queued(async () => {

            const state =
                await readState();

            const users =
                Array.isArray(state.users)
                    ? state.users
                    : [];

            const idx =
                users.findIndex(
                    u =>
                        u.username ===
                        originalUsername
                );

            if (idx === -1) {
                return {
                    status:
                        'not-found'
                };
            }

            if (
                user.username !==
                    originalUsername &&
                users.some(
                    u =>
                        u.username ===
                        user.username
                )
            ) {
                return {
                    status:
                        'username-taken'
                };
            }

            users[idx] = {
                ...users[idx],
                ...user
            };

            state.users =
                users;

            await writeState(
                state
            );

            return {
                status:
                    'ok',

                users
            };

        })
            .then(result =>
                res.status(200).json(
                    result
                )
            )
            .catch(err => {
                console.error(
                    'User update failed:',
                    err.message
                );

                res.status(500).json({
                    error:
                        'Failed to update user'
                });
            });
    }
);

// ============================================================================
// EMAIL NOTIFICATIONS
// ============================================================================

app.post(
    '/api/notify',
    async (req, res) => {

        const {
            subject,
            body,
            to
        } = req.body || {};

        try {

            const state =
                await readState();

            if (
                notificationsAreDisabled(
                    state.settings || {}
                )
            ) {
                return res.status(503).json({
                    success: false,

                    error:
                        'Notifications are temporarily disabled.'
                });
            }

            await transporter.sendMail({
                from:
                    `"Change Control System" <${process.env.GMAIL_USER}>`,

                to:
                    to ||
                    process.env.GMAIL_USER,

                subject:
                    subject ||
                    'Change Control Notification',

                html:
                    body ||
                    ''
            });

            console.log(
                `Email sent: "${subject}" -> ${to || process.env.GMAIL_USER}`
            );

            res.status(200).json({
                success: true
            });

        } catch (err) {

            console.error(
                'Email error:',
                err.message
            );

            res.status(500).json({
                error:
                    err.message
            });
        }
    }
);

// ============================================================================
// DISCORD NOTIFICATIONS
// ============================================================================

app.post(
    '/api/discord',
    async (req, res) => {

        const {
            message,
            embed,
            components,
            webhookUrl
        } = req.body || {};

        try {

            const state =
                await readState();

            if (
                notificationsAreDisabled(
                    state.settings || {}
                )
            ) {
                return res.status(503).json({
                    success: false,

                    error:
                        'Notifications are temporarily disabled.'
                });
            }

        } catch (err) {

            return res.status(500).json({
                error:
                    'Could not verify notification state.'
            });
        }

        if (!webhookUrl) {
            return res.status(400).json({
                error:
                    'No webhook URL'
            });
        }

        if (!message && !embed) {
            return res.status(400).json({
                error:
                    'No message or embed provided'
            });
        }

        try {

            const payload = {};

            if (message) {
                payload.content =
                    message;
            }

            if (embed) {
                payload.embeds = [
                    embed
                ];
            }

            if (
                Array.isArray(
                    components
                ) &&
                components.length
            ) {
                payload.components =
                    components;
            }

            const separator =
                webhookUrl.includes('?')
                    ? '&'
                    : '?';

            const discordUrl =
                webhookUrl +
                separator +
                'wait=true&with_components=true';

            const response =
                await fetch(
                    discordUrl,
                    {
                        method:
                            'POST',

                        headers: {
                            'Content-Type':
                                'application/json'
                        },

                        body:
                            JSON.stringify(
                                payload
                            )
                    }
                );

            if (!response.ok) {

                const details =
                    await response
                        .text()
                        .catch(
                            () => ''
                        );

                return res.status(500).json({
                    error:
                        'Discord rejected the request',

                    status:
                        response.status,

                    details:
                        details.slice(
                            0,
                            500
                        )
                });
            }

            console.log(
                'Discord notification sent successfully.'
            );

            res.status(200).json({
                success: true
            });

        } catch (err) {

            console.error(
                'Discord notify error:',
                err.message
            );

            res.status(500).json({
                error:
                    err.message
            });
        }
    }
);

// ============================================================================
// BACKUP SYSTEM
// ============================================================================

const BACKUP_CHECK_INTERVAL_MS =
    60 * 60 * 1000;

const BACKUP_FREQUENCIES_MS = {
    daily:
        24 * 60 * 60 * 1000,

    weekly:
        7 * 24 * 60 * 60 * 1000
};

async function runScheduledBackupIfDue(
    force = false
) {

    const state =
        await readState();

    const schedule =
        (
            state.settings &&
            state.settings.backupSchedule
        ) || {};

    if (!force) {

        if (!schedule.enabled) {
            return {
                ran:
                    false,

                reason:
                    'disabled'
            };
        }

        const freqMs =
            BACKUP_FREQUENCIES_MS[
                schedule.frequency
            ] ||
            BACKUP_FREQUENCIES_MS.daily;

        const lastRun =
            schedule.lastRunAt ||
            0;

        if (
            Date.now() -
            lastRun <
            freqMs
        ) {
            return {
                ran:
                    false,

                reason:
                    'not-due'
            };
        }
    }

    if (
        notificationsAreDisabled(
            state.settings || {}
        )
    ) {
        return {
            ran:
                false,

            reason:
                'notifications-disabled'
        };
    }

    const channels =
        schedule.channels ||
        {};

    const notifyEmail =
        state.settings &&
        state.settings.notifyEmail;

    const discordWebhook =
        state.settings &&
        state.settings.discordWebhook;

    const filename =
        `ccms-backup-${new Date().toISOString().split('T')[0]}.json`;

    const jsonString =
        JSON.stringify(
            {
                changeRequests:
                    state.changeRequests ||
                    [],

                issues:
                    state.issues ||
                    [],

                users:
                    state.users ||
                    [],

                serverChanges:
                    state.serverChanges ||
                    [],

                presetTags:
                    state.presetTags ||
                    [],

                activityLog:
                    state.activityLog ||
                    [],

                exportDate:
                    new Date().toISOString()
            },
            null,
            2
        );

    let sentAny =
        false;

    if (
        channels.email &&
        notifyEmail
    ) {

        try {

            await transporter.sendMail({
                from:
                    `"Change Control System" <${process.env.GMAIL_USER}>`,

                to:
                    notifyEmail,

                subject:
                    `Automated Backup — ${filename}`,

                html:
                    `<p>Attached is the automated ${schedule.frequency || 'daily'} backup of your Change Control System data.</p>`,

                attachments: [
                    {
                        filename,
                        content:
                            jsonString
                    }
                ]
            });

            sentAny =
                true;

        } catch (err) {

            console.error(
                'Automated backup email failed:',
                err.message
            );
        }
    }

    if (
        channels.discord &&
        discordWebhook
    ) {

        try {

            const form =
                new FormData();

            form.append(
                'payload_json',

                JSON.stringify({
                    content:
                        `🗄️ Automated ${schedule.frequency || 'daily'} backup — ${filename}`
                })
            );

            form.append(
                'file',

                new Blob(
                    [
                        jsonString
                    ],
                    {
                        type:
                            'application/json'
                    }
                ),

                filename
            );

            const response =
                await fetch(
                    discordWebhook,
                    {
                        method:
                            'POST',

                        body:
                            form
                    }
                );

            if (!response.ok) {
                throw new Error(
                    `Discord rejected upload: ${response.status}`
                );
            }

            sentAny =
                true;

        } catch (err) {

            console.error(
                'Automated backup Discord upload failed:',
                err.message
            );
        }
    }

    queued(async () => {

        const freshState =
            await readState();

        if (!freshState.settings) {
            freshState.settings =
                {};
        }

        if (
            !freshState.settings.backupSchedule
        ) {
            freshState.settings.backupSchedule =
                {};
        }

        freshState
            .settings
            .backupSchedule
            .lastRunAt =
            Date.now();

        await writeState(
            freshState
        );
    });

    return {
        ran:
            true,

        sentAny
    };
}

setInterval(
    () => {
        runScheduledBackupIfDue()
            .catch(err =>
                console.error(
                    'Backup check failed:',
                    err.message
                )
            );
    },
    BACKUP_CHECK_INTERVAL_MS
);

runScheduledBackupIfDue()
    .catch(err =>
        console.error(
            'Initial backup check failed:',
            err.message
        )
    );

// ============================================================================
// BACKUP RUN NOW
// ============================================================================

app.post(
    '/api/backup/run-now',
    async (req, res) => {

        try {

            const result =
                await runScheduledBackupIfDue(
                    true
                );

            res.status(200).json(
                result
            );

        } catch (err) {

            res.status(500).json({
                error:
                    err.message
            });
        }
    }
);

// ============================================================================
// STATUS REPORT DATA
// ============================================================================

function buildStatusReportData(
    state
) {

    const requests =
        Array.isArray(
            state.changeRequests
        )
            ? state.changeRequests
            : [];

    const issues =
        Array.isArray(
            state.issues
        )
            ? state.issues
            : [];

    const users =
        Array.isArray(
            state.users
        )
            ? state.users
            : [];

    const activityLog =
        Array.isArray(
            state.activityLog
        )
            ? state.activityLog
            : [];

    const serverChanges =
        Array.isArray(
            state.serverChanges
        )
            ? state.serverChanges
            : [];

    const counts = {

        total:
            requests.length,

        pending:
            requests.filter(
                r =>
                    r.status ===
                    'pending-review'
            ).length,

        inProgress:
            requests.filter(
                r =>
                    r.status ===
                        'accepted' ||
                    r.status ===
                        'in-progress'
            ).length,

        accepted:
            requests.filter(
                r =>
                    r.status ===
                    'accepted'
            ).length,

        implemented:
            requests.filter(
                r =>
                    r.status ===
                    'implemented'
            ).length,

        rejected:
            requests.filter(
                r =>
                    r.status ===
                    'rejected'
            ).length,

        archived:
            requests.filter(
                r =>
                    r.archived
            ).length
    };

    const escalated =
        requests.filter(
            r =>
                r.escalated
        );

    const activeIssues =
        issues.filter(
            i =>
                i.status ===
                    'Active' ||
                !i.status
        );

    const pendingUsers =
        users.filter(
            u =>
                u.role ===
                'pending'
        );

    const recentActivity =
        activityLog.slice(
            0,
            8
        );

    const latestChange =
        serverChanges[0] ||
        null;

    return {
        counts,
        escalated,
        activeIssues,
        pendingUsers,
        recentActivity,
        latestChange
    };
}

// ============================================================================
// STATUS REPORT EMAIL
// ============================================================================

function buildStatusReportEmailHtml(
    data
) {

    const {
        counts,
        escalated,
        activeIssues,
        pendingUsers,
        recentActivity,
        latestChange
    } = data;

    const listOrNone =
        (
            items,
            mapFn
        ) =>
            items.length
                ? `
                    <ul style="margin:4px 0 0;padding-left:18px">
                        ${items
                            .map(mapFn)
                            .join('')}
                    </ul>
                  `
                : `
                    <p style="margin:4px 0 0;color:#888">
                        None
                    </p>
                  `;

    return `
        <div style="font-family:Arial,sans-serif;max-width:600px">

            <h1 style="font-size:18px;margin-bottom:4px">
                System Status Report
            </h1>

            <p style="color:#888;margin-top:0">
                ${new Date().toLocaleString(
                    'en-GB',
                    {
                        dateStyle:
                            'full',

                        timeStyle:
                            'short'
                    }
                )}
            </p>

            <h2 style="font-size:14px;margin-bottom:6px">
                Requests Overview
            </h2>

            <p style="margin:0">
                Total:
                <b>${counts.total}</b>

                &nbsp;

                Pending review:
                <b>${counts.pending}</b>

                &nbsp;

                In progress:
                <b>${counts.inProgress}</b>

                <br>

                Accepted:
                <b>${counts.accepted}</b>

                &nbsp;

                Implemented:
                <b>${counts.implemented}</b>

                &nbsp;

                Rejected:
                <b>${counts.rejected}</b>

                &nbsp;

                Archived:
                <b>${counts.archived}</b>
            </p>

            <h2 style="font-size:14px;margin:16px 0 6px">
                Escalated Requests (${escalated.length})
            </h2>

            ${listOrNone(
                escalated,
                r =>
                    `<li>${r.id} — ${r.summary || ''} (${r.priority || '—'})</li>`
            )}

            <h2 style="font-size:14px;margin:16px 0 6px">
                Active Issues (${activeIssues.length})
            </h2>

            ${listOrNone(
                activeIssues,
                i =>
                    `<li>${i.id} — ${i.title || ''} (${i.severity || '—'})</li>`
            )}

            <h2 style="font-size:14px;margin:16px 0 6px">
                Pending Account Approvals (${pendingUsers.length})
            </h2>

            ${listOrNone(
                pendingUsers,
                u =>
                    `<li>${u.username}${u.name ? ' — ' + u.name : ''}</li>`
            )}

            <h2 style="font-size:14px;margin:16px 0 6px">
                Recent Activity
            </h2>

            ${listOrNone(
                recentActivity,
                a =>
                    `<li>${a.time} — ${a.user}: ${a.action}${a.detail ? ' — ' + a.detail : ''}</li>`
            )}

            <h2 style="font-size:14px;margin:16px 0 6px">
                Latest Changelog Entry
            </h2>

            ${
                latestChange
                    ? `
                        <p style="margin:0">
                            v${latestChange.version || '—'}
                            —
                            "${latestChange.title || ''}"
                            (${latestChange.author || '—'},
                            ${latestChange.date || '—'})
                        </p>
                      `
                    : `
                        <p style="margin:0;color:#888">
                            None
                        </p>
                      `
            }

            <p style="margin-top:20px;color:#888;font-size:12px">
                Change Control System · Automated report
            </p>

        </div>
    `;
}

// ============================================================================
// STATUS REPORT DISCORD
// ============================================================================

function buildStatusReportDiscordEmbed(
    data
) {

    const {
        counts,
        escalated,
        activeIssues,
        pendingUsers,
        recentActivity,
        latestChange
    } = data;

    const listOrNone =
        (
            items,
            mapFn
        ) =>
            items.length
                ? items.map(mapFn).join('\n')
                : 'None';

    return {

        title:
            '🗓️ System Status Report',

        color:
            0x2563EB,

        fields: [

            {
                name:
                    '📋 Requests Overview',

                value:
                    `Total: **${counts.total}**  ` +
                    `Pending review: **${counts.pending}**  ` +
                    `In progress: **${counts.inProgress}**\n` +
                    `Accepted: **${counts.accepted}**  ` +
                    `Implemented: **${counts.implemented}**  ` +
                    `Rejected: **${counts.rejected}**  ` +
                    `Archived: **${counts.archived}**`,

                inline:
                    false
            },

            {
                name:
                    `🚨 Escalated Requests (${escalated.length})`,

                value:
                    listOrNone(
                        escalated,
                        r =>
                            `• ${r.id} — ${r.summary || ''} (${r.priority || '—'})`
                    ),

                inline:
                    false
            },

            {
                name:
                    `🛠️ Active Issues (${activeIssues.length})`,

                value:
                    listOrNone(
                        activeIssues,
                        i =>
                            `• ${i.id} — ${i.title || ''} (${i.severity || '—'})`
                    ),

                inline:
                    false
            },

            {
                name:
                    `👤 Pending Account Approvals (${pendingUsers.length})`,

                value:
                    listOrNone(
                        pendingUsers,
                        u =>
                            `• ${u.username}${u.name ? ' — ' + u.name : ''}`
                    ),

                inline:
                    false
            },

            {
                name:
                    '📝 Recent Activity',

                value:
                    listOrNone(
                        recentActivity,
                        a =>
                            `• ${a.time} — ${a.user}: ${a.action}`
                    ),

                inline:
                    false
            },

            {
                name:
                    '📦 Latest Changelog Entry',

                value:
                    latestChange
                        ? `v${latestChange.version || '—'} — "${latestChange.title || ''}" (${latestChange.author || '—'}, ${latestChange.date || '—'})`
                        : 'None',

                inline:
                    false
            }
        ],

        footer: {
            text:
                'Change Control System · Automated report'
        },

        timestamp:
            new Date().toISOString()
    };
}

// ============================================================================
// SEND STATUS REPORT
// ============================================================================

async function sendStatusReport({
    email,
    discord
}) {

    const state =
        await readState();

    const settings =
        state.settings ||
        {};

    if (
        notificationsAreDisabled(
            settings
        )
    ) {
        return {
            email:
                'notifications-disabled',

            discord:
                'notifications-disabled'
        };
    }

    const data =
        buildStatusReportData(
            state
        );

    const results = {
        email:
            null,

        discord:
            null
    };

    // ------------------------------------------------------------
    // EMAIL
    // ------------------------------------------------------------

    if (email) {

        try {

            await transporter.sendMail({
                from:
                    `"Change Control System" <${process.env.GMAIL_USER}>`,

                to:
                    settings.notifyEmail ||
                    process.env.GMAIL_USER,

                subject:
                    `System Status Report — ${new Date().toLocaleDateString('en-GB')}`,

                html:
                    buildStatusReportEmailHtml(
                        data
                    )
            });

            results.email =
                'ok';

        } catch (err) {

            console.error(
                'Status report email failed:',
                err.message
            );

            results.email =
                err.message;
        }
    }

    // ------------------------------------------------------------
    // DISCORD
    // ------------------------------------------------------------

    if (discord) {

        if (
            !settings.discordWebhook
        ) {

            results.discord =
                'No Discord webhook configured';

        } else {

            try {

                const response =
                    await fetch(
                        settings.discordWebhook,
                        {
                            method:
                                'POST',

                            headers: {
                                'Content-Type':
                                    'application/json'
                            },

                            body:
                                JSON.stringify({
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
                        await response
                            .text()
                            .catch(
                                () => ''
                            );

                    results.discord =
                        `Discord rejected the request (${response.status}): ${details.slice(0, 300)}`;

                } else {

                    results.discord =
                        'ok';
                }

            } catch (err) {

                results.discord =
                    err.message;
            }
        }
    }

    return results;
}

// ============================================================================
// STATUS REPORT TEST
// ============================================================================

app.post(
    '/api/status-report/test',
    async (req, res) => {

        const {
            email,
            discord
        } = req.body || {};

        if (
            !email &&
            !discord
        ) {
            return res.status(400).json({
                error:
                    'Select at least one channel (email or Discord)'
            });
        }

        try {

            const results =
                await sendStatusReport({
                    email:
                        !!email,

                    discord:
                        !!discord
                });

            const failed =
                Object.entries(
                    results
                ).filter(
                    ([key, value]) =>
                        value &&
                        value !== 'ok'
                );

            if (failed.length) {

                return res.status(500).json({
                    error:
                        failed
                            .map(
                                ([key, value]) =>
                                    `${key}: ${value}`
                            )
                            .join('; ')
                });
            }

            res.status(200).json({
                success:
                    true,

                results
            });

        } catch (err) {

            res.status(500).json({
                error:
                    err.message
            });
        }
    }
);

// ============================================================================
// AUTOMATED STATUS REPORTS
// ============================================================================

const STATUS_REPORT_INTERVAL_MS =
    6 * 60 * 60 * 1000;

function msUntilNextReportBoundary() {

    const now =
        new Date();

    const next =
        new Date(now);

    next.setMinutes(
        0,
        0,
        0
    );

    const currentHour =
        now.getHours();

    const nextBoundaryHour =
        Math.ceil(
            (currentHour + 1) / 6
        ) * 6;

    next.setHours(
        nextBoundaryHour
    );

    return (
        next.getTime() -
        now.getTime()
    );
}

async function runScheduledStatusReport() {

    try {

        const state =
            await readState();

        const settings =
            state.settings ||
            {};

        if (
            !settings.statusReportEnabled
        ) {
            return;
        }

        if (
            !settings.statusReportEmail &&
            !settings.statusReportDiscord
        ) {
            return;
        }

        const results =
            await sendStatusReport({
                email:
                    !!settings.statusReportEmail,

                discord:
                    !!settings.statusReportDiscord
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

function scheduleStatusReports() {

    const delay =
        msUntilNextReportBoundary();

    console.log(
        `Next automated status report in ${Math.round(delay / 60000)} minute(s).`
    );

    setTimeout(
        async () => {

            await runScheduledStatusReport();

            setInterval(
                runScheduledStatusReport,
                STATUS_REPORT_INTERVAL_MS
            );

        },
        delay
    );
}

// ============================================================================
// SPA FALLBACK
// ============================================================================

app.use(
    (req, res, next) => {

        if (
            req.method !== 'GET' ||
            req.path.startsWith('/api/')
        ) {
            return next();
        }

        res.sendFile(
            path.join(
                __dirname,
                'index.html'
            )
        );
    }
);

// ============================================================================
// START SERVER
// ============================================================================

app.listen(
    PORT,
    () => {

        console.log(
            `Change Control System running at http://localhost:${PORT}`
        );

        scheduleStatusReports();
    }
);