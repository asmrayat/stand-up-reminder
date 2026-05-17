// ============================================================
// Stand Up Reminder — Background Service Worker  (v1.3)
// ============================================================

const DEFAULT_SETTINGS = {
  sessionMinutes: 20,
  breakSeconds: 60,
  enabled: true
};

const STATE = {
  IDLE: 'idle',
  WORKING: 'working',
  BREAK: 'break',
  OVERTIME: 'overtime' // break countdown finished, waiting for user to click Resume
};

function log(...args) {
  console.log('[StandUp]', ...args);
}

// ---------- Settings & state ----------

async function getSettings() {
  const stored = await chrome.storage.local.get(['sessionMinutes', 'breakSeconds', 'enabled', 'userStopped']);
  return {
    sessionMinutes: stored.sessionMinutes ?? DEFAULT_SETTINGS.sessionMinutes,
    breakSeconds: stored.breakSeconds ?? DEFAULT_SETTINGS.breakSeconds,
    enabled: stored.enabled ?? DEFAULT_SETTINGS.enabled,
    userStopped: stored.userStopped ?? false
  };
}

async function getTimerState() {
  const data = await chrome.storage.local.get(['state', 'phaseEndsAt', 'pausedRemainingMs', 'breakStartedAt']);
  return {
    state: data.state || STATE.IDLE,
    phaseEndsAt: data.phaseEndsAt || null,
    pausedRemainingMs: data.pausedRemainingMs || null,
    breakStartedAt: data.breakStartedAt || null
  };
}

async function setTimerState(updates) {
  await chrome.storage.local.set(updates);
}

// ---------- Daily log ----------

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function getDailyLog() {
  const { dailyLog } = await chrome.storage.local.get(['dailyLog']);
  const today = todayKey();
  if (!dailyLog || dailyLog.date !== today) {
    const fresh = { date: today, sessions: 0, standUps: 0, extraBreakSec: 0 };
    await chrome.storage.local.set({ dailyLog: fresh });
    return fresh;
  }
  return dailyLog;
}

async function updateDailyLog(patch) {
  const current = await getDailyLog();
  const next = {
    date: current.date,
    sessions: current.sessions + (patch.sessions || 0),
    standUps: current.standUps + (patch.standUps || 0),
    extraBreakSec: current.extraBreakSec + (patch.extraBreakSec || 0)
  };
  await chrome.storage.local.set({ dailyLog: next });
  return next;
}

// ---------- Badge ----------

function formatBadge(seconds) {
  if (seconds <= 0) return '';
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.ceil(seconds / 60);
  return `${mins}m`;
}

async function updateBadge() {
  const { state, phaseEndsAt } = await getTimerState();
  if (state === STATE.IDLE) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }
  if (state === STATE.OVERTIME) {
    const overtimeMs = Date.now() - (phaseEndsAt || Date.now());
    const overtimeSec = Math.max(0, Math.floor(overtimeMs / 1000));
    chrome.action.setBadgeText({ text: `+${formatBadge(overtimeSec) || '0s'}` });
    chrome.action.setBadgeBackgroundColor({ color: '#dc2626' });
    return;
  }
  if (!phaseEndsAt) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }
  const remainingMs = phaseEndsAt - Date.now();
  const remainingSec = Math.max(0, Math.ceil(remainingMs / 1000));
  chrome.action.setBadgeText({ text: formatBadge(remainingSec) });
  chrome.action.setBadgeBackgroundColor({
    color: state === STATE.BREAK ? '#d97706' : '#0f766e'
  });
}

// ---------- Tab injection ----------

function isInjectableUrl(url) {
  if (!url) return false;
  return !(
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('edge://') ||
    url.startsWith('about:') ||
    url.startsWith('https://chrome.google.com/webstore') ||
    url.startsWith('https://chromewebstore.google.com') ||
    url.startsWith('view-source:')
  );
}

/**
 * Inject content.js into a tab. Styles live inside the Shadow DOM
 * built by content.js itself, so we don't need a separate CSS file.
 */
async function ensureInjected(tabId, url) {
  if (!isInjectableUrl(url)) return false;
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      files: ['content.js']
    });
    return true;
  } catch (e) {
    log('inject failed for tab', tabId, url, e.message);
    return false;
  }
}

