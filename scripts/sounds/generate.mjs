#!/usr/bin/env node
// Synthesizes the board's notification sounds into server/sounds/*.wav.
// Generated rather than downloaded, so every sound is ours to ship and identical on every run.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../release/lib.mjs';

const RATE = 22050;
const TAU = Math.PI * 2;

const silence = (sec) => new Float32Array(Math.round(sec * RATE));

// A tone with an exponential decay; `partials` are [ratio, gain] overtones.
function tone(freq, sec, { decay = 6, attack = 0.004, partials = [[1, 1]], sweepTo = null } = {}) {
  const n = Math.round(sec * RATE);
  const out = new Float32Array(n);
  let phase = partials.map(() => 0);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const f = sweepTo === null ? freq : freq + (sweepTo - freq) * (i / n);
    const env = Math.min(1, t / attack) * Math.exp(-decay * t);
    let v = 0;
    partials.forEach(([ratio, gain], k) => {
      phase[k] += (TAU * f * ratio) / RATE;
      v += Math.sin(phase[k]) * gain;
    });
    out[i] = v * env;
  }
  return out;
}

// A buzzy tone (odd harmonics) for alarms that must cut through.
const buzz = (freq, sec, opts = {}) => tone(freq, sec, { decay: 0.5, partials: [[1, 1], [3, 0.33], [5, 0.2], [7, 0.14]], ...opts });

function concat(...parts) {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

function mix(...parts) {
  const out = new Float32Array(Math.max(...parts.map((p) => p.length)));
  for (const p of parts) p.forEach((v, i) => { out[i] += v; });
  return out;
}

const repeat = (part, times, gap = 0) => concat(...Array.from({ length: times }, () => concat(part, silence(gap))));

function wav(samples, peak = 0.8) {
  const max = samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1;
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => data.writeInt16LE(Math.round((v / max) * peak * 32767), i * 2));
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(RATE, 24); head.writeUInt32LE(RATE * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

const bell = [[1, 1], [2.76, 0.4], [5.4, 0.15]];

export const SOUNDS = {
  // Quiet: a batch arrived.
  pop: [tone(880, 0.09, { decay: 40, partials: [[1, 1], [2, 0.2]] }), 0.55],
  droplet: [tone(1400, 0.16, { decay: 18, sweepTo: 520 }), 0.55],
  tick: [concat(tone(1900, 0.04, { decay: 80 }), silence(0.06), tone(1500, 0.05, { decay: 70 })), 0.5],
  // Noticeable: something important.
  chime: [concat(tone(1047, 0.22, { decay: 9, partials: bell }), tone(1568, 0.5, { decay: 6, partials: bell })), 0.75],
  marimba: [concat(...[1047, 1319, 1568].map((f) => tone(f, 0.16, { decay: 16, partials: [[1, 1], [4, 0.25]] })), tone(2093, 0.4, { decay: 10, partials: [[1, 1], [4, 0.25]] })), 0.75],
  bell: [tone(880, 1.4, { decay: 2.6, partials: bell }), 0.8],
  ping: [repeat(tone(1760, 0.18, { decay: 14 }), 2, 0.05), 0.75],
  // Loud: fire.
  alarm: [repeat(concat(buzz(988, 0.18), buzz(784, 0.18)), 4), 0.95],
  siren: [repeat(concat(tone(600, 0.4, { decay: 0.3, sweepTo: 1400, partials: [[1, 1], [2, 0.3]] }), tone(1400, 0.4, { decay: 0.3, sweepTo: 600, partials: [[1, 1], [2, 0.3]] })), 2), 0.95],
  klaxon: [repeat(concat(buzz(330, 0.32, { attack: 0.01 }), silence(0.1)), 3), 0.95],
  redalert: [repeat(mix(buzz(1200, 0.12), buzz(1260, 0.12)), 6, 0.06), 0.95],
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = join(ROOT, 'server', 'sounds');
  mkdirSync(dir, { recursive: true });
  for (const [name, [samples, peak]] of Object.entries(SOUNDS)) {
    const file = join(dir, `${name}.wav`);
    writeFileSync(file, wav(samples, peak));
    console.log(`${file} ${(samples.length / RATE).toFixed(2)}s`);
  }
}
