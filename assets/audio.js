// ─────────────────────────────────────────────────────────
//  TanaAudio — shared Web Audio module for index.html (room 1) and
//  zombies.html (room 2). Plain script, no build step: exposes the
//  global `TanaAudio`.
//
//  Graph:  voice gain ─▶ sfxGain ─┐
//                    musicGain ───┴▶ masterGain ─▶ destination
//
//  Audio must never block or break the game: a missing/broken file is
//  warned about once and then treated as silent, and every entry point
//  swallows its own errors.
// ─────────────────────────────────────────────────────────
(function (global) {
  'use strict';

  // ── CONFIG — hand-tune here ──────────────────────────────
  //   vol       per-voice gain (0..1), under the sfx bus
  //   pitchVar  random playbackRate of 1 ± pitchVar
  //   minGap    min ms between two starts of this sound (0 = none)
  //   maxVoices cap on simultaneously-playing copies (extras are skipped)
  //   fallback  { name, rate } — if this file failed to load, play that other
  //             sound instead, with its playbackRate multiplied by `rate`
  const SFX = {
    ui_open:       { file: 'assets/sfx/ui_open_new.mp3',       vol: 0.5,  pitchVar: 0,    minGap: 60,  maxVoices: 2 },
    ui_close:      { file: 'assets/sfx/ui_close.mp3',      vol: 0.5,  pitchVar: 0,    minGap: 60,  maxVoices: 2 },
    ui_click:      { file: 'assets/sfx/ui_click.mp3',      vol: 0.45, pitchVar: 0.03, minGap: 50,  maxVoices: 2 },
    pistol:        { file: 'assets/sfx/pistol_new.mp3',        vol: 0.55, pitchVar: 0.06, minGap: 0,   maxVoices: 4 },
    uzi:           { file: 'assets/sfx/zombie_hit_new.mp3',           vol: 0.45, pitchVar: 0.08, minGap: 0,   maxVoices: 6 },
    // Falls back to the uzi sound at playbackRate 0.8 while draco.mp3 is missing.
    draco:         { file: 'assets/sfx/draco.mp3',         vol: 0.5,  pitchVar: 0.08, minGap: 0,   maxVoices: 6, fallback: { name: 'uzi', rate: 0.8 } },
    shotgun:       { file: 'assets/sfx/shotgun_new.mp3',       vol: 0.65, pitchVar: 0.05, minGap: 0,   maxVoices: 3 },
    weapon_switch: { file: 'assets/sfx/weapon_switch.mp3', vol: 0.5,  pitchVar: 0,    minGap: 80,  maxVoices: 1 },
    weapon_unlock: { file: 'assets/sfx/weapon_unlock.mp3', vol: 0.6,  pitchVar: 0,    minGap: 0,   maxVoices: 1 },
    zombie_hit:    { file: 'assets/sfx/zombie_hit_new_B.mp3',    vol: 0.7,  pitchVar: 0.12, minGap: 40,  maxVoices: 5 },
    zombie_death:  { file: 'assets/sfx/zombie_death.mp3',  vol: 0.5,  pitchVar: 0.10, minGap: 30,  maxVoices: 4 },
    player_hurt:   { file: 'assets/sfx/player_hurt_new.mp3',   vol: 0.6,  pitchVar: 0.08, minGap: 250, maxVoices: 1 },
    wave_start:    { file: 'assets/sfx/wave_start.mp3',    vol: 0.7,  pitchVar: 0,    minGap: 0,   maxVoices: 1 },
    wave_clear:    { file: 'assets/sfx/wave_clear_new.mp3',    vol: 0.7,  pitchVar: 0,    minGap: 0,   maxVoices: 1 },
    game_over:     { file: 'assets/sfx/game_over.mp3',     vol: 0.7,  pitchVar: 0,    minGap: 0,   maxVoices: 1 },
    score_tick:    { file: 'assets/sfx/score_tick.mp3',    vol: 0.25, pitchVar: 0.05, minGap: 60,  maxVoices: 2 },
    // Looped while the water hose is spraying — started/stopped via startLoop().
    hose:          { file: 'assets/sfx/hose.mp3',          vol: 0.5,  pitchVar: 0,    minGap: 0,   maxVoices: 1, loop: true },
    score_coins:   { file: 'assets/sfx/score_coins.mp3',   vol: 0.55, pitchVar: 0,    minGap: 0,   maxVoices: 1 },
  };
  const MUSIC = { room1: null, room2: null };  // placeholders — tracks get re-added later (path string, looped)
  const SFX_VOLUME = 0.8, MUSIC_VOLUME = 0.4;

  const MUTE_KEY        = 'tana-muted';
  const LEGACY_MUTE_KEY = 'tana-bgm-muted';
  const DUCK_TC         = 0.08; // seconds — time constant for music duck / mute ramps

  // ── Shared state ─────────────────────────────────────────
  let ctx = null, master = null, sfxGain = null, musicGain = null;
  let muted = false;
  let musicDucked = false;
  let musicKey = null, musicSrc = null, musicBufCache = {};
  const buffers   = {};   // name -> AudioBuffer | null (null = failed → silent)
  const lastStart = {};   // name -> performance.now() of last accepted start
  const voices    = {};   // name -> live voice count
  const warned    = {};   // file -> true once warned
  const muteListeners = [];

  // ── Mute persistence (+ one-time migration of the old key) ──
  function readMuted() {
    try {
      let v = localStorage.getItem(MUTE_KEY);
      if (v === null) {
        const old = localStorage.getItem(LEGACY_MUTE_KEY);
        if (old !== null) {
          v = old;
          try { localStorage.setItem(MUTE_KEY, old); } catch (_) {}
        }
      }
      return v === '1';
    } catch (_) { return false; }
  }

  function applyMuteGain() {
    if (!master) return;
    try { master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, DUCK_TC); } catch (_) {}
  }

  function setMuted(m) {
    muted = !!m;
    try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch (_) {}
    applyMuteGain();
    muteListeners.forEach(fn => { try { fn(muted); } catch (_) {} });
    return muted;
  }

  // ── Context + buses ──────────────────────────────────────
  function init() {
    muted = readMuted();
    // iPhone: treat the page as media playback so the hardware silent switch
    // doesn't mute Web Audio. (Safari 16.4+; feature-detected, never throws.)
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (_) {}
    try {
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) { console.warn('[TanaAudio] Web Audio unavailable — running silent.'); return; }
      ctx       = new AC();
      master    = ctx.createGain();
      sfxGain   = ctx.createGain();
      musicGain = ctx.createGain();
      master.gain.value    = muted ? 0 : 1;
      sfxGain.gain.value   = SFX_VOLUME;
      musicGain.gain.value = musicDucked ? 0 : MUSIC_VOLUME;
      sfxGain.connect(master);
      musicGain.connect(master);
      master.connect(ctx.destination);
    } catch (e) {
      ctx = null;
      console.warn('[TanaAudio] init failed — running silent.', e);
      return;
    }
    installUnlock();
    installVisibility();
    preload();
  }

  // ── Loading ──────────────────────────────────────────────
  function warnOnce(file, why) {
    if (warned[file]) return;
    warned[file] = true;
    console.warn('[TanaAudio] could not load ' + file + ' (' + why + ') — treating as silent.');
  }

  function decode(arrayBuf) {
    return new Promise((resolve, reject) => {
      // Callback form + promise form both, for older Safari.
      const p = ctx.decodeAudioData(arrayBuf, resolve, reject);
      if (p && typeof p.then === 'function') p.then(resolve, reject);
    });
  }

  function loadBuffer(file) {
    return fetch(file)
      .then(res => {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.arrayBuffer();
      })
      .then(decode);
  }

  function preload() {
    Object.keys(SFX).forEach(name => {
      const file = SFX[name].file;
      buffers[name] = null;
      loadBuffer(file).then(
        buf => { buffers[name] = buf; },
        err => warnOnce(file, err && err.message ? err.message : 'decode failed')
      );
    });
  }

  // ── Unlock (autoplay policy) + tab visibility ────────────
  // Resume + play a 1-sample silent buffer (the classic iOS Safari nudge).
  // Must run synchronously inside a user-gesture handler. Returns the
  // resume() promise (or null).
  function nudge() {
    if (!ctx) return null;
    let r = null;
    try {
      r = ctx.resume();
      if (r && typeof r.catch === 'function') r.catch(() => {});
      const b = ctx.createBuffer(1, 1, 22050);
      const s = ctx.createBufferSource();
      s.buffer = b;
      s.connect(ctx.destination);
      s.start(0);
    } catch (_) {}
    return r;
  }

  function installUnlock() {
    // touchend + click matter on iOS: Safari doesn't treat touchstart /
    // pointerdown as an audio-unlocking gesture, only a completed tap.
    const events = ['pointerdown', 'touchstart', 'touchend', 'click', 'keydown'];
    function unlock() {
      if (!ctx) return;
      nudge();
      if (ctx.state === 'running') events.forEach(e => global.removeEventListener(e, unlock, true));
    }
    events.forEach(e => global.addEventListener(e, unlock, { capture: true, passive: true }));
    // Some gestures (Esc, modifier keys) don't count as activation, so the
    // first resume() can leave us suspended — the listeners stay armed
    // until state actually reaches 'running'.
    ctx.onstatechange = () => {
      if (ctx.state === 'running') events.forEach(e => global.removeEventListener(e, unlock, true));
    };
  }

  function installVisibility() {
    document.addEventListener('visibilitychange', () => {
      if (!ctx) return;
      try {
        if (document.hidden) {
          const r = ctx.suspend();
          if (r && r.catch) r.catch(() => {});
        } else {
          const r = ctx.resume();
          if (r && r.catch) r.catch(() => {});
        }
      } catch (_) {}
    });
  }

  // ── SFX ──────────────────────────────────────────────────
  // opts.offset  seconds into the file to start from
  // opts.delay   seconds from now to start (sample-accurate scheduling)
  // opts.rate    playbackRate multiplier on top of the pitchVar jitter
  // Returns a handle { stop() } or null if the sound was skipped.
  function play(name, opts) {
    try {
      if (!ctx) return null;
      const def = SFX[name];
      const buf = buffers[name];
      if (def && !buf && def.fallback && SFX[def.fallback.name]) {
        return play(def.fallback.name, Object.assign({}, opts, {
          rate: ((opts && opts.rate) || 1) * def.fallback.rate,
        }));
      }
      if (!def || !buf) return null;

      opts = opts || {};
      const offset = Math.max(0, opts.offset || 0);
      const delay  = Math.max(0, opts.delay  || 0);

      // Suspended / interrupted context (no user gesture yet, tab hidden, …):
      // DROP the sound. Queued sources would all fire in a burst the moment
      // the context resumes, and a timed start (delay / offset) would be out
      // of sync anyway.
      if (ctx.state !== 'running') return null;
      if (offset >= buf.duration) return null;

      const now = performance.now();
      if (def.minGap && lastStart[name] != null && now - lastStart[name] < def.minGap) return null;
      if (def.maxVoices && (voices[name] || 0) >= def.maxVoices) return null;

      const src  = ctx.createBufferSource();
      const gain = ctx.createGain();
      src.buffer = buf;
      src.playbackRate.value = (1 + (Math.random() * 2 - 1) * (def.pitchVar || 0)) * (opts.rate || 1);
      gain.gain.value = def.vol;
      src.connect(gain);
      gain.connect(sfxGain);

      lastStart[name] = now;
      voices[name] = (voices[name] || 0) + 1;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        voices[name] = Math.max(0, (voices[name] || 1) - 1);
        try { src.disconnect(); gain.disconnect(); } catch (_) {}
      };
      src.onended = finish;
      src.start(ctx.currentTime + delay, offset);
      return {
        stop() {
          try { src.stop(); } catch (_) {}
          finish();
        },
      };
    } catch (e) {
      return null;
    }
  }

  // Looping SFX (e.g. the water hose). Returns { stop(fadeMs) } or null if
  // the file is missing/failed — callers just treat null as "silent".
  // The loop fades in over ~20ms and out over `fadeMs` (default 80) on stop().
  function startLoop(name) {
    try {
      if (!ctx) return null;
      const def = SFX[name];
      const buf = buffers[name];
      if (!def || !buf || ctx.state !== 'running') return null;
      const src  = ctx.createBufferSource();
      const gain = ctx.createGain();
      src.buffer = buf;
      src.loop = true;
      gain.gain.value = 0;
      gain.gain.setTargetAtTime(def.vol, ctx.currentTime, 0.02);
      src.connect(gain);
      gain.connect(sfxGain);
      src.start(0);
      let done = false;
      return {
        stop(fadeMs) {
          if (done) return;
          done = true;
          const f = (fadeMs == null ? 80 : fadeMs) / 1000;
          try {
            const t = ctx.currentTime;
            gain.gain.cancelScheduledValues(t);
            gain.gain.setValueAtTime(def.vol, t);
            gain.gain.linearRampToValueAtTime(0, t + f);
            src.stop(t + f + 0.02);
          } catch (_) {}
          src.onended = () => { try { src.disconnect(); gain.disconnect(); } catch (_) {} };
        },
      };
    } catch (e) {
      return null;
    }
  }

  // ── Music (stubs while MUSIC[key] is null) ───────────────
  function stopMusic() {
    musicKey = null;
    if (musicSrc) {
      try { musicSrc.stop(); musicSrc.disconnect(); } catch (_) {}
      musicSrc = null;
    }
  }

  function setMusic(key) {
    try {
      if (!ctx) return;
      if (musicKey === key && musicSrc) return;
      stopMusic();
      musicKey = key;
      const file = MUSIC[key];
      if (!file) return; // no track configured yet — nothing to do
      const ready = musicBufCache[file]
        ? Promise.resolve(musicBufCache[file])
        : loadBuffer(file).then(b => (musicBufCache[file] = b));
      ready.then(buf => {
        if (musicKey !== key || musicSrc) return; // superseded while loading
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        src.connect(musicGain);
        src.start(0);
        musicSrc = src;
      }).catch(err => warnOnce(file, err && err.message ? err.message : 'decode failed'));
    } catch (_) {}
  }

  function duckMusic(on) {
    musicDucked = !!on;
    if (!ctx) return;
    try { musicGain.gain.setTargetAtTime(musicDucked ? 0 : MUSIC_VOLUME, ctx.currentTime, DUCK_TC); } catch (_) {}
  }

  // ── Public API ───────────────────────────────────────────
  global.TanaAudio = {
    play,
    startLoop,
    // 'running' | 'suspended' | 'interrupted' | 'closed' | 'none' (no Web Audio)
    state: () => (ctx ? ctx.state : 'none'),
    // Call from inside a user gesture. Resolves true if audio is running afterwards.
    resume() {
      const r = nudge();
      return Promise.resolve(r).then(() => !!ctx && ctx.state === 'running', () => false);
    },
    setMusic,
    stopMusic,
    duckMusic,
    isMuted:    () => muted,
    setMuted,
    toggleMute: () => setMuted(!muted),
    onMuteChange(fn) { if (typeof fn === 'function') muteListeners.push(fn); },
    // Debug helper: which configured SFX files are decoded vs. silent.
    status() {
      const loaded = [], failed = [];
      Object.keys(SFX).forEach(n => (buffers[n] ? loaded : failed).push(SFX[n].file));
      return { loaded, failed };
    },
  };

  init();
})(window);
