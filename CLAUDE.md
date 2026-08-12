# Jira Helpers — Claude Notes

## Overview

A Chrome MV3 extension for Jira Software Data Center (classic AUI-based UI). It injects a "Create multi-sub-task" menu item into the More dropdown on issue pages (`/browse/PROJ-123`). Clicking it opens a modal where multiple subtask titles (one per line) are entered and created in one operation via the Jira REST API v2.

## Loading and Testing in Chrome

1. Open `chrome://extensions` in Chrome
2. Enable **Developer mode** (toggle, top-right)
3. Click **Load unpacked** and select this directory (`jira-helpers/`)
4. Navigate to a Jira issue page and open the **More** dropdown — the new item appears after "Create sub-task"

After editing `content.js` or `styles.css`, click the reload icon on the extension card in `chrome://extensions`, then hard-refresh the Jira page (Cmd+Shift+R / Ctrl+Shift+R).

## File Architecture

**`manifest.json`** — MV3 manifest. Uses `"matches": ["*://*/*"]` because Jira DC is self-hosted at arbitrary URLs. Self-limiting logic lives in `content.js`.

**`content.js`** — All extension logic in a single IIFE. Responsibilities:
- Page detection guard (URL pattern + `<meta name="application-name">`)
- 4-strategy selector for finding the "Create sub-task" `<li>`
- Menu item injection with idempotency guard
- SPA navigation detection via `pushState`/`replaceState` override + `popstate`
- `MutationObserver` to handle lazy-rendered dropdowns
- Jira REST API calls (fetch project key, fetch subtask issue type ID, create subtasks)
- Modal DOM construction, event wiring, live count, per-row progress tracking

**`styles.css`** — Modal and overlay styles only. All selectors use the `#jbsc-` prefix to avoid collisions with Jira's AUI styles. No floating button or dropdown item styles (those inherit from Jira).

## Key Implementation Notes

### Page detection guard
Both conditions must pass: URL regex `/\/browse\/[A-Z][A-Z0-9_]*-\d+/` AND `<meta name="application-name">` containing "jira". This prevents activation on non-Jira sites that happen to have `/browse/` in their path.

### 4-strategy selector for "Create sub-task"
The injection code tries in order:
1. `document.getElementById('create-subtask')` — reliable on most Jira DC versions
2. `.issueaction-create-subtask` class selector
3. Text scan (`/create sub.?task/i`) inside `#opsbar-operations_more_drop`
4. Text scan across all `<a>` on the page (last resort)

### `X-Atlassian-Token: no-check`
This header is required on all POST requests to the Jira REST API from same-origin browser scripts. It tells Jira's CSRF filter to skip the token check for REST API calls. Do not remove it — requests will get 403 without it.

### `createmeta` dual-endpoint fallback
The primary endpoint `/rest/api/2/issue/createmeta/{projectKey}/issuetypes` was introduced in Jira DC 9.0. The fallback `/rest/api/2/issue/createmeta?projectKeys=...&expand=projects.issuetypes` covers Jira DC 8.x and older. Both are tried automatically.

### 175ms delay between creates
A small sleep is added between successive `POST /rest/api/2/issue` calls to avoid triggering Jira's rate limiter on large batches. Adjust `DELAY_MS` at the top of `content.js` if needed.

### SPA navigation
Jira's issue view is a SPA. URL changes do not cause a full page reload. The extension patches `history.pushState` and `history.replaceState` and listens to `popstate` to detect navigation, remove the injected menu item, and re-inject it for the new issue. A 300ms delay before re-injection gives Jira time to render the new page's DOM.

## Jira API Compatibility

| Jira DC version | `createmeta` endpoint used |
|---|---|
| 9.0 and above | `/rest/api/2/issue/createmeta/{projectKey}/issuetypes` |
| 8.x and older | `/rest/api/2/issue/createmeta?projectKeys=...&expand=projects.issuetypes` |

Jira Cloud is not a supported target (different UI, different auth model).