async function showOverlayInTab(tabId, url, payload) {
  const injected = await ensureInjected(tabId, url);
  if (!injected) return;
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'SHOW_OVERLAY',
      ...payload
    });
  } catch (e) {
    log('sendMessage SHOW failed', tabId, e.message);
  }
}

async function hideOverlayInTab(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'HIDE_OVERLAY' });
  } catch (e) {
    // tab may not have script loaded — fine
  }
}

async function showOverlayEverywhere(payload) {
  const tabs = await chrome.tabs.query({});
  log(`Showing overlay on ${tabs.length} tabs`);
  await Promise.all(tabs.map(t => showOverlayInTab(t.id, t.url, payload)));
}

async function updateOverlayEverywhere(payload) {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(async (t) => {
    try {
      await chrome.tabs.sendMessage(t.id, { type: 'UPDATE_OVERLAY', ...payload });
    } catch (e) { /* tab without content script — ignore */ }
  }));
}

async function hideOverlayEverywhere() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(t => hideOverlayInTab(t.id)));
}

function breakOverlayPayload(breakSeconds, endsAt) {
  return { phase: 'break', breakSeconds, endsAt };
}
function overtimeOverlayPayload(breakSeconds, breakEndedAt) {
  return { phase: 'overtime', breakSeconds, breakEndedAt };
}

// ---------- Timer control ----------

async function startSession() {
  const { sessionMinutes } = await getSettings();
  const endsAt = Date.now() + sessionMinutes * 60 * 1000;
  log(`Starting session: ${sessionMinutes} min`);
  await setTimerState({
    state: STATE.WORKING,
    phaseEndsAt: endsAt,
    pausedRemainingMs: null
  });
  await chrome.storage.local.set({ userStopped: false });
  chrome.alarms.create('phaseEnd', { when: endsAt });
  chrome.alarms.create('badgeTick', { periodInMinutes: 0.25 });
  updateBadge();
}

async function startBreak() {
  const { breakSeconds } = await getSettings();
  const now = Date.now();
  const endsAt = now + breakSeconds * 1000;
  log(`Starting break: ${breakSeconds} sec`);
  await setTimerState({
    state: STATE.BREAK,
    phaseEndsAt: endsAt,
    pausedRemainingMs: null,
    breakStartedAt: now
  });
  chrome.alarms.create('phaseEnd', { when: endsAt });
  chrome.alarms.create('badgeTick', { periodInMinutes: 0.05 });
  updateBadge();
  await showOverlayEverywhere(breakOverlayPayload(breakSeconds, endsAt));
}

async function enterOvertime() {
  const { breakSeconds } = await getSettings();
  const { phaseEndsAt } = await getTimerState();
  const breakEndedAt = phaseEndsAt || Date.now();
  log('Break countdown finished, entering overtime');
  await setTimerState({
    state: STATE.OVERTIME,
    phaseEndsAt: breakEndedAt,
    pausedRemainingMs: null
  });
  chrome.alarms.create('badgeTick', { periodInMinutes: 0.05 });
  updateBadge();
  await updateOverlayEverywhere(overtimeOverlayPayload(breakSeconds, breakEndedAt));
}

async function resumeFromBreak() {
  const { state, phaseEndsAt, breakStartedAt } = await getTimerState();
  if (state !== STATE.BREAK && state !== STATE.OVERTIME) {
    log('Resume ignored — not in break/overtime');
    return;
  }
  const { breakSeconds } = await getSettings();
  const now = Date.now();
  const actualBreakMs = breakStartedAt ? now - breakStartedAt : breakSeconds * 1000;
  const plannedMs = breakSeconds * 1000;
  const extraMs = Math.max(0, actualBreakMs - plannedMs);
  const extraSec = Math.round(extraMs / 1000);
  log(`Resume: actual break ${Math.round(actualBreakMs / 1000)}s, extra ${extraSec}s`);

  await updateDailyLog({ sessions: 1, standUps: 1, extraBreakSec: extraSec });
  await hideOverlayEverywhere();
  await chrome.storage.local.set({ breakStartedAt: null });
  await startSession();
}

