# Contributing

## Reporting bugs

Open an [issue](../../issues) and describe:
- What you expected to happen
- What actually happened
- Your Jira version (e.g. DC v10.3.26) and Chrome version
- Any errors from the browser console (F12 → Console)

## Requesting a feature

Open an [issue](../../issues) with a clear description of what you want and why it would be useful. Please check existing issues first to avoid duplicates.

## Submitting a pull request

1. Open (or find) an issue for the feature or bug your PR addresses
2. Fork the repository and create a branch from `main`
3. Make your changes — the extension has no build step, so editing `content.js` or `styles.css` directly is all that's needed
4. Test by loading the extension unpacked in Chrome (see [Installation](README.md#installation)) and verifying the change on a real Jira issue page
5. Open a pull request that references the issue (e.g. `Closes #12`)

There are no automated tests — manual verification on a real Jira instance is the test suite.
