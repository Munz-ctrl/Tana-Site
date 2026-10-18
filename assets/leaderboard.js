/* ─────────────────────────────────────────────────────────
   TanaBoard — shared Zombie Street leaderboard (global `TanaBoard`).
   Loaded by index.html and zombies.html AFTER the supabase-js UMD script.

   PRIVACY: the zombie_scores table is publicly readable. Email / phone are
   NEVER sent to Supabase — submit() only writes a fixed whitelist of
   non-contact columns. Contacts go ONLY to the Google Apps Script
   (linkContact → APPS_SCRIPT_URL).
   ───────────────────────────────────────────────────────── */
(function () {
  'use strict';

  const SUPABASE_URL = 'https://bqhltjtktpaoctymmjrc.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_75Z_fkmYckjBRFmI2jol6A_Czi0estn';
  // Same Apps Script web app index.html's "JOIN THE LIST" form posts to.
  const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwEYf5C0cHjYjpsourPimozxCCW7MUqtsdHMfEAir4EORERFxE9iAcivcRHGUxoe8U9FQ/exec';

  const TABLE        = 'zombie_scores';
  const IDS_KEY      = 'tana-my-score-ids';
  const CONTACT_KEY  = 'tana-contact';
  const MAX_SAVED_IDS = 50;
  const TOP_N        = 10;
  const BOARD_TZ     = 'America/New_York';

  let _sb = null;
  function client() {
    if (!_sb) _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    return _sb;
  }

  // ── localStorage helpers (all try/catch — private mode etc.) ──
  function getIds() {
    try {
      const a = JSON.parse(localStorage.getItem(IDS_KEY) || '[]');
      return Array.isArray(a) ? a : [];
    } catch (_) { return []; }
  }
  function saveId(id) {
    try {
      const ids = getIds().filter(x => String(x) !== String(id));
      ids.push(id);
      localStorage.setItem(IDS_KEY, JSON.stringify(ids.slice(-MAX_SAVED_IDS)));
    } catch (_) {}
  }
  function getContact() {
    try { return localStorage.getItem(CONTACT_KEY) || ''; } catch (_) { return ''; }
  }

  // ── Week boundary: Monday 00:00 America/New_York, as an ISO UTC string ──
  const _etFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: BOARD_TZ, hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short',
  });
  const _DOW = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  function etParts(ms) {
    const p = {};
    for (const part of _etFmt.formatToParts(new Date(ms))) p[part.type] = part.value;
    return {
      y: +p.year, mo: +p.month, d: +p.day,
      h: +p.hour % 24, mi: +p.minute, s: +p.second,
      dow: _DOW[p.weekday],
    };
  }
  // ET wall clock − UTC at instant `ms` (−4h in EDT, −5h in EST), in ms.
  function etOffsetMs(ms) {
    const p = etParts(ms);
    return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
  }
  function weekStartISO(now) {
    const ms = (now instanceof Date ? now : new Date(now == null ? Date.now() : now)).getTime();
    const p = etParts(ms);
    // Monday's date, read as if the ET wall clock were UTC…
    const wall = Date.UTC(p.y, p.mo - 1, p.d - p.dow, 0, 0, 0);
    // …then shift to the real UTC instant. Two passes so the offset is taken at
    // Monday itself (the week may contain a DST change; Monday 00:00 never does).
    let utc = wall - etOffsetMs(wall);
    utc = wall - etOffsetMs(utc);
    return new Date(utc).toISOString();
  }

  // Defence in depth: the name column is public, so nothing contact-shaped
  // gets in even if a page passes one by mistake.
  function safeName(name) {
    let n = String(name == null ? '' : name).replace(/[^a-zA-Z0-9_ ]/g, '').trim().slice(0, 20);
    if (String(name || '').includes('@') || n.replace(/\D/g, '').length >= 7) n = '';
    return n || 'ANON';
  }
  const int0 = v => Math.max(0, Math.round(Number(v) || 0));

  // ── Supabase ──
  function weeklyFilter(q, tab) {
    return tab === 'weekly' ? q.gte('created_at', weekStartISO()) : q;
  }

  // Insert one run; resolves to the new row id (also remembered locally).
  async function submit({ name, score, wave, duration_s, kills, spent }) {
    const row = {
      name: safeName(name),
      score: Math.round(Number(score) || 0),
      wave: int0(wave),
      duration_s: int0(duration_s),
      kills: int0(kills),
      spent: int0(spent),
    };
    const { data, error } = await client().from(TABLE).insert(row).select('id').single();
    if (error) throw error;
    saveId(data.id);
    return data.id;
  }

  // Top 10 by score (ties: earliest first). tab = 'weekly' | 'alltime'.
  async function fetchTop(tab) {
    let q = client().from(TABLE).select('id,name,score,wave');
    q = weeklyFilter(q, tab)
      .order('score', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(TOP_N);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  // 1 + number of rows scoring strictly more. null if the query failed.
  async function fetchRank(score, tab) {
    try {
      let q = client().from(TABLE).select('id', { count: 'exact', head: true }).gt('score', score);
      q = weeklyFilter(q, tab);
      const { count, error } = await q;
      if (error) throw error;
      return 1 + (count || 0);
    } catch (e) {
      console.error('[TanaBoard] rank failed:', e);
      return null;
    }
  }

  // The player's best saved row for this tab, plus its rank (or null).
  async function myBest(tab) {
    const ids = getIds();
    if (!ids.length) return null;
    let q = client().from(TABLE).select('id,name,score,wave').in('id', ids);
    q = weeklyFilter(q, tab).order('score', { ascending: false }).limit(1);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || !data.length) return null;
    const rank = await fetchRank(data[0].score, tab);
    return rank == null ? null : Object.assign({}, data[0], { rank });
  }

  // Contact → Google Apps Script ONLY (never Supabase). No Content-Type header
  // and mode:'no-cors' for the same reason as the room-1 signup form: Apps
  // Script answers with a redirect that has no CORS headers, and we don't read it.
  async function linkContact({ rowId, score, name, contact }) {
    const c = String(contact || '').trim();
    try { localStorage.setItem(CONTACT_KEY, c); } catch (_) {}
    await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      mode: 'no-cors',
      body: JSON.stringify({ type: 'score', rowId, score, name, contact: c }),
    });
    return true;
  }

  // ── UI ──
  let _styled = false;
  function injectStyle() {
    if (_styled) return;
    _styled = true;
    const s = document.createElement('style');
    s.textContent = `
.tb { font-family: 'Press Start 2P', monospace; text-align: left; }
.tb-tabs { display: flex; gap: 6px; margin-bottom: 6px; }
.tb-tab {
  flex: 1; font: inherit; font-size: 7px; padding: 7px 4px; cursor: pointer;
  background: transparent; color: #6a6a80; border: 1px solid #2a1420;
}
.tb-tab:hover { color: #b0b8d0; }
.tb-tab.on { color: #e94560; border-color: #e94560; background: rgba(233,69,96,0.08); }
.tb-reset { font-size: 6px; color: #4a4a5a; letter-spacing: 1px; margin: 0 0 6px; text-align: center; }
.tb-list { list-style: none; font-size: 7.5px; color: #b0b8d0; }
.tb-row {
  display: flex; justify-content: space-between; align-items: center; gap: 8px;
  padding: 4px 2px; border-bottom: 1px solid #1a1020;
}
.tb-row .tb-l { color: #f9c74f; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tb-row .tb-r { flex-shrink: 0; }
.tb-row.me { color: #fff; outline: 1px solid rgba(249,199,79,0.55); outline-offset: -1px; background: rgba(249,199,79,0.06); }
.tb-row.hi { outline: 2px solid #f9c74f; outline-offset: -2px; background: rgba(249,199,79,0.16); box-shadow: 0 0 12px rgba(249,199,79,0.35); }
.tb-you { font-size: 6px; background: #f9c74f; color: #0c0710; padding: 1px 3px; margin-left: 6px; }
.tb-div { border-top: 1px dashed #3a2430; margin: 6px 0 2px; }
.tb-msg { font-size: 7px; color: #4a4a5a; padding: 4px 2px; }
`;
    document.head.appendChild(s);
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function rowEl(rank, r, mine, isHi, youLabel) {
    const li = el('li', 'tb-row' + (mine ? ' me' : '') + (isHi ? ' hi' : ''));
    const l = el('span', 'tb-l', youLabel ? `#${rank} YOU` : `#${rank} ${String(r.name || 'ANON').toUpperCase()}`);
    if (mine && !youLabel) l.appendChild(el('span', 'tb-you', 'YOU'));
    li.appendChild(l);
    li.appendChild(el('span', 'tb-r', youLabel ? String(r.score) : `${r.score} (W${r.wave})`));
    return li;
  }

  // Reusable board. opts: { highlightId, tab: 'weekly'|'alltime' }.
  // Returns { setTab, reload }.
  function render(container, opts) {
    opts = opts || {};
    injectStyle();
    const hiId = opts.highlightId != null ? String(opts.highlightId) : null;
    let tab = opts.tab === 'alltime' ? 'alltime' : 'weekly';
    let token = 0;

    container.textContent = '';
    const root  = el('div', 'tb');
    const tabs  = el('div', 'tb-tabs');
    const bWeek = el('button', 'tb-tab', 'WEEKLY');
    const bAll  = el('button', 'tb-tab', 'ALL TIME');
    bWeek.type = bAll.type = 'button';
    tabs.append(bWeek, bAll);
    const reset = el('div', 'tb-reset', 'RESETS MONDAY');
    const body  = el('div', 'tb-body');
    root.append(tabs, reset, body);
    container.appendChild(root);

    function paintTabs() {
      bWeek.classList.toggle('on', tab === 'weekly');
      bAll.classList.toggle('on', tab === 'alltime');
      reset.style.display = tab === 'weekly' ? '' : 'none';
    }
    function msg(text) { body.textContent = ''; body.appendChild(el('div', 'tb-msg', text)); }

    async function load() {
      const my = ++token;
      paintTabs();
      msg('LOADING...');
      try {
        const [rows, best] = await Promise.all([
          fetchTop(tab),
          myBest(tab).catch(() => null),
        ]);
        if (my !== token) return; // a newer tab switch superseded this one
        if (!rows.length) { msg('NO SCORES YET'); return; }
        const mine = new Set(getIds().map(String));
        const ol = el('ol', 'tb-list');
        let hiEl = null;
        rows.forEach((r, i) => {
          const isHi = hiId !== null && String(r.id) === hiId;
          const li = rowEl(i + 1, r, mine.has(String(r.id)), isHi, false);
          if (isHi) hiEl = li;
          ol.appendChild(li);
        });
        body.textContent = '';
        body.appendChild(ol);
        // Not in this tab's top 10? Show the player's best under a divider.
        if (best && !rows.some(r => String(r.id) === String(best.id))) {
          body.appendChild(el('div', 'tb-div'));
          const ol2 = el('ol', 'tb-list');
          const isHi = hiId !== null && String(best.id) === hiId;
          ol2.appendChild(rowEl(best.rank, best, true, isHi, true));
          body.appendChild(ol2);
        }
        if (hiEl && hiEl.scrollIntoView) hiEl.scrollIntoView({ block: 'nearest' });
      } catch (e) {
        console.error('[TanaBoard] load failed:', e);
        if (my === token) msg("COULDN'T LOAD SCORES");
      }
    }

    function setTab(t, silent) {
      t = t === 'alltime' ? 'alltime' : 'weekly';
      if (t === tab) return;
      tab = t;
      if (!silent && window.TanaAudio) window.TanaAudio.play('ui_click');
      load();
    }
    bWeek.addEventListener('click', () => setTab('weekly'));
    bAll.addEventListener('click',  () => setTab('alltime'));

    load();
    return { setTab, reload: load };
  }

  window.TanaBoard = {
    APPS_SCRIPT_URL,
    weekStartISO, submit, fetchTop, fetchRank, myBest, linkContact, render,
    getIds, getContact,
  };
})();
