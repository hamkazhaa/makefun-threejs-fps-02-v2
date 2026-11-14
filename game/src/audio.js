// Synthesised sound effects: every sound is built from WebAudio oscillators and
// filtered noise at runtime, so the game ships no audio files and needs no network.
// Sounds are created lazily on the first user gesture (browsers require it).
export function createAudio() {
  let ctx = null;
  let master = null;
  let enabled = true;

  function ensure() {
    if (ctx) return ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    } catch (e) {
      ctx = null;
    }
    return ctx;
  }

  function noiseBuffer(seconds) {
    const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * seconds)), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function burst({ duration = 0.12, frequency = 1200, type = 'lowpass', gain = 0.5, slideTo = null }) {
    if (!enabled || !ensure()) return;
    const t = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer(duration + 0.05);
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(frequency, t);
    if (slideTo) filter.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    source.connect(filter).connect(g).connect(master);
    source.start(t);
    source.stop(t + duration + 0.05);
  }

  function tone({ frequency = 440, end = null, duration = 0.1, type = 'sine', gain = 0.2, when = 0 }) {
    if (!enabled || !ensure()) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, t);
    if (end) osc.frequency.exponentialRampToValueAtTime(Math.max(20, end), t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  const SHOTS = {
    pistol: { duration: 0.1, frequency: 2600, slideTo: 500, gain: 0.5 },
    smg: { duration: 0.08, frequency: 3000, slideTo: 700, gain: 0.42 },
    rifle: { duration: 0.13, frequency: 1800, slideTo: 320, gain: 0.55 },
    sniper: { duration: 0.22, frequency: 1400, slideTo: 180, gain: 0.7 },
    shotgun: { duration: 0.18, frequency: 1100, slideTo: 220, gain: 0.7 },
  };

  return {
    unlock() { ensure(); if (ctx && ctx.state === 'suspended') ctx.resume(); },
    toggle() { enabled = !enabled; return enabled; },
    shot(kind) {
      const spec = SHOTS[kind] || SHOTS.rifle;
      burst(spec);
      tone({ frequency: 160, end: 55, duration: 0.09, type: 'triangle', gain: 0.35 });
    },
    distantShot() { burst({ duration: 0.09, frequency: 900, slideTo: 300, gain: 0.16 }); },
    dryFire() { tone({ frequency: 1200, duration: 0.03, type: 'square', gain: 0.08 }); },
    reload() {
      tone({ frequency: 500, duration: 0.04, type: 'square', gain: 0.1 });
      tone({ frequency: 700, duration: 0.04, type: 'square', gain: 0.1, when: 0.18 });
      tone({ frequency: 900, duration: 0.05, type: 'square', gain: 0.12, when: 0.42 });
    },
    hit() { tone({ frequency: 1500, duration: 0.05, type: 'sine', gain: 0.22 }); },
    headshot() {
      tone({ frequency: 1900, duration: 0.06, type: 'sine', gain: 0.25 });
      tone({ frequency: 2400, duration: 0.08, type: 'sine', gain: 0.2, when: 0.05 });
    },
    hurt() { tone({ frequency: 220, end: 90, duration: 0.16, type: 'sawtooth', gain: 0.25 }); },
    kill() {
      tone({ frequency: 660, duration: 0.07, type: 'sine', gain: 0.2 });
      tone({ frequency: 990, duration: 0.1, type: 'sine', gain: 0.2, when: 0.07 });
    },
    plantBeep() { tone({ frequency: 1100, duration: 0.07, type: 'square', gain: 0.14 }); },
    planted() {
      tone({ frequency: 880, duration: 0.12, type: 'square', gain: 0.16 });
      tone({ frequency: 880, duration: 0.12, type: 'square', gain: 0.16, when: 0.18 });
    },
    defuseBeep() { tone({ frequency: 700, duration: 0.07, type: 'square', gain: 0.14 }); },
    explosion() {
      burst({ duration: 0.9, frequency: 500, slideTo: 60, gain: 0.9 });
      tone({ frequency: 90, end: 30, duration: 0.8, type: 'sine', gain: 0.6 });
    },
    grenadePin() { tone({ frequency: 1400, duration: 0.03, type: 'square', gain: 0.1 }); },
    buy() {
      tone({ frequency: 1200, duration: 0.05, type: 'sine', gain: 0.16 });
      tone({ frequency: 1600, duration: 0.07, type: 'sine', gain: 0.16, when: 0.06 });
    },
    denied() { tone({ frequency: 220, duration: 0.12, type: 'square', gain: 0.15 }); },
    roundWin() {
      [523, 659, 784].forEach((f, i) => tone({ frequency: f, duration: 0.16, type: 'triangle', gain: 0.2, when: i * 0.12 }));
    },
    roundLose() {
      [392, 330, 262].forEach((f, i) => tone({ frequency: f, duration: 0.18, type: 'triangle', gain: 0.18, when: i * 0.13 }));
    },
    tick() { tone({ frequency: 1000, duration: 0.04, type: 'sine', gain: 0.12 }); },
  };
}