async function stopAll() {
  log('User stopped timer');
  chrome.alarms.clearAll();
  await setTimerState({
    state: STATE.IDLE,
    phaseEndsAt: null,
    pausedRemainingMs: null,
    breakStartedAt: null
  });
  await chrome.storage.local.set({ userStopped: true });
  chrome.action.setBadgeText({ text: '' });
  await hideOverlayEverywhere();
}

async function pauseTimer() {
  const { state, phaseEndsAt } = await getTimerState();
  if (state === STATE.IDLE || !phaseEndsAt) return;
  const remainingMs = Math.max(0, phaseEndsAt - Date.now());
  log('Pausing, remaining:', Math.round(remainingMs / 1000), 's');
  chrome.alarms.clear('phaseEnd');
  chrome.alarms.clear('badgeTick');
  await setTimerState({
    pausedRemainingMs: remainingMs,
    phaseEndsAt: null
  });
  chrome.action.setBadgeText({ text: '⏸' });
  chrome.action.setBadgeBackgroundColor({ color: '#6b7280' });
}

async function resumeTimer() {
  const { state, pausedRemainingMs } = await getTimerState();
  if (state === STATE.IDLE || pausedRemainingMs == null) return;
  log('Resuming, remaining:', Math.round(pausedRemainingMs / 1000), 's');
  const endsAt = Date.now() + pausedRemainingMs;
  await setTimerState({
    phaseEndsAt: endsAt,
    pausedRemainingMs: null
  });
  chrome.alarms.create('phaseEnd', { when: endsAt });
  chrome.alarms.create('badgeTick', {
    periodInMinutes: state === STATE.BREAK ? 0.05 : 0.25
  });
  updateBadge();
}

/**
 * Restore an in-flight timer, but DO NOT auto-start a fresh one.
 * Auto-starting on first install (or every Chrome launch) without
 * the user's consent is jarring — they get a full-screen overlay
 * on every tab 20 minutes after install with no idea why.
 *
 * Behavior:
 *   - If there's an active timer in storage, restore it (so Chrome
 *     restarts don't lose your in-progress session).
 *   - Otherwise, do nothing — wait for the user to click Start.
 */
async function restoreTimerIfRunning() {
  const { state, phaseEndsAt, pausedRemainingMs } = await getTimerState();

  if (state !== STATE.IDLE && phaseEndsAt && phaseEndsAt > Date.now()) {
    log('Restoring existing timer');
    chrome.alarms.create('phaseEnd', { when: phaseEndsAt });
    chrome.alarms.create('badgeTick', {
      periodInMinutes: state === STATE.BREAK ? 0.05 : 0.25
    });
    updateBadge();
    if (state === STATE.BREAK) {
      const { breakSeconds } = await getSettings();
      const remainingMs = phaseEndsAt - Date.now();
      await showOverlayEverywhere(breakOverlayPayload(Math.ceil(remainingMs / 1000), phaseEndsAt));
    }
    return;
  }

  if (state === STATE.OVERTIME) {
    log('Restoring overtime — waiting for Resume');
    const { breakSeconds } = await getSettings();
    chrome.alarms.create('badgeTick', { periodInMinutes: 0.05 });
    updateBadge();
    await showOverlayEverywhere(overtimeOverlayPayload(breakSeconds, phaseEndsAt || Date.now()));
    return;
  }

  if (pausedRemainingMs != null) {
    log('Restoring paused timer');
    chrome.action.setBadgeText({ text: '⏸' });
    chrome.action.setBadgeBackgroundColor({ color: '#6b7280' });
    return;
  }

  log('No timer to restore — waiting for user to start');
}

// ---------- Event listeners ----------

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'phaseEnd') {
    const { state } = await getTimerState();
    if (state === STATE.WORKING) await startBreak();
    else if (state === STATE.BREAK) await enterOvertime();
  } else if (alarm.name === 'badgeTick') {
    updateBadge();
  }
});

