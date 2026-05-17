// ============================================================
// Stand Up Reminder — Content Script (v1.3)
// Renders a full-screen overlay using Shadow DOM so host page
// styles can't break it. Listens for SHOW/UPDATE/HIDE from background.
//
// Two phases:
//   - break:    countdown DOWN from breakSeconds, "Skip break" button
//   - overtime: count UP from breakEndedAt, "Resume" button
// ============================================================

(function () {
  if (window.__standUpReminderLoaded) {
    console.log('[StandUp] content already loaded');
    return;
  }
  window.__standUpReminderLoaded = true;
  console.log('[StandUp] content script loaded on', location.href);

  const HOST_ID = 'sur-overlay-host';
  let tickInterval = null;
  let currentShadow = null;

  // Phase state
  let phase = 'break';           // 'break' | 'overtime'
  let breakEndsAt = null;        // ms timestamp — when countdown hits 0
  let breakEndedAt = null;       // ms timestamp — when overtime started (used for count-up)
  let totalBreakSeconds = 60;

  const OVERLAY_STYLES = `
    :host {
      all: initial;
      position: fixed !important;
      inset: 0 !important;
      z-index: 2147483647 !important;
      display: block !important;
      pointer-events: auto !important;
    }
    .wrap {
      position: fixed;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      animation: surFadeIn 0.4s ease-out;
    }
    .wrap.leaving { animation: surFadeOut 0.25s ease-in forwards; }
    .backdrop {
      position: absolute;
      inset: 0;
      background: rgba(8, 12, 20, 0.65);
      backdrop-filter: blur(20px) saturate(1.1);
      -webkit-backdrop-filter: blur(20px) saturate(1.1);
    }
    .card {
      position: relative;
      z-index: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 18px;
      padding: 48px 56px;
      max-width: 520px;
      width: calc(100% - 40px);
      background: linear-gradient(180deg, #ffffff 0%, #f5f1ea 100%);
      border-radius: 24px;
      box-shadow:
        0 0 0 1px rgba(0, 0, 0, 0.06),
        0 24px 80px rgba(0, 0, 0, 0.5),
        0 0 60px rgba(217, 119, 6, 0.18);
      color: #1a1a1a;
      text-align: center;
      animation: surPopIn 0.5s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .card.overtime {
      box-shadow:
        0 0 0 1px rgba(0, 0, 0, 0.06),
        0 24px 80px rgba(0, 0, 0, 0.5),
        0 0 60px rgba(220, 38, 38, 0.22);
    }
    .eyebrow {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.22em;
      color: #d97706;
      text-transform: uppercase;
      margin: 0;
      transition: color 0.3s ease;
    }
    .card.overtime .eyebrow { color: #dc2626; }
    h1 {
      margin: 0;
      font-size: 56px;
      font-weight: 800;
      letter-spacing: -0.03em;
      line-height: 1;
      color: #0f172a;
    }
    .subtitle {
      margin: 0;
      font-size: 15px;
      line-height: 1.5;
      color: #525252;
      max-width: 340px;
    }
    .ring-wrap {
      position: relative;
      width: 160px;
      height: 160px;
      margin: 8px 0 4px;
    }
    .ring-wrap svg { transform: rotate(-90deg); }
    .ring-bg {
      fill: none;
      stroke: rgba(15, 23, 42, 0.08);
      stroke-width: 8;
    }
    .ring-fg {
      fill: none;
      stroke: #0f766e;
      stroke-width: 8;
      stroke-linecap: round;
      transition: stroke-dashoffset 0.4s linear, stroke 0.3s ease;
    }
    .card.overtime .ring-fg { stroke: #dc2626; }
    .timer-text {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 38px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      color: #0f172a;
      letter-spacing: -0.02em;
    }
    .card.overtime .timer-text { color: #dc2626; }
    .overtime-label {
      font-size: 12px;
      font-weight: 600;
      color: #dc2626;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      margin: -4px 0 0;
      min-height: 14px;
    }
    button {
      margin-top: 4px;
      padding: 12px 28px;
      font-size: 14px;
      font-weight: 600;
      color: #525252;
      background: transparent;
      border: 1.5px solid rgba(15, 23, 42, 0.15);
      border-radius: 999px;
      cursor: pointer;
      transition: all 0.2s ease;
      font-family: inherit;
    }
    button:hover {
      background: rgba(15, 23, 42, 0.05);
      border-color: rgba(15, 23, 42, 0.3);
      color: #0f172a;
    }
    button:active { transform: scale(0.97); }
    button.resume {
      background: #0f766e;
      color: white;
      border-color: #0f766e;
      padding: 14px 36px;
      font-size: 15px;
    }
    button.resume:hover {
      background: #115e59;
      border-color: #115e59;
      color: white;
    }
    .footer {
      margin: 4px 0 0;
      font-size: 12px;
      color: #a3a3a3;
      font-style: italic;
    }
    @keyframes surFadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes surFadeOut { from { opacity: 1; } to { opacity: 0; } }
    @keyframes surPopIn {
      from { opacity: 0; transform: translateY(12px) scale(0.96); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
  `;

  function formatMMSS(totalSec) {
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function buildOverlay() {
    const existing = document.getElementById(HOST_ID);
    if (existing) existing.remove();

    const host = document.createElement('div');
    host.id = HOST_ID;
    const shadow = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = OVERLAY_STYLES;
    shadow.appendChild(style);

    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    wrap.innerHTML = `
      <div class="backdrop"></div>
      <div class="card" id="card" role="dialog" aria-modal="true">
        <div class="eyebrow" id="eyebrow">TIME FOR A BREAK</div>
        <h1 id="headline">Stand up.</h1>
        <p class="subtitle" id="subtitle">Stretch your back, walk a few steps, look away from the screen.</p>
        <div class="ring-wrap">
          <svg viewBox="0 0 120 120" width="160" height="160" aria-hidden="true">
            <circle cx="60" cy="60" r="54" class="ring-bg"/>
            <circle cx="60" cy="60" r="54" class="ring-fg" id="ring-fg"/>
          </svg>
          <div class="timer-text" id="timer-text">0</div>
        </div>
        <div class="overtime-label" id="overtime-label"></div>
        <button type="button" id="action-btn">Skip break</button>
        <div class="footer">Your back will thank you.</div>
      </div>
    `;
    shadow.appendChild(wrap);

    document.documentElement.appendChild(host);

    shadow.getElementById('action-btn').addEventListener('click', () => {
      if (phase === 'overtime') {
        chrome.runtime.sendMessage({ type: 'RESUME_BREAK' });
      } else {
        chrome.runtime.sendMessage({ type: 'SKIP_BREAK' });
      }
    });

    return shadow;
  }

  function applyPhase(shadow) {
    if (!shadow) return;
    const card = shadow.getElementById('card');
    const eyebrow = shadow.getElementById('eyebrow');
    const headline = shadow.getElementById('headline');
    const subtitle = shadow.getElementById('subtitle');
    const overtimeLabel = shadow.getElementById('overtime-label');
    const btn = shadow.getElementById('action-btn');

    if (phase === 'overtime') {
      card.classList.add('overtime');
      eyebrow.textContent = "BREAK'S OVER";
      headline.textContent = 'Ready?';
      subtitle.textContent = 'Click Resume when you’re back at your desk. Extra time is being tracked.';
      overtimeLabel.textContent = 'EXTRA TIME';
      btn.textContent = 'Resume work';
      btn.classList.add('resume');
    } else {
      card.classList.remove('overtime');
      eyebrow.textContent = 'TIME FOR A BREAK';
      headline.textContent = 'Stand up.';
      subtitle.textContent = 'Stretch your back, walk a few steps, look away from the screen.';
      overtimeLabel.textContent = '';
      btn.textContent = 'Skip break';
      btn.classList.remove('resume');
    }
  }

  function tick() {
    if (!currentShadow) return;
    const textEl = currentShadow.getElementById('timer-text');
    const ringEl = currentShadow.getElementById('ring-fg');
    const circumference = 2 * Math.PI * 54;

    if (phase === 'break') {
      const remainingMs = (breakEndsAt || Date.now()) - Date.now();
      const remainingSec = Math.max(0, Math.ceil(remainingMs / 1000));
      if (textEl) textEl.textContent = formatMMSS(remainingSec);
      if (ringEl) {
        const progress = totalBreakSeconds > 0 ? remainingSec / totalBreakSeconds : 0;
        ringEl.style.strokeDasharray = circumference;
        ringEl.style.strokeDashoffset = circumference * (1 - progress);
      }
      if (remainingSec <= 0) {
        phase = 'overtime';
        breakEndedAt = breakEndsAt || Date.now();
        applyPhase(currentShadow);
      }
    } else {
      const overtimeMs = Date.now() - (breakEndedAt || Date.now());
      const overtimeSec = Math.max(0, Math.floor(overtimeMs / 1000));
      if (textEl) textEl.textContent = `+${formatMMSS(overtimeSec)}`;
      if (ringEl) {
        ringEl.style.strokeDasharray = circumference;
        ringEl.style.strokeDashoffset = 0;
      }
    }
  }

  function startTicker() {
    if (tickInterval) clearInterval(tickInterval);
    tick();
    tickInterval = setInterval(tick, 250);
  }

  function showOverlay(payload) {
    const incomingPhase = payload.phase || 'break';
    totalBreakSeconds = payload.breakSeconds || 60;

    if (incomingPhase === 'overtime') {
      phase = 'overtime';
      breakEndedAt = payload.breakEndedAt || Date.now();
      breakEndsAt = null;
    } else {
      phase = 'break';
      breakEndsAt = payload.endsAt || (Date.now() + totalBreakSeconds * 1000);
      breakEndedAt = null;
    }

    currentShadow = buildOverlay();
    applyPhase(currentShadow);
    startTicker();
    console.log('[StandUp] overlay shown, phase=', phase);
  }

  function updateOverlay(payload) {
    const incomingPhase = payload.phase || 'break';
    totalBreakSeconds = payload.breakSeconds || totalBreakSeconds;

    if (incomingPhase === 'overtime') {
      phase = 'overtime';
      breakEndedAt = payload.breakEndedAt || Date.now();
    } else {
      phase = 'break';
      breakEndsAt = payload.endsAt || breakEndsAt;
    }

    if (!currentShadow || !document.getElementById(HOST_ID)) {
      currentShadow = buildOverlay();
    }
    applyPhase(currentShadow);
    startTicker();
    console.log('[StandUp] overlay updated, phase=', phase);
  }

  function hideOverlay() {
    const host = document.getElementById(HOST_ID);
    if (host) {
      try {
        const shadow = host.shadowRoot;
        const wrap = shadow && shadow.querySelector('.wrap');
        if (wrap) wrap.classList.add('leaving');
      } catch (e) {}
      setTimeout(() => host.remove(), 250);
    }
    if (tickInterval) {
      clearInterval(tickInterval);
      tickInterval = null;
    }
    currentShadow = null;
    breakEndsAt = null;
    breakEndedAt = null;
    console.log('[StandUp] overlay hidden');
  }

  chrome.runtime.onMessage.addListener((msg) => {
    console.log('[StandUp] message received:', msg.type);
    if (msg.type === 'SHOW_OVERLAY') {
      showOverlay(msg);
    } else if (msg.type === 'UPDATE_OVERLAY') {
      updateOverlay(msg);
    } else if (msg.type === 'HIDE_OVERLAY') {
      hideOverlay();
    }
  });
})();
