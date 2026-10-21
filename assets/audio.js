// ─────────────────────────────────────────────────────────
//  TanaAudio — shared Web Audio module for index.html (room 1) and
//  zombies.html (room 2). Plain script, no build step: exposes the
//  global `TanaAudio`.
//
//  Graph:  voice gain ─▶ sfxGain ─▶ limiter ─┐
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
  //   steal     true = at maxVoices, stop the OLDEST playing copy (15 ms fade) and play the
  //             new one instead of skipping it — for sounds that must always be heard
  //   fallback  { name, rate } — if this file failed to load, play that other
  //             sound instead, with its playbackRate multiplied by `rate`
  const SFX = {
    ui_open:       { file: 'assets/sfx/ui_open_new.mp3',       vol: 0.5,  pitchVar: 0,    minGap: 60,  maxVoices: 2 },
    ui_close:      { file: 'assets/sfx/ui_close.mp3',      vol: 0.5,  pitchVar: 0,    minGap: 60,  maxVoices: 2 },
    ui_click:      { file: 'assets/sfx/ui_click_new.mp3',      vol: 0.45, pitchVar: 0.03, minGap: 50,  maxVoices: 2 },
    pistol:        { file: 'assets/sfx/pistol_new.mp3',        vol: 1.2,  pitchVar: 0.06, minGap: 0,   maxVoices: 4 },
    uzi:           { file: 'assets/sfx/zombie_hit_new.mp3',           vol: 0.9,  pitchVar: 0.08, minGap: 0,   maxVoices: 6 },
    // Falls back to the uzi sound at playbackRate 0.8 while draco.mp3 is missing.
    draco:         { file: 'assets/sfx/draco.mp3',         vol: 1.0,  pitchVar: 0.08, minGap: 0,   maxVoices: 6, fallback: { name: 'uzi', rate: 0.8 } },
    shotgun:       { file: 'assets/sfx/shotgun_new.mp3',       vol: 1.1,  pitchVar: 0.05, minGap: 0,   maxVoices: 3 },
    weapon_switch: { file: 'assets/sfx/weapon_switch_new.mp3', vol: 0.6, pitchVar: 0.03, minGap: 0,   maxVoices: 1, steal: true },
    weapon_unlock: { file: 'assets/sfx/weapon_unlock.mp3', vol: 0.6,  pitchVar: 0,    minGap: 0,   maxVoices: 1 },
    zombie_hit:    { file: 'assets/sfx/zombie_hit_new_B.mp3',    vol: 0.7,  pitchVar: 0.12, minGap: 40,  maxVoices: 5 },
    zombie_death:  { file: 'assets/sfx/zombie_death.mp3',  vol: 0.5,  pitchVar: 0.10, minGap: 30,  maxVoices: 4 },
    player_hurt:   { file: 'assets/sfx/player_hurt_new.mp3',   vol: 0.6,  pitchVar: 0.08, minGap: 250, maxVoices: 1 },
    wave_start:    { file: 'assets/sfx/wave_start.mp3',    vol: 0.7,  pitchVar: 0,    minGap: 0,   maxVoices: 1 },
    wave_clear:    { file: 'assets/sfx/wave_clear_new.mp3',    vol: 0.7,  pitchVar: 0,    minGap: 0,   maxVoices: 1 },
    game_over:     { file: 'assets/sfx/game_over.mp3',     vol: 0.7,  pitchVar: 0,    minGap: 0,   maxVoices: 1 },
    score_tick:    { file: 'assets/sfx/score_tick.mp3',    vol: 0.25, pitchVar: 0.05, minGap: 60,  maxVoices: 2 },
    // Looped while the water hose is spraying — started/stopped via startLoop().
    // WAV on purpose: MP3 adds encoder padding that clicks at the loop point.
    hose:          { file: 'assets/sfx/hose_loop.wav',     vol: 0.5,  pitchVar: 0,    minGap: 0,   maxVoices: 1, loop: true },
    hose_start:    { file: 'assets/sfx/hose_start.mp3',    vol: 0.55, pitchVar: 0.04, minGap: 250, maxVoices: 1 },
    score_coins:   { file: 'assets/sfx/score_coins.mp3',   vol: 0.55, pitchVar: 0,    minGap: 0,   maxVoices: 1 },
    // Vending machine: the payment, then (0.25 s later) the heal.
    vend_pay:      { file: 'assets/sfx/pay_new2.mp3',      vol: 0.55, pitchVar: 0,    minGap: 0,   maxVoices: 1 },
    heal:          { file: 'assets/sfx/heal.mp3',          vol: 0.6,  pitchVar: 0,    minGap: 0,   maxVoices: 1 },
    // Reloads (zombies.html). *_mag_in is scheduled with play(..., { endIn }) so it
    // finishes exactly when the reload does; shotgun loads shell by shell.
    pistol_mag_out:   { file: 'assets/sfx/uzi_mag_out_new.mp3',   vol: 0.6, pitchVar: 0.03, minGap: 0,   maxVoices: 1 },
    pistol_mag_in:    { file: 'assets/sfx/draco_mag_in_new.mp3',    vol: 0.6, pitchVar: 0.03, minGap: 0,   maxVoices: 1 },
    uzi_mag_out:      { file: 'assets/sfx/uzi_mag_out_new.mp3',      vol: 0.6, pitchVar: 0.03, minGap: 0,   maxVoices: 1 },
    uzi_mag_in:       { file: 'assets/sfx/draco_mag_in_new.mp3',       vol: 0.6, pitchVar: 0.03, minGap: 0,   maxVoices: 1 },
    draco_mag_out:    { file: 'assets/sfx/uzi_mag_out_new.mp3',    vol: 0.6, pitchVar: 0.03, minGap: 0,   maxVoices: 1 },
    draco_mag_in:     { file: 'assets/sfx/draco_mag_in_new.mp3',     vol: 0.6, pitchVar: 0.03, minGap: 0,   maxVoices: 1 },
    shotgun_shell_in: { file: 'assets/sfx/shotgun_shell_in_new.mp3', vol: 0.6, pitchVar: 0.06, minGap: 0,   maxVoices: 2 },
    // maxVoices 2: with a pump after every blast, one pump's tail can still be ringing when the next is scheduled.
    shotgun_pump:     { file: 'assets/sfx/shotgun_pump_new.mp3',     vol: 0.7, pitchVar: 0.02, minGap: 0,   maxVoices: 2 },
    dry_fire:         { file: 'assets/sfx/dry_fire_new.mp3',         vol: 0.4, pitchVar: 0.05, minGap: 250, maxVoices: 1 },
  };
  // Background music: one seamless loop (80 bars @ 146 BPM, 131.507 s), played through an
  // HTMLAudioElement routed into musicGain, so mute / ducking / the volume below all act on it.
  const MUSIC = { room1: 'assets/music/tana_beat_loop.mp3', room2: 'assets/music/tana_beat_loop.mp3' };
  const MUSIC_VOLUME_ROOM1 = 0.25, MUSIC_VOLUME_ROOM2 = 0.20; // per-room level (sfx are untouched)
  const MUSIC_FADE_IN_S = 1.5;                                // fade in when it starts
  const SFX_VOLUME = 0.8;

  const MUTE_KEY        = 'tana-muted';
  const LEGACY_MUTE_KEY = 'tana-bgm-muted';
  const DUCK_TC         = 0.08; // seconds — time constant for music duck / mute ramps

  // ── Shared state ─────────────────────────────────────────
  let ctx = null, master = null, sfxGain = null, limiter = null, musicGain = null;
  let muted = false;
  let musicDucked = false;
  // Music: an <audio> element (created lazily after page load) → MediaElementSource →
  // musicTrim (per-room level, fades, dips) → musicGain (duck / TV) → master (mute).
  let musicEl = null, musicSrcNode = null, musicTrim = null;
  let musicWant = null;            // key the page asked for (setMusic)
  let musicKey = null;             // key actually playing
  let musicFactor = 1;             // dip multiplier (wave-start build etc.)
  let musicRate = 1, musicRateTimer = 0;
  const buffers   = {};   // name -> AudioBuffer | null (null = failed → silent)
  const lastStart = {};   // name -> performance.now() of last accepted start
  const voices    = {};   // name -> live voice count
  const live      = {};   // name -> [{ fade() }] playing copies, oldest first (for `steal`)
  const STEAL_FADE_S = 0.015; // fade-out when a voice is stolen
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
      musicGain.gain.value = musicDucked ? 0 : 1;
      musicTrim = ctx.createGain();
      musicTrim.gain.value = 0;
      musicTrim.connect(musicGain);
      // Soft limiter on the SFX bus only (music is unaffected) so stacked
      // full-auto shots with gain > 1 don't clip the master.
      limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -6;
      limiter.knee.value      = 6;
      limiter.ratio.value     = 12;
      limiter.attack.value    = 0.003;
      limiter.release.value   = 0.12;
      sfxGain.connect(limiter);
      limiter.connect(master);
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
    kickMusic();   // iOS only lets media start inside the gesture — so start the music right here
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
      if (ctx.state === 'running') { events.forEach(e => global.removeEventListener(e, unlock, true)); kickMusic(); }
    };
  }

  function installVisibility() {
    document.addEventListener('visibilitychange', () => {
      if (!ctx) return;
      try {
        if (document.hidden) {
          if (musicEl && !musicEl.paused) musicEl.pause();     // keep the loop's position; resume on return
          const r = ctx.suspend();
          if (r && r.catch) r.catch(() => {});
        } else {
          const r = ctx.resume();
          if (r && r.catch) r.catch(() => {});
          kickMusic();
        }
      } catch (_) {}
    });
  }

  // ── SFX ──────────────────────────────────────────────────
  // opts.offset  seconds into the file to start from
  // opts.delay   seconds from now to start (sample-accurate scheduling)
  // opts.rate    playbackRate multiplier on top of the pitchVar jitter
  // opts.endIn   seconds from now at which the sound should END (overrides delay):
  //              it is scheduled so its last sample lands there, using the final
  //              (jittered) playbackRate. If it is longer than endIn, the head is
  //              skipped instead, so the ending still lines up.
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
      let offset = Math.max(0, opts.offset || 0);
      let delay  = Math.max(0, opts.delay  || 0);

      // Suspended / interrupted context (no user gesture yet, tab hidden, …):
      // DROP the sound. Queued sources would all fire in a burst the moment
      // the context resumes, and a timed start (delay / offset) would be out
      // of sync anyway.
      if (ctx.state !== 'running') return null;
      if (offset >= buf.duration) return null;

      const now = performance.now();
      if (def.minGap && lastStart[name] != null && now - lastStart[name] < def.minGap) return null;
      if (def.maxVoices && (voices[name] || 0) >= def.maxVoices) {
        if (!(def.steal && live[name] && live[name].length)) return null;
        live[name].shift().fade();   // free the slot: the oldest copy fades out, this one plays
      }

      const src  = ctx.createBufferSource();
      const gain = ctx.createGain();
      src.buffer = buf;
      const rate = (1 + (Math.random() * 2 - 1) * (def.pitchVar || 0)) * (opts.rate || 1);
      src.playbackRate.value = rate;
      if (opts.endIn != null) {
        const lead = opts.endIn - (buf.duration - offset) / rate; // seconds to wait so the end lands on endIn
        if (lead >= 0) { delay = lead; }
        else { delay = 0; offset += -lead * rate; }
        if (offset >= buf.duration) return null;
      }
      gain.gain.value = def.vol;
      src.connect(gain);
      gain.connect(sfxGain);

      lastStart[name] = now;
      voices[name] = (voices[name] || 0) + 1;
      let done = false, counted = true;
      const release = () => { // give the voice slot back exactly once
        if (!counted) return;
        counted = false;
        voices[name] = Math.max(0, (voices[name] || 1) - 1);
      };
      const entry = {
        // Stolen by a newer copy: short fade, slot freed now, nodes cleaned up when it ends.
        fade() {
          release();
          try {
            const t = ctx.currentTime;
            gain.gain.cancelScheduledValues(t);
            gain.gain.setValueAtTime(gain.gain.value, t);
            gain.gain.linearRampToValueAtTime(0, t + STEAL_FADE_S);
            src.stop(t + STEAL_FADE_S + 0.005);
          } catch (_) {}
        },
      };
      if (def.steal) (live[name] || (live[name] = [])).push(entry);
      const finish = () => {
        if (done) return;
        done = true;
        release();
        if (live[name]) { const i = live[name].indexOf(entry); if (i >= 0) live[name].splice(i, 1); }
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

  // ── Music ────────────────────────────────────────────────
  const musicLevel = () => (musicKey || musicWant) === 'room2' ? MUSIC_VOLUME_ROOM2 : MUSIC_VOLUME_ROOM1;

  // Ramp the trim gain to `v` over `sec` seconds, from wherever it is now (no clicks).
  function trimTo(v, sec) {
    if (!ctx || !musicTrim) return;
    try {
      const g = musicTrim.gain, t = ctx.currentTime;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      if (sec > 0) g.linearRampToValueAtTime(v, t + sec); else g.setValueAtTime(v, t);
    } catch (_) {}
  }

  // Create the <audio> element + graph nodes. Lazily, once the page has loaded, so music never delays startup.
  function ensureMusicEl() {
    if (musicEl || !ctx || !musicWant || !MUSIC[musicWant]) return;
    try {
      const a = new Audio();
      a.loop = true;
      a.preload = 'auto';
      a.crossOrigin = 'anonymous';
      a.preservesPitch = a.webkitPreservesPitch = a.mozPreservesPitch = true; // tempo changes never change pitch
      a.src = MUSIC[musicWant];
      a.playbackRate = musicRate;
      musicEl = a;
      musicSrcNode = ctx.createMediaElementSource(a);   // iOS ignores audio.volume — the gain nodes do the volume
      musicSrcNode.connect(musicTrim);
      a.addEventListener('error', () => warnOnce(a.src, 'music failed to load'));
    } catch (e) { musicEl = null; }
  }

  // Start (or resume) playback if the page wants music and the context is unlocked.
  // Called inside user gestures (nudge) and on context-running / visible events.
  function kickMusic() {
    try {
      if (!ctx || !musicWant) return;
      ensureMusicEl();
      if (!musicEl || !musicEl.paused && musicKey === musicWant) return;
      const fresh = musicKey !== musicWant;           // new start → fade in from silence
      musicKey = musicWant;
      if (fresh) { musicEl.currentTime = 0; trimTo(0, 0); }
      musicEl.playbackRate = musicRate;
      const p = musicEl.play();
      if (p && p.catch) p.catch(() => { musicKey = fresh ? null : musicKey; }); // refused (no gesture yet) → the next gesture retries
      if (fresh) trimTo(musicLevel() * musicFactor, MUSIC_FADE_IN_S);
    } catch (_) {}
  }

  // Ask for a track. Starts at once if audio is unlocked, otherwise on the first tap / click / key.
  function setMusic(key) {
    try {
      if (!ctx) return;
      if (musicWant === key && musicKey === key) return;
      musicWant = key;
      if (document.readyState === 'complete') ensureMusicEl();
      else global.addEventListener('load', () => setTimeout(() => { ensureMusicEl(); if (ctx.state === 'running') kickMusic(); }, 0), { once: true });
      if (ctx.state === 'running') kickMusic();
    } catch (_) {}
  }

  // Stop the music, optionally fading out over fadeMs first. A later setMusic() starts it again from the top.
  function stopMusic(fadeMs) {
    musicWant = null;
    const el = musicEl;
    if (!el || musicKey === null) { musicKey = null; return; }
    musicKey = null;
    const done = () => { if (musicKey === null) { try { el.pause(); el.currentTime = 0; } catch (_) {} } };
    if (fadeMs > 0) { trimTo(0, fadeMs / 1000); setTimeout(done, fadeMs + 60); } else { trimTo(0, 0); done(); }
  }

  // Dip the music to `factor` (e.g. 0.6) of its level, easing over rampMs. factor 1 = back to normal.
  function dipMusic(factor, rampMs) {
    musicFactor = factor;
    if (musicKey) trimTo(musicLevel() * musicFactor, (rampMs || 0) / 1000);
  }

  // Ease the loop's playbackRate to `rate` over rampMs (small steps every ~50 ms). Pitch stays put (preservesPitch).
  function setMusicRate(rate, rampMs) {
    const target = Math.max(0.25, Math.min(4, rate));
    clearInterval(musicRateTimer); musicRateTimer = 0;
    const from = musicRate, steps = Math.max(1, Math.round((rampMs || 0) / 50));
    const apply = v => { musicRate = v; if (musicEl) { try { musicEl.playbackRate = v; } catch (_) {} } };
    if (!rampMs || rampMs <= 0 || from === target) { apply(target); return; }
    let i = 0;
    musicRateTimer = setInterval(() => {
      i++;
      apply(i >= steps ? target : from + (target - from) * (i / steps));
      if (i >= steps) { clearInterval(musicRateTimer); musicRateTimer = 0; }
    }, 50);
  }

  function duckMusic(on) {
    musicDucked = !!on;
    if (!ctx) return;
    try { musicGain.gain.setTargetAtTime(musicDucked ? 0 : 1, ctx.currentTime, DUCK_TC); } catch (_) {}
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
    // Length in seconds of a decoded sound at normal speed (0 if not loaded / failed).
    duration: (name) => (buffers[name] ? buffers[name].duration : 0),
    setMusic,
    stopMusic,
    setMusicRate,
    dipMusic,
    duckMusic,
    isMuted:    () => muted,
    setMuted,
    toggleMute: () => setMuted(!muted),
    onMuteChange(fn) { if (typeof fn === 'function') muteListeners.push(fn); },
    // Debug helper: what the music engine is doing.
    musicStatus: () => ({
      want: musicWant, playing: !!musicEl && !musicEl.paused, key: musicKey, rate: musicRate,
      elRate: musicEl ? musicEl.playbackRate : null, preservesPitch: musicEl ? musicEl.preservesPitch : null,
      time: musicEl ? musicEl.currentTime : null, level: musicTrim ? musicTrim.gain.value : null,
      duck: musicGain ? musicGain.gain.value : null, master: master ? master.gain.value : null, ready: musicEl ? musicEl.readyState : null,
    }),
    // Debug helper: which configured SFX files are decoded vs. silent.
    status() {
      const loaded = [], failed = [];
      Object.keys(SFX).forEach(n => (buffers[n] ? loaded : failed).push(SFX[n].file));
      return { loaded, failed };
    },
  };

  init();
})(window);
