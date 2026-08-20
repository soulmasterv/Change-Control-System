# Changelog
All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

### 1.12.0 (2026-08-19)

#### Features

- Reworked the **Requests** page into a statistics-focused page with additional request-management settings:
  - Ability to enable or disable incoming requests
  - Configurable default notification option
  - Ability to automatically reject requests that remain unchanged for a specified number of days or hours
  - Configurable maximum number of requests per user within a specified number of days or hours
- Added support for **preset and custom tags**
- Added the ability to customize **tag colors**
- Added the ability to **publish or save changelogs as drafts**
- Added the ability to **link change requests to changelogs**
- Added Discord embeds for **issues and changelogs**
- Discord embeds now include a **link button** to the associated request, issue, or changelog
- Added notifications when a new account is created and access is requested
- Reworked **Issues & Fixes** with an option to mark an issue as resolved with a resolution note

#### Bug Fixes

- Fixed an issue where archived items could be archived again
- Archived items are now fully read-only and can no longer be edited

### 1.11.2 (2026-08-19)

#### Features

- Added a new "Archived" section holding all archived data
- Archived requests can no longer be edited/reopened until unarchived
- Archived requests get auto closed (even if they were open)
- Auto-closing requests now goes Rejected → Closed
- Ability to restore "Auto Rejected" requests
- New "All Requests" page to view all requests regardless of status (excluding archived)
- Added a "Date of Creation" field for new pending approval accounts
- Added ability to disable staff from submitting change requests
- Added per-employee cooldown (e.g. 1 request per X hours/days)
- Added a cooldown between saving settings to avoid overlapping saves
- Multiple settings now have auto-save options
- Added a button to publish draft change logs
- Custom tag colors can now be edited by clicking on them
- Escalated requests now show as a red notice beside the request (not a tag)
- Reworked main dashboard into 4 windows: Online staff (Online/DND/Idle), Chat box (chats persist 48 hours), Quick actions, Latest updates
- Added ability to go "Back" from viewing an account to your main account
- Persistent impersonation banner: "Viewing as [User]"
- Administrator actions taken while logged in as another user are now logged in activity management (format: Action done by <logged user> By: administrator <user>)
- Added new "Server Operations" page showing status of Main Server, API, and Notifications, auto-checked every few minutes
- Added a test mode to disable a service/notifications to prevent notification flooding
- Ability to disable responses from staff, with a note displayed on the main dashboard
- Added automated daily/weekly backups sent via email/Discord at a set time

#### Bug Fixes

- Fixed minor bugs in "Edit Profile"
- Fixed bugs with pop-up notifications
- Fixed a bug allowing duplicate username creation on signup
- Fixed a bug where editing a profile via User Management could create duplicate accounts
- Fixed settings not saving on multiple pages
- Fixed a bug where auto-rejected requests still showed as pending
- Fixed a bug where already auto-rejected requests appeared again
- Fixed activity log purging after the 200th log entry
- Fixed system actions being logged in activity logs as if performed by an actual user
- Force log-out message now displays for 10 seconds before logging out (user is locked from all actions during that window)

#### Removed

- Removed ability for administrators to view a user's password — they may only reset it now

### 1.11.1 (2026-08-18)

#### Bug Fixes

- Fixed force-logged-out sessions silently re-establishing themselves a few minutes later instead of staying logged out

### 1.11.0 (2026-08-17)

#### Features

- Added a force-logout option for administrators, from the user management page
- Archived requests and issues are now read-only and can no longer be edited
- Added the ability to delete a single request or issue individually

#### Bug Fixes

- Fixed the danger zone data-reset option not actually deleting anything
- Fixed Discord embeds not sending on certain notifications

### 1.10.0 (2026-08-15)

#### Features

- Added Discord embeds with interactive buttons for richer notifications
- Added a public demo version with sample test data
- Added archiving for requests and issues

#### Bug Fixes

- Fixed the export/import flow

### 1.9.0 (2026-08-13)

#### Features

- Added a "Request Access" flow — new sign-ups now notify administrators to review and assign a role
- Administrators can now log in directly as another user from the user management page
- Limited accounts to a single active login — a second login attempt is blocked while the account is already active elsewhere
- Improved accuracy of the "last seen" status

#### Bug Fixes

- Various minor bug fixes

### 1.8.0 (2026-08-12)

#### Features

- Added a "Mark as Resolved" action for issues, with an optional resolution note
- Added online/offline status and "last seen" tracking for users
- Reworked the user management page UI

#### Bug Fixes

- Fixed Discord webhook links not sending
- Fixed request status changes not saving

### 1.7.0 (2026-08-11)

#### Features

- Added threaded chat/comments on requests
- Added the ability to lock (close) a thread
- Added an optional note when closing a thread
- Enforced password complexity requirements

#### Bug Fixes

- Removed the bulk status-change action for requests

### 1.6.0 (2026-08-10)

#### Features

- Added Discord webhook notifications
- Added a self-service Edit Profile option (password, username, email)
- Added request statistics to the main dashboard
- Added bulk status-change selection for requests

### 1.5.1 (date needs verification — see note below)

#### Features

- Redesigned the sign-in and account creation screens with a refreshed visual style
- Reorganized page layout and navigation so key sections are easier to find
- Added two-way email support — the system can now send and receive notification
