# Jira Bulk Subtask Creator

A Chrome extension that adds a **"Create multi-sub-task"** option to the Jira issue More dropdown, letting you create multiple subtasks at once instead of one at a time.

## Features

- Adds "Create multi-sub-task" immediately after "Create sub-task" in the More dropdown
- Enter one subtask title per line — no limit on the number
- Live preview: shows how many subtasks will be created as you type
- Per-row progress tracking with links to each created issue
- Individual row errors don't stop the rest — partial success is handled gracefully
- Works across SPA navigation (no page reload needed when switching issues)
- Compatible with Jira Software Data Center and Server, classic AUI-based UI

## Requirements

- **Jira Software** Data Center or Server, version 8.x–10.x, classic UI
- **Chrome** browser (any recent version)
- Must be **logged into Jira** — the extension uses your existing browser session (no credentials are stored or sent anywhere)

## Installation

1. Download or clone this repository
2. Open **`chrome://extensions`** in Chrome
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked** and select the `jira-helpers` folder
5. The extension is now active

## Usage

1. Navigate to any Jira issue page (URL contains `/browse/PROJ-123`)
2. Click the **More** dropdown button
3. Click **"Create multi-sub-task"**
4. In the modal, enter one subtask title per line:
   ```
   Set up development environment
   Write unit tests
   Update documentation
   Code review
   ```
5. Click **"Create N Subtasks"**
6. Watch per-row progress — each row shows ✅ with a link on success or ❌ with the error on failure
7. Click **"Reload to see subtasks"** to refresh the issue page when done

## Troubleshooting

**"Create multi-sub-task" doesn't appear in the More menu**
- Reload the extension: go to `chrome://extensions`, find the extension, click the reload icon
- Hard-refresh the Jira page (Cmd+Shift+R on Mac / Ctrl+Shift+R on Windows)
- Check the browser console (F12 → Console) for error messages
- Confirm the URL contains `/browse/PROJ-123`

**Error: HTTP 403**
Your Jira session may have expired. Refresh the Jira page to log in again, then retry.

**Error: No subtask issue type found**
The project may not have subtasks enabled, or your account may not have permission to create them. Contact your Jira administrator.

**Error: Failed to fetch / network error**
Check your network connection and confirm the Jira instance is reachable.

## Privacy

All API calls are made directly to your Jira instance using your existing browser session. No data is sent to any external service. The extension has no analytics, no telemetry, and no external dependencies.
