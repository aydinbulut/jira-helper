# Jira Helpers — Claude Notes

## Overview

A Chrome MV3 extension for Jira Software Data Center (classic AUI-based UI). It injects a "Create multi-sub-task" menu item into the More dropdown on issue pages (`/browse/PROJ-123`). Clicking it opens a modal with a row-based table where each subtask has its own Summary, Component, and Estimate (hours) fields. All subtasks are created in one operation via the Jira REST API v2. The modal has zoom in/out buttons for screen sharing, with the zoom level persisted in `localStorage`.

## Loading and Testing in Chrome

1. Open `chrome://extensions` in Chrome
2. Enable **Developer mode** (toggle, top-right)
3. Click **Load unpacked** and select this directory (`jira-helpers/`)
4. Navigate to a Jira issue page and open the **More** dropdown — the new item appears after "Create sub-task"

After editing `content.js` or `styles.css`, click the reload icon on the extension card in `chrome://extensions`, then hard-refresh the Jira page (Cmd+Shift+R / Ctrl+Shift+R).

## File Architecture

**`manifest.json`** — MV3 manifest. Scoped to `"matches": ["https://*/*"]` — the extension injects on any HTTPS page, but the page-detection guard in `content.js` limits actual activation to Jira issue pages (`/browse/PROJ-123` URL pattern + `<meta name="application-name">` containing "jira").

**`content.js`** — All extension logic in a single IIFE. Responsibilities:
- Page detection guard (URL pattern + `<meta name="application-name">`)
- 4-strategy selector for finding the "Create sub-task" `<li>`
- Menu item injection with idempotency guard
- SPA navigation detection via `pushState`/`replaceState` override + `popstate`
- `MutationObserver` to handle lazy-rendered dropdowns
- Row-based modal UI: `buildRowsHeader()`, `buildComponentMultiSelect()`, `buildInputRow()`, `addRow()`, `validRows()`, `updateCreateBtn()`, `transformRowToResult()`
- Zoom controls: `loadZoomIndex()`, `applyZoom()` — use CSS `zoom` property on the modal element, persist in `localStorage`
- Combined keyboard handler (`modalKeyHandler` closure): Escape closes, `-`/`+` zoom when not in an input
- Jira REST API: `fetchProjectKey()`, `fetchSubtaskIssueTypeId()`, `fetchProjectComponents()`, `createSubtask()` (includes `components` and `timetracking`)
- `handleCreate()` — orchestrates pre-flight fetch, row collection, sequential creation with 175ms delay, in-place row transformation; accepts `cachedProjectKey` from the modal closure to skip a redundant `fetchProjectKey` call on Create

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
Required on all POST requests to the Jira REST API from same-origin browser scripts. It tells Jira's CSRF filter to skip the token check. Do not remove it — requests will get 403 without it.

### `createmeta` dual-endpoint fallback
The primary endpoint `/rest/api/2/issue/createmeta/{projectKey}/issuetypes` was introduced in Jira DC 9.0. The fallback `/rest/api/2/issue/createmeta?projectKeys=...&expand=projects.issuetypes` covers Jira DC 8.x and older. Both are tried automatically.

### Component and estimate fields
`createSubtask()` sends two additional fields beyond summary:
- `components: [{ name: componentName }]` — Jira matches by name; the component must exist in the project
- `timetracking: { originalEstimate: "Xh" }` — only sent if estimate > 0; Jira DC accepts the `Xh` string format

### Row-based UI
The modal starts with 3 empty rows. Each row (`buildInputRow()`) contains a text summary input (`flex: 1`), a custom tag-input component picker (`buildComponentMultiSelect()`), a number input for hours, and a delete button. Deleting the last row clears it instead of removing it. `validRows()` filters rows with non-empty summary — only those are submitted.

The component picker shows selected components as removable pill tags. A `▾` chevron opens an absolute-positioned dropdown listing all project components. `wrapper.setOptions(names)` replaces the dropdown options at runtime (called after the async fetch resolves). `wrapper._reset()` clears all tags (used by the delete-row handler).

### Component picker — dynamic loading
`fetchProjectComponents(projectKey)` calls `GET /rest/api/2/project/{projectKey}/components`, extracts component names, sorts them alphabetically, and returns the array.

In `openModal()`, two closure variables are declared: `loadedComponents` (null until fetch resolves) and `cachedProjectKey` (null until `fetchProjectKey` resolves). Immediately after the initial 3 rows are built, a non-blocking fetch chain runs: `fetchProjectKey` → `fetchProjectComponents` → `setOptions()` on all `.jbsc-component-select` widgets in the container.

On success, both closure vars are stored. Rows added via `+ Add row` call `setOptions(loadedComponents)` immediately if already resolved; otherwise they start in the "Loading components…" placeholder state and are updated when the fetch resolves (the handler re-queries all `.jbsc-component-select` elements at resolution time, picking up any newly added rows).

On fetch failure, `setOptions([])` clears the placeholder and `showModalError()` displays a banner — subtasks can still be created without a component.

### 175ms delay between creates
A small sleep between successive `POST /rest/api/2/issue` calls avoids triggering Jira's rate limiter on large batches. Adjust `DELAY_MS` at the top of `content.js` if needed.

### Zoom — CSS `zoom` property
`applyZoom()` sets `modal.style.zoom = ZOOM_LEVELS[index]`. The CSS `zoom` property (Chrome-native, non-standard) scales the element and affects layout — the modal physically grows and the overlay's flexbox re-centres it. This is intentionally used instead of `transform: scale` so that all click targets scale correctly. Four levels: 1.0, 1.2, 1.4, 1.6. The index is persisted in `localStorage` under `ZOOM_KEY` so it survives page reloads.

### Keyboard handler — `modalKeyHandler` closure
`handleEscapeKey` was replaced by a module-level `let modalKeyHandler = null`. In `openModal()`, it is assigned as a closure capturing `zoomIndex`, `modal`, `zoomOutBtn`, and `zoomInBtn`. This closure handles three keys:
- `Escape` → `closeModal()`
- `-` → zoom out (only if `document.activeElement` is not `INPUT`, `TEXTAREA`, or inside `.jbsc-component-select`)
- `+` → zoom in (same guard)

`closeModal()` removes the handler by reference and nulls it out, ensuring no leak across navigations.

### SPA navigation
Jira's issue view is a SPA. The extension patches `history.pushState` and `history.replaceState` and listens to `popstate` to detect navigation, remove the injected menu item, close any open modal, and re-inject for the new issue after a 300ms delay.

## Jira API Compatibility

| Jira DC version | `createmeta` endpoint used |
|---|---|
| 9.0 and above | `/rest/api/2/issue/createmeta/{projectKey}/issuetypes` |
| 8.x and older | `/rest/api/2/issue/createmeta?projectKeys=...&expand=projects.issuetypes` |

Jira Cloud is not a supported target (different UI, different auth model).

Only tested against **Jira DC v10.3.26**. Older versions may work via the fallback endpoint but are untested.
