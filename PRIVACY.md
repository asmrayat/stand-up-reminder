# Privacy Policy — Stand Up Reminder

_Last updated: May 17, 2026_

Stand Up Reminder is a Chrome extension that reminds you to take a break from your desk. This policy explains exactly what data the extension touches.

## What we collect

**Nothing.** The extension does not collect, transmit, sell, or share any personal information.

## What is stored locally

The extension uses Chrome's local storage (`chrome.storage.local`) to remember:

- Your session and break duration preferences
- The current timer state, so timers survive Chrome restarts
- A simple count of today's completed sessions, stand-ups, and total extra-break time (resets at local midnight)

All of this data stays on your device. It never leaves your browser. It is not sent to any server, including any server operated by the developer.

## Permissions and why they exist

- **`alarms`** — schedules the end-of-session and end-of-break timers so they keep working when the service worker sleeps.
- **`storage`** — stores your settings and daily log on your device.
- **`scripting`** — injects the break overlay into pages that were already open when a break begins.
- **`idle`** — detects when you step away so the work-session timer can auto-pause and resume.
- **Host permission (`<all_urls>`)** — the break overlay needs to appear on whatever tab you happen to be looking at when the break starts. The extension only reads the URL of each open tab to decide whether the page is a regular web page (where it can show the overlay) or a restricted Chrome page (where it can't). No page content is ever read, transmitted, or stored.

## Third parties

The extension does not contact any third-party server, analytics provider, or ad network. There are no trackers, no telemetry, no remote code.

## Children's privacy

The extension is suitable for all ages and does not knowingly collect any information from anyone, including children.

## Changes

If this policy changes, the updated version will be published at the same URL and the "Last updated" date above will be revised.

## Contact

For questions about this policy, please contact the developer through the extension's Chrome Web Store listing.
