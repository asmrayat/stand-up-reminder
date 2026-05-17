// ============================================================
// Stand Up Reminder — Popup logic (v1.2)
// ============================================================

const $ = (id) => document.getElementById(id);
const sessionInput = $('session-input');
const breakMinInput = $('break-min-input');
const breakSecInput = $('break-sec-input');
const startBtn = $('start-btn');
const stopBtn = $('stop-btn');
const resumeBtn = $('resume-btn');
const saveBtn = $('save-btn');
const saveHint = $('save-hint');
const timerDisplay = $('timer-display');
const statusText = $('status-text');
const statusDot = $('status-dot');
const logSessions = $('log-sessions');
const logStandups = $('log-standups');
const logExtra = $('log-extra');
const resetLogBtn = $('reset-log-btn');

let refreshHandle = null;

function formatTime(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function formatOvertime(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `+${min}:${String(sec).padStart(2, '0')}`;
}

function formatExtraTotal(sec) {
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  if (min < 60) return rem === 0 ? `${min}m` : `${min}m ${rem}s`;
  const hr = Math.floor(min / 60);
  const mm = min % 60;
  return mm === 0 ? `${hr}h` : `${hr}h ${mm}m`;
}

async function send(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => resolve(response));
  });
}

function renderLog(log) {
  if (!log) return;
  logSessions.textContent = log.sessions || 0;
  logStandups.textContent = log.standUps || 0;
  logExtra.textContent = formatExtraTotal(log.extraBreakSec || 0);
}

async function refresh() {
  const data = await send({ type: 'GET_STATE' });
  if (!data) return;

  // Update inputs only if they're not currently focused (so user can edit)
  if (document.activeElement !== sessionInput) {
    sessionInput.value = data.sessionMinutes;
  }
  const totalSec = data.breakSeconds || 0;
  const bMin = Math.floor(totalSec / 60);
  const bSec = totalSec % 60;
  if (document.activeElement !== breakMinInput) {
    breakMinInput.value = bMin;
  }
  if (document.activeElement !== breakSecInput) {
    breakSecInput.value = bSec;
  }

  // Status + timer
  statusDot.className = 'badge-dot';
  timerDisplay.classList.remove('overtime');
  resumeBtn.hidden = true;

  if (data.state === 'idle') {
    statusText.textContent = 'Not running';
    timerDisplay.textContent = '--:--';
    startBtn.disabled = false;
    stopBtn.disabled = true;
  } else if (data.state === 'overtime') {
    statusDot.classList.add('overtime');
    statusText.textContent = 'Break is over — click Resume';
    timerDisplay.classList.add('overtime');
    timerDisplay.textContent = formatOvertime(data.overtimeMs || 0);
    startBtn.disabled = true;
    stopBtn.disabled = false;
    resumeBtn.hidden = false;
  } else {
    timerDisplay.textContent = formatTime(data.remainingMs);
    startBtn.disabled = true;
    stopBtn.disabled = false;

    if (data.paused) {
      statusDot.classList.add('paused');
      statusText.textContent = 'Paused (you stepped away)';
    } else if (data.state === 'working') {
      statusDot.classList.add('working');
      statusText.textContent = 'Working — break coming up';
    } else if (data.state === 'break') {
      statusDot.classList.add('break');
      statusText.textContent = 'Break time — stand up!';
    }
  }

  renderLog(data.log);
}

startBtn.addEventListener('click', async () => {
  await send({ type: 'START' });
  refresh();
});

stopBtn.addEventListener('click', async () => {
  await send({ type: 'STOP' });
  refresh();
});

resumeBtn.addEventListener('click', async () => {
  await send({ type: 'RESUME_BREAK' });
  refresh();
});

resetLogBtn.addEventListener('click', async () => {
  const res = await send({ type: 'RESET_LOG' });
  if (res && res.log) renderLog(res.log);
});

saveBtn.addEventListener('click', async () => {
  const sessionMinutes = Math.max(1, Math.min(180, parseInt(sessionInput.value, 10) || 20));

  const bMinRaw = Math.max(0, Math.min(60, parseInt(breakMinInput.value, 10) || 0));
  const bSecRaw = Math.max(0, Math.min(59, parseInt(breakSecInput.value, 10) || 0));
  // Clamp combined to [10s, 3600s] so the break is meaningful but not absurd
  let breakSeconds = bMinRaw * 60 + bSecRaw;
  breakSeconds = Math.max(10, Math.min(3600, breakSeconds));
  const finalMin = Math.floor(breakSeconds / 60);
  const finalSec = breakSeconds % 60;

  sessionInput.value = sessionMinutes;
  breakMinInput.value = finalMin;
  breakSecInput.value = finalSec;

  await send({ type: 'SAVE_SETTINGS', sessionMinutes, breakSeconds });
  saveHint.textContent = '✓ Saved — applies next session';
  setTimeout(() => { saveHint.textContent = ''; }, 2200);
});

const testBtn = $('test-btn');
if (testBtn) {
  testBtn.addEventListener('click', async () => {
    await send({ type: 'TEST_BREAK' });
    window.close();
  });
}

// Refresh every second while popup is open
refresh();
refreshHandle = setInterval(refresh, 1000);

window.addEventListener('unload', () => {
  if (refreshHandle) clearInterval(refreshHandle);
});
