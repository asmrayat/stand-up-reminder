# Stand Up Reminder — Chrome Extension

A Chrome extension that reminds you to stand up and stretch after every work session. Built for desk workers who lose track of time.

## What it does

- Runs a **work session** (default: 20 minutes), then triggers a **break** (default: 60 seconds).
- During the break, a **full-screen blurred overlay** appears on **every open tab** with a countdown and a "Stand up" message.
- A **Skip break** button is always there in case something urgent comes up.
- When the break countdown hits 0, the overlay **doesn't auto-dismiss** — it switches to a red "Break's over" state and starts **counting UP** as overtime. The next session starts only when you click **Resume work**.
- The extension badge shows the **remaining time** in the toolbar (or `+overtime` once the break is up).
- The timer **auto-pauses** when you step away during a work session (Chrome detects you're idle/away) and resumes when you're back. *During overtime, the count-up keeps running — that's the whole point.*

## Daily log

The popup shows a **Today** section that tracks:

- **Sessions** — work + break pairs you completed (counted when you Resume, or when you Skip a break).
- **Stand-ups** — number of times you actually came back via Resume (Skip doesn't count).
- **Extra break** — total time you spent past the planned break duration.

The log resets automatically at local midnight. There's a small **Reset** button if you want to clear it manually.

## Installation (Developer Mode, for testing)

1. Open Chrome and go to `chrome://extensions`
2. Toggle **Developer mode** on (top-right corner)
3. Click **Load unpacked**
4. Select the `stand-up-reminder` folder
5. The extension icon appears in your toolbar — pin it for easy access

## Usage

1. Click the extension icon in the toolbar
2. Adjust the **Session** (minutes) and **Break** (seconds) values if you'd like — defaults are 20 min / 60 sec
3. Click **Save settings** (only needed if you changed the defaults)
4. Click **Start**
5. The badge starts counting down. When the session ends, every open tab gets the overlay until the break finishes.

## Files

| File | Purpose |
|---|---|
| `manifest.json` | Extension manifest (Manifest V3) |
| `background.js` | Service worker — timer logic, alarms, idle detection, badge |
| `content.js` | Injected into every page — renders the overlay |
| `popup.html/.css/.js` | Settings popup |
| `icons/` | Extension icons (16/48/128 px) |
| `PRIVACY.md` | Privacy policy (hosted online and linked in the Web Store listing) |

## Notes

- The overlay can't be shown on `chrome://` pages, the Chrome Web Store, or other internal pages — Chrome blocks content scripts there. It will still show on every regular tab.
- Settings changes apply at the **start of the next session**, not immediately.
- The extension uses the `chrome.alarms` API, so timers survive the service worker being suspended.
- All data stays on your device. See `PRIVACY.md`.
# stand-up-reminder