chrome.runtime.onInstalled.addListener(async (details) => {
  log('onInstalled:', details.reason);
  const stored = await chrome.storage.local.get(['sessionMinutes']);
  if (stored.sessionMinutes == null) {
    await chrome.storage.local.set(DEFAULT_SETTINGS);
  }
  chrome.idle.setDetectionInterval(60);

  // On fresh install, open the popup via a welcome action — don't
  // silently start a timer. On update or browser_update, just restore
  // any in-flight timer.
  if (details.reason === 'install') {
    log('Fresh install — waiting for user to click Start');
    // Badge stays empty until the user starts.
  } else {
    await restoreTimerIfRunning();
  }
});

chrome.runtime.onStartup.addListener(async () => {
  log('onStartup');
  chrome.idle.setDetectionInterval(60);
  await restoreTimerIfRunning();
});

// If a tab loads/navigates during a break or overtime, inject overlay into it.
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  const { state, phaseEndsAt } = await getTimerState();
  if (state === STATE.BREAK && phaseEndsAt) {
    const remainingMs = phaseEndsAt - Date.now();
    if (remainingMs <= 0) return;
    await showOverlayInTab(tabId, tab.url, breakOverlayPayload(Math.ceil(remainingMs / 1000), phaseEndsAt));
  } else if (state === STATE.OVERTIME) {
    const { breakSeconds } = await getSettings();
    await showOverlayInTab(tabId, tab.url, overtimeOverlayPayload(breakSeconds, phaseEndsAt || Date.now()));
  }
});

// Pause on idle/locked, resume on active. Don't pause during overtime —
// overtime IS the user being away, that's the whole point.
chrome.idle.onStateChanged.addListener(async (newState) => {
  const { enabled } = await getSettings();
  if (!enabled) return;
  const { state, phaseEndsAt, pausedRemainingMs } = await getTimerState();
  if (state === STATE.OVERTIME) return;
  if (newState === 'active') {
    if (pausedRemainingMs != null && state !== STATE.IDLE) await resumeTimer();
  } else {
    if (state !== STATE.IDLE && phaseEndsAt != null) await pauseTimer();
  }
});

// ---------- Messages from popup / content scripts ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case 'START':
          await chrome.storage.local.set({ userStopped: false });
          await startSession();
          sendResponse({ ok: true });
          break;
        case 'STOP':
          await stopAll();
          sendResponse({ ok: true });
          break;
        case 'SKIP_BREAK':
          await updateDailyLog({ sessions: 1 });
          await hideOverlayEverywhere();
          await chrome.storage.local.set({ breakStartedAt: null });
          await startSession();
          sendResponse({ ok: true });
          break;
        case 'RESUME_BREAK':
          await resumeFromBreak();
          sendResponse({ ok: true });
          break;
        case 'TEST_BREAK':
          await startBreak();
          sendResponse({ ok: true });
          break;
        case 'GET_STATE': {
          const settings = await getSettings();
          const timer = await getTimerState();
          const dailyLog = await getDailyLog();
          let remainingMs = 0;
          let overtimeMs = 0;
          if (timer.state === STATE.OVERTIME) {
            overtimeMs = Math.max(0, Date.now() - (timer.phaseEndsAt || Date.now()));
          } else if (timer.phaseEndsAt) {
            remainingMs = Math.max(0, timer.phaseEndsAt - Date.now());
          } else if (timer.pausedRemainingMs != null) {
            remainingMs = timer.pausedRemainingMs;
          }
          sendResponse({
            ...settings,
            state: timer.state,
            remainingMs,
            overtimeMs,
            paused: timer.pausedRemainingMs != null,
            log: dailyLog
          });
          break;
        }
        case 'GET_LOG': {
          const dailyLog = await getDailyLog();
          sendResponse({ ok: true, log: dailyLog });
          break;
        }
        case 'RESET_LOG': {
          const fresh = { date: todayKey(), sessions: 0, standUps: 0, extraBreakSec: 0 };
          await chrome.storage.local.set({ dailyLog: fresh });
          sendResponse({ ok: true, log: fresh });
          break;
        }
        case 'SAVE_SETTINGS':
          await chrome.storage.local.set({
            sessionMinutes: msg.sessionMinutes,
            breakSeconds: msg.breakSeconds
          });
          sendResponse({ ok: true });
          break;
        default:
          sendResponse({ ok: false, error: 'Unknown message type' });
      }
    } catch (e) {
      log('message handler error', e);
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true;
});
