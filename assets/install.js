/* ─────────────────────────────────────────────────────────
   TanaInstall — "play as a web app" helper (global `TanaInstall`).
   Shared by index.html (room 1) and zombies.html (Zombie Street).
   Plain script, no build step.

   • Detection: isStandalone / platform / inApp / iosMajor.
   • A full-screen how-to popup (same see-through style as the game's other
     popups) with a variant per device: iPhone Safari (iOS 26+ / older), iPad,
     Android Chrome, in-app browsers.
   • Never shows anything on desktop, or when already running as an installed app.
   • App badge: isStandalone is what the leaderboard uses to tag a score from_app,
     and the first standalone launch shows a one-time "APP BADGE UNLOCKED" toast.
   ───────────────────────────────────────────────────────── */
(function () {
  'use strict';

  const DISMISS_KEY   = 'tana-install-dismissed';
  const DISMISS_MS    = 3 * 24 * 60 * 60 * 1000; // stay quiet for 3 days after "PLAY IN BROWSER"
  const BADGE_KEY     = 'tana-app-badge-toast';
  const ASSET_DIR     = 'assets/install/';
  const CHROME_INTENT = 'intent://popstar-life.com#Intent;scheme=https;package=com.android.chrome;end';

  // ── Detection ──
  const ua = navigator.userAgent || '';
  const isStandalone = (function () {
    try { if (window.matchMedia('(display-mode: standalone)').matches) return true; } catch (_) {}
    return navigator.standalone === true;
  })();
  const platform = (function () {
    if (/iPhone|iPod/.test(ua)) return 'iphone';
    if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ipad';
    if (/Android/.test(ua)) return 'android';
    return 'desktop';
  })();
  const inApp = /Instagram|FBAN|FBAV|FB_IAB|TikTok|musical_ly|Snapchat|Twitter|Line\/|LinkedInApp/i.test(ua);
  const isInstagram = /Instagram/i.test(ua);
  const iosMajor = (function () {
    if (platform !== 'iphone' && platform !== 'ipad') return null;
    const m = ua.match(/OS (\d+)[_\d]*/);   // "OS 26_0" style token (iPadOS in desktop mode has none → null)
    return m ? parseInt(m[1], 10) : null;
  })();
  const isMobile = platform !== 'desktop';

  // Android Chrome's install prompt — capture it as soon as it fires.
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; });
  window.addEventListener('appinstalled', () => { deferredPrompt = null; close(); });

  // ── Storage helpers ──
  function wasDismissedRecently() {
    try {
      const t = parseInt(localStorage.getItem(DISMISS_KEY), 10);
      return !isNaN(t) && Date.now() - t < DISMISS_MS;
    } catch (_) { return false; }
  }
  function markDismissed() { try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch (_) {} }

  // Never anything on desktop or when already installed.
  function canShow() { return isMobile && !isStandalone; }
  // Touch devices where the "FULL SCREEN" HUD button / game-over line make sense.
  function touchBrowser() {
    let coarse = false;
    try { coarse = window.matchMedia('(hover: none) and (pointer: coarse)').matches; } catch (_) {}
    return canShow() && coarse;
  }

  // ── Safe-area insets in px (for canvas HUDs; CSS elements use env() directly) ──
  let _probe = null;
  function safeInsets() {
    try {
      if (!_probe) {
        _probe = document.createElement('div');
        _probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
          'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
        document.body.appendChild(_probe);
      }
      const cs = getComputedStyle(_probe);
      return { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 };
    } catch (_) { return { t: 0, r: 0, b: 0, l: 0 }; }
  }

  // ── Styles ──
  const CSS = `
#ti-overlay { position: fixed; inset: 0; z-index: 450; display: none; align-items: center; justify-content: center;
  background: rgba(5,5,10,0.90);
  padding: max(env(safe-area-inset-top,0px),10px) max(env(safe-area-inset-right,0px),10px) max(env(safe-area-inset-bottom,0px),10px) max(env(safe-area-inset-left,0px),10px);
  font-family: 'Press Start 2P', monospace; color: #b0b8d0; touch-action: manipulation; }
#ti-overlay.on { display: flex; }
#ti-overlay * { touch-action: manipulation; }
#ti-box { width: min(720px, 100%); max-height: 100%; background: #09091a; border: 2px solid #4ecca3;
  box-shadow: 0 0 40px rgba(78,204,163,0.3); padding: 14px 18px 12px; overflow: hidden; }
#ti-title { font-size: 10px; color: #4ecca3; text-shadow: 0 0 8px rgba(78,204,163,0.4); text-align: center;
  padding-bottom: 8px; margin-bottom: 10px; border-bottom: 1px solid #1a2a20; line-height: 1.5; }
#ti-main { display: flex; flex-direction: column; gap: 10px; align-items: stretch; }
#ti-left  { flex: 0 0 auto; display: flex; align-items: center; justify-content: center; }
#ti-right { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
@media (orientation: landscape) {
  #ti-main { flex-direction: row; align-items: center; gap: 18px; }
  #ti-left { flex: 0 0 42%; }
}
#ti-overlay.nophone #ti-left { display: none; }

/* CSS phone mockup: landscape phone, 2.17:1, dark 6px bezel, notch pill on the left edge */
.ti-phone { position: relative; width: 100%; max-width: 300px; aspect-ratio: 2.17 / 1; border: 6px solid #1a1a22;
  border-radius: 16px; background: #000; overflow: hidden; box-shadow: 0 0 0 1px #2c2c38, 0 6px 18px rgba(0,0,0,0.6); }
.ti-phone .ti-game { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; }
.ti-phone .ti-bars { position: absolute; left: 0; top: 0; width: 100%; height: 27.4%; object-fit: fill; display: block;
  animation: tiBars 4.3s ease-in-out infinite; }
.ti-phone .ti-notch { position: absolute; left: 3px; top: 50%; width: 5px; height: 22%; transform: translateY(-50%);
  background: #05050a; border-radius: 3px; z-index: 2; }
/* bars visible 1.4s → slide up + fade 0.5s → game alone 2s → fade back in 0.4s */
@keyframes tiBars {
  0%, 32.5% { opacity: 1; transform: translateY(0); }
  44%       { opacity: 0; transform: translateY(-100%); }
  90.5%     { opacity: 0; transform: translateY(-100%); }
  90.6%     { opacity: 0; transform: translateY(0); }
  100%      { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) { .ti-phone .ti-bars { animation: none; opacity: 0; } }

#ti-reward { font-size: 7px; color: #f9c74f; line-height: 1.7; text-align: center; text-shadow: 0 0 8px rgba(249,199,79,0.35); }
#ti-steps { list-style: none; display: flex; flex-direction: column; gap: 5px; }
#ti-steps li { display: flex; align-items: center; gap: 7px; font-size: 7px; line-height: 1.5; color: #d6dcf0; }
.ti-num { flex: none; width: 10px; color: #f9c74f; text-align: center; }
.ti-chip { flex: none; width: 28px; height: 28px; border-radius: 7px; background: #141428; border: 1px solid #25254a;
  display: flex; align-items: center; justify-content: center; color: #4ecca3; font-size: 9px; }
.ti-chip img { width: 18px; height: 18px; display: block; }
.ti-land { display: inline; } .ti-port { display: none; }
@media (orientation: portrait) { .ti-land { display: none; } .ti-port { display: inline; } }
.ti-chip .ti-land, .ti-chip .ti-port { display: none; }
.ti-chip .ti-land { display: block; }
@media (orientation: portrait) { .ti-chip .ti-land { display: none; } .ti-chip .ti-port { display: block; } }
#ti-note { font-size: 6px; color: #7a8099; line-height: 1.7; }
#ti-btns { display: flex; flex-wrap: wrap; gap: 6px; }
#ti-btns button { flex: 1 1 auto; min-height: 36px; font-family: inherit; font-size: 8px; padding: 8px 10px; cursor: pointer;
  background: rgba(78,204,163,0.10); border: 1px solid #4ecca3; color: #4ecca3; }
#ti-btns button:active { background: rgba(78,204,163,0.30); }
#ti-btns button.ti-primary { background: rgba(78,204,163,0.22); }
#ti-skip { align-self: center; background: none; border: none; color: #7a8099; font-family: inherit; font-size: 7px;
  text-decoration: underline; cursor: pointer; padding: 8px 10px; min-height: 36px; }
#ti-skip:active { color: #b0b8d0; }

#ti-hud { position: fixed; top: calc(env(safe-area-inset-top,0px) + 38px); right: calc(env(safe-area-inset-right,0px) + 8px);
  height: 24px; padding: 0 8px; z-index: 50; display: none; align-items: center; font-family: 'Press Start 2P', monospace;
  font-size: 7px; color: #f9c74f; background: rgba(5,5,10,0.72); border: 1px solid #f9c74f; box-shadow: 0 0 10px rgba(249,199,79,0.20);
  cursor: pointer; touch-action: manipulation; outline: none; white-space: nowrap; }
#ti-hud.on { display: flex; }
#ti-toast { position: fixed; left: 50%; top: calc(env(safe-area-inset-top,0px) + 14px); transform: translate(-50%, -20px); z-index: 460;
  font-family: 'Press Start 2P', monospace; font-size: 9px; color: #f9c74f; background: rgba(5,5,10,0.92); border: 2px solid #f9c74f;
  padding: 10px 14px; box-shadow: 0 0 24px rgba(249,199,79,0.45); opacity: 0; pointer-events: none; transition: opacity .3s, transform .3s; text-align: center; }
#ti-toast.on { opacity: 1; transform: translate(-50%, 0); }
@media (orientation: portrait) and (hover: none) and (pointer: coarse) { #ti-hud { display: none !important; } }
`;
  let styled = false;
  function injectStyle() {
    if (styled) return; styled = true;
    const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s);
  }

  // ── DOM helpers ──
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  const img = (name, cls) => { const i = new Image(); i.src = ASSET_DIR + name; i.alt = ''; i.draggable = false; if (cls) i.className = cls; return i; };
  function chip(content) { // content: file name | [landFile, portFile] | text
    const c = el('div', 'ti-chip');
    if (Array.isArray(content)) {
      const a = img(content[0], 'ti-land'), b = img(content[1], 'ti-port'); c.append(a, b);
    } else if (/\.png$/.test(content)) c.appendChild(img(content));
    else c.textContent = content;
    return c;
  }
  // step: { icon, text } where text may be a string or [landscapeText, portraitText]
  function stepRow(n, st) {
    const li = el('li');
    li.appendChild(el('span', 'ti-num', String(n)));
    li.appendChild(chip(st.icon));
    const t = el('span');
    if (Array.isArray(st.text)) { t.append(el('span', 'ti-land', st.text[0]), el('span', 'ti-port', st.text[1])); }
    else t.textContent = st.text;
    li.appendChild(t);
    return li;
  }

  // ── Variants ──
  function variantKey() {
    if (inApp) return 'E';
    if (platform === 'android') return 'D';
    if (platform === 'ipad') return 'C';
    if (platform === 'iphone') return (iosMajor != null && iosMajor >= 26) ? 'A' : 'B';
    return null;
  }
  function stepsFor(key) {
    const ios26 = iosMajor != null && iosMajor >= 26;
    const iosSteps = ios26 ? [
      { icon: ['icon_share.png', 'icon_more_safari.png'], text: ['Tap Share at the top', 'Tap ••• then Share'] },
      { icon: 'icon_add_home.png', text: 'Tap "Add to Home Screen"' },
      { icon: '✓', text: 'Keep "Open as Web App" ON, tap Add' },
      { icon: 'icon_add_home.png', text: 'Open TANA.EXE from your home screen' },
    ] : [
      { icon: 'icon_share.png', text: 'Tap Share' },
      { icon: 'icon_add_home.png', text: 'Tap "Add to Home Screen"' },
      { icon: '✓', text: 'Tap Add' },
      { icon: 'icon_add_home.png', text: 'Open it from your home screen' },
    ];
    if (key === 'A' || key === 'B' || key === 'C') return iosSteps;
    if (key === 'D') return deferredPrompt ? null : [
      { icon: '⋮', text: 'Tap ⋮ then "Install app" or "Add to Home screen"' },
      { icon: '✓', text: 'Tap Install' },
      { icon: 'icon_add_home.png', text: 'Open TANA.EXE from your home screen' },
    ];
    if (key === 'E') {
      if (isInstagram) return [
        { icon: 'icon_more_ig.png', text: 'Tap ••• at the top right' },
        { icon: 'icon_external.png', text: 'Tap "Open in external browser"' },
      ];
      return [{ icon: 'icon_external.png', text: platform === 'android' || platform === 'iphone' || platform === 'ipad'
        ? "Open this page in Safari / Chrome from the app's menu" : 'Open this page in your browser' }];
    }
    return [];
  }

  // ── Actions ──
  function fullscreenTarget() {
    return document.getElementById('game-container') || document.documentElement;
  }
  function goFullscreen() {
    const t = fullscreenTarget();
    const req = t.requestFullscreen || t.webkitRequestFullscreen || t.webkitRequestFullScreen || t.mozRequestFullScreen;
    if (!req) return Promise.resolve(false);
    let p;
    try { p = req.call(t); } catch (_) { return Promise.resolve(false); }
    return Promise.resolve(p).then(() => {
      try { if (screen.orientation && screen.orientation.lock) return screen.orientation.lock('landscape').catch(() => {}); } catch (_) {}
    }).then(() => true, () => false);
  }
  function copyLink(btn) {
    const done = () => { const old = btn.textContent; btn.textContent = 'COPIED'; setTimeout(() => { btn.textContent = old; }, 1800); };
    const fallback = () => {
      try {
        const ta = document.createElement('textarea'); ta.value = location.href; ta.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done();
      } catch (_) {}
    };
    try { navigator.clipboard.writeText(location.href).then(done, fallback); } catch (_) { fallback(); }
  }

  // ── Popup ──
  let overlay = null;
  function close() { if (overlay) overlay.classList.remove('on'); }

  function build(key) {
    injectStyle();
    if (!overlay) { overlay = el('div'); overlay.id = 'ti-overlay'; document.body.appendChild(overlay); }
    overlay.textContent = '';
    overlay.classList.toggle('nophone', key === 'E');
    const box = el('div'); box.id = 'ti-box';
    box.appendChild(Object.assign(el('div', null, key === 'E' ? 'OPEN IN YOUR BROWSER FIRST' : 'FOR THE BEST EXPERIENCE'), { id: 'ti-title' }));

    const main = el('div'); main.id = 'ti-main';
    const left = el('div'); left.id = 'ti-left';
    const phone = el('div', 'ti-phone');
    phone.append(img('game_fullscreen.jpg', 'ti-game'), img('safari_bars.png', 'ti-bars'), el('div', 'ti-notch'));
    left.appendChild(phone);

    const right = el('div'); right.id = 'ti-right';
    if (key !== 'E') right.appendChild(Object.assign(el('div', null, 'PLAY FROM YOUR HOME SCREEN TO UNLOCK THE APP BADGE'), { id: 'ti-reward' }));
    const steps = stepsFor(key);
    if (steps) {
      const ol = el('ol'); ol.id = 'ti-steps';
      steps.forEach((st, i) => ol.appendChild(stepRow(i + 1, st)));
      right.appendChild(ol);
    } else if (key === 'D') {
      right.appendChild(Object.assign(el('div', null, 'TAP INSTALL TO ADD TANA.EXE TO YOUR HOME SCREEN'), { id: 'ti-note' }));
    }

    const btns = el('div'); btns.id = 'ti-btns';
    const add = (label, fn, primary) => { const b = el('button', primary ? 'ti-primary' : '', label); b.type = 'button'; b.addEventListener('click', () => fn(b)); btns.appendChild(b); return b; };
    let skipLabel = 'PLAY IN BROWSER', skipMark = true;
    if (key === 'E') {
      add('COPY LINK', copyLink, true);
      if (platform === 'android') add('OPEN IN CHROME', () => { location.href = CHROME_INTENT; });
      skipLabel = 'PLAY HERE ANYWAY'; skipMark = false;
    } else if (key === 'D') {
      if (deferredPrompt) add('INSTALL', () => {
        const p = deferredPrompt; deferredPrompt = null;
        try { p.prompt(); Promise.resolve(p.userChoice).then(() => close(), () => {}); } catch (_) {}
      }, true);
      add('FULL SCREEN', () => { goFullscreen().then(() => close()); }, !deferredPrompt);
    } else if (key === 'C') {
      add('FULL SCREEN', () => { goFullscreen().then(() => close()); }, true);
      add('GOT IT', () => { markDismissed(); close(); });
    } else {
      add('GOT IT', () => { markDismissed(); close(); }, true);
    }
    right.appendChild(btns);
    const skip = el('button', null, skipLabel); skip.id = 'ti-skip'; skip.type = 'button';
    skip.addEventListener('click', () => { if (skipMark) markDismissed(); close(); });
    right.appendChild(skip);

    main.append(left, right);
    box.appendChild(main);
    overlay.appendChild(box);
  }

  // Open the popup. Does nothing on desktop or when installed.
  function open() {
    if (!canShow()) return false;
    const key = variantKey();
    if (!key) return false;
    build(key);
    overlay.classList.add('on');
    return true;
  }

  // ── Automatic triggers ──
  // In-app browser: right on load, before the entry screen.
  function maybeShowInApp() { if (inApp && canShow()) return open(); return false; }
  // Regular mobile browser: once after the name/skin screen, unless dismissed in the last 3 days.
  function maybeShowAfterEntry() {
    if (!canShow() || inApp || wasDismissedRecently()) return false;
    return open();
  }

  // Small "📲 FULL SCREEN" button under the mute button (touch + not standalone).
  function mountHudButton() {
    if (!touchBrowser()) return null;
    injectStyle();
    let b = document.getElementById('ti-hud');
    if (!b) {
      b = el('button', null, '📲 FULL SCREEN'); b.id = 'ti-hud'; b.type = 'button';
      b.addEventListener('click', () => open());
      document.body.appendChild(b);
    }
    b.classList.add('on');
    return b;
  }

  // ── App badge toast (first standalone launch only) ──
  function showBadgeToastOnce() {
    if (!isStandalone) return;
    try { if (localStorage.getItem(BADGE_KEY)) return; localStorage.setItem(BADGE_KEY, '1'); } catch (_) { return; }
    injectStyle();
    const t = el('div', null, 'APP BADGE UNLOCKED'); t.id = 'ti-toast'; document.body.appendChild(t);
    requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('on')));
    setTimeout(() => { t.classList.remove('on'); setTimeout(() => t.remove(), 400); }, 3200);
  }

  window.TanaInstall = {
    isStandalone, platform, inApp, iosMajor, isMobile,
    canShow, touchBrowser, open, close, safeInsets,
    wasDismissedRecently, maybeShowInApp, maybeShowAfterEntry, mountHudButton, showBadgeToastOnce,
    variant: variantKey,
  };

  // Hook-ups that need the DOM: in-app popup on load, one-time badge toast.
  function ready() { maybeShowInApp(); showBadgeToastOnce(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();
})();
