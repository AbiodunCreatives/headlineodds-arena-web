// Pure round timing, outcome and simulated-feed helpers for Dare15. No I/O here, so it is easy to test.

export const ROUND_MS = 15 * 60 * 1000;

export type Side = "UP" | "DOWN";

export interface RoundInfo {
  id: number; // floor(time / ROUND_MS)
  start: number;
  end: number;
}

export function roundAt(t: number): RoundInfo {
  const id = Math.floor(t / ROUND_MS);
  const start = id * ROUND_MS;
  return { id, start, end: start + ROUND_MS };
}

export function roundById(id: number): RoundInfo {
  return roundAt(id * ROUND_MS);
}

export type Outcome = "WIN" | "LOSS" | "PUSH";

export function outcome(side: Side, open: number, close: number): Outcome {
  if (close === open) return "PUSH";
  const up = close > open;
  return (up && side === "UP") || (!up && side === "DOWN") ? "WIN" : "LOSS";
}

// ---------- deterministic randomness ----------

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- simulated BTC feed (deterministic in time, so every round open/close is reproducible) ----------

const SIM_BASE = 64000;
const STEP_MS = 5000;

function noiseAt(step: number): number {
  return rng(hashStr("btc" + step))() - 0.5;
}

export function simPrice(t: number): number {
  const s = t / 1000;
  const wave =
    0.012 * Math.sin(s / 5400 + 1.3) +
    0.006 * Math.sin(s / 1300 + 0.4) +
    0.0025 * Math.sin(s / 333 + 2.1) +
    0.0012 * Math.sin(s / 71 + 0.7);
  const step = Math.floor(t / STEP_MS);
  const frac = (t % STEP_MS) / STEP_MS;
  const n = noiseAt(step) * (1 - frac) + noiseAt(step + 1) * frac;
  return Math.round(SIM_BASE * Math.exp(wave + n * 0.0008) * 100) / 100;
}

export interface RoundPrice {
  open: number;
  close: number;
}
