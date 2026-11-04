// Pure logic for the Shake Alarm phone page (no DOM, no network).
// Kept separate so it can be unit-tested with `node --test`.

export const GRAVITY = 9.81;
export const ROOT = 'ece270';

/** Shake level in m/s²: how far the total acceleration is from gravity alone. 0 = still. */
export function shakeLevel({ ax, ay, az }) {
  return Math.abs(Math.sqrt(ax * ax + ay * ay + az * az) - GRAVITY);
}

// ---------------------------------------------------------------- pairing names

const PAIR_RE = /^[a-z0-9][a-z0-9-]{2,30}[a-z0-9]$/;
const ADJECTIVES = ['calm', 'brave', 'quick', 'quiet', 'bright', 'lucky', 'sunny', 'misty', 'swift', 'gentle',
  'bold', 'clever', 'happy', 'mellow', 'noble', 'proud', 'rapid', 'silver', 'golden', 'wild'];
const NOUNS = ['otter', 'orca', 'heron', 'cedar', 'salmon', 'raven', 'eagle', 'maple', 'seal', 'fern',
  'bear', 'fox', 'owl', 'kelp', 'lynx', 'moose', 'wren', 'crab', 'deer', 'hawk'];

export function normalizePairName(s) {
  return String(s ?? '').trim().toLowerCase();
}

/** Pairing names are chosen by the student. No student IDs. 4–32 chars: a-z, 0-9, dash. */
export function validatePairName(s) {
  const name = normalizePairName(s);
  if (!PAIR_RE.test(name)) {
    return { ok: false, reason: 'Use 4–32 lowercase letters, numbers or dashes, e.g. calm-otter-42.' };
  }
  return { ok: true, name };
}

export function randomPairName(rand = Math.random) {
  const pick = (list) => list[Math.floor(rand() * list.length)];
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}-${10 + Math.floor(rand() * 90)}`;
}

/** All MQTT topics, in one place. Private topics live under ece270/pair/<name>/. */
export function topics(pair) {
  const base = `${ROOT}/pair/${pair}`;
  return {
    readings: `${base}/phone`,               // phone -> laptop, sensor readings, QoS 0
    phoneStatus: `${base}/phone/status`,     // hello / in-use / offline (Last Will), QoS 1
    cmd: `${base}/cmd`,                      // laptop -> phone, {"cmd":"ALERT"|"OK","t":...}, QoS 1
    laptop: `${base}/laptop`,                // laptop heartbeat every 5 s
    classPhone: `${ROOT}/class/phones/${pair}`, // only when "Share with class" is on
    // Class console -> phones that chose it as decision maker. ONE combined message for all
    // phones, {"d":{"<name>":{"cmd","t"}}}, because EMQX's free tier allows each client to
    // publish at most 10 messages per second. Only the instructor login may publish here.
    classDecisions: `${ROOT}/class/cmd/all`,
    classBroadcast: `${ROOT}/class/broadcast`,  // class console -> every sharing phone (instructor only)
  };
}

// ---------------------------------------------------------------- sampling

/**
 * Phones fire ~60 motion events per second, but we publish only 5 per second.
 * Sending just the latest sample could miss a short, sharp shake, so each 200 ms
 * window keeps the sample with the largest shake level.
 */
export class PeakWindow {
  constructor() { this.best = null; this.count = 0; }
  add(sample) {
    const level = shakeLevel(sample);
    this.count += 1;
    if (!this.best || level > this.best.level) this.best = { ...sample, level };
  }
  take() {
    const best = this.best;
    this.best = null;
    this.count = 0;
    return best;
  }
}

const r2 = (x) => Math.round(x * 100) / 100;
const r1 = (x) => Math.round(x * 10) / 10;

/** The JSON message the phone publishes to its readings topic. */
export function readingPayload(sample, t, seq) {
  return {
    ax: r2(sample.ax), ay: r2(sample.ay), az: r2(sample.az),
    gx: r1(sample.gx ?? 0), gy: r1(sample.gy ?? 0), gz: r1(sample.gz ?? 0),
    t, seq,
  };
}

/**
 * Synthetic motion for phones without a motion sensor, the "Simulate a shake"
 * button and automated tests. Still: gravity plus a little noise. Shaking: a strong
 * 6 Hz oscillation on two axes.
 */
export function syntheticSample(tMs, shaking, rand = Math.random) {
  const noise = () => (rand() - 0.5) * 0.2;
  if (!shaking) return { ax: noise(), ay: GRAVITY + noise(), az: noise(), gx: noise(), gy: noise(), gz: noise() };
  const w = 2 * Math.PI * 6 * (tMs / 1000);
  return {
    ax: 14 * Math.sin(w) + noise(),
    ay: GRAVITY + 8 * Math.cos(w) + noise(),
    az: 6 * Math.sin(2 * w) + noise(),
    gx: 200 * Math.cos(w), gy: 150 * Math.sin(w), gz: 50 * Math.sin(2 * w),
  };
}

// ---------------------------------------------------------------- commands

/** The class console's combined decisions message -> this phone's entry, or null. */
export function classDecisionFor(text, pair) {
  try {
    const entry = JSON.parse(text)?.d?.[pair];
    if (!entry) return null;
    const cmd = String(entry.cmd ?? '').toUpperCase();
    if (cmd !== 'ALERT' && cmd !== 'OK') return null;
    return { cmd, t: Number.isFinite(entry.t) ? entry.t : null };
  } catch {
    return null;
  }
}

/** Accepts the JSON the starter flow sends, or a bare "ALERT"/"OK" string. */
export function parseCommand(text) {
  const raw = String(text ?? '').trim();
  let cmd = raw;
  let t = null;
  if (raw.startsWith('{')) {
    try {
      const obj = JSON.parse(raw);
      cmd = String(obj.cmd ?? '');
      t = Number.isFinite(obj.t) ? obj.t : null;
    } catch {
      return null;
    }
  } else if (raw.startsWith('"')) {
    try { cmd = String(JSON.parse(raw)); } catch { return null; }
  }
  cmd = cmd.toUpperCase();
  if (cmd !== 'ALERT' && cmd !== 'OK') return null;
  return { cmd, t };
}

/** Round trip in ms, only when the command echoes a timestamp this phone created. */
export function roundTrip(cmdT, now, sentTimes) {
  if (cmdT == null || !sentTimes.has(cmdT)) return null;
  const rtt = now - cmdT;
  return rtt >= 0 && rtt < 60000 ? rtt : null;
}

// ---------------------------------------------------------------- display

/**
 * The status on screen changes at most once per `holdMs`, so it can never flicker,
 * however fast commands arrive. The latest requested state wins.
 */
export class StatusHold {
  constructor(holdMs = 1000) {
    this.holdMs = holdMs;
    this.shown = null;
    this.pending = null;
    this.lastChange = -Infinity;
  }
  /** Returns the state to display now, or null if nothing changes yet. */
  request(state, now) {
    if (state === this.shown) { this.pending = null; return null; }
    if (now - this.lastChange >= this.holdMs) return this.#apply(state, now);
    this.pending = state;
    return null;
  }
  /** Call regularly; returns a delayed state when its hold time has passed. */
  tick(now) {
    if (this.pending !== null && now - this.lastChange >= this.holdMs) {
      const s = this.pending;
      this.pending = null;
      if (s !== this.shown) return this.#apply(s, now);
    }
    return null;
  }
  #apply(state, now) {
    this.shown = state;
    this.lastChange = now;
    this.pending = null;
    return state;
  }
}

/** Decision made on the phone itself (Level 1). */
export function localDecision(level, threshold) {
  return level > threshold ? 'ALERT' : 'OK';
}

/** Keeps the last N values to compute a median, e.g. of round-trip times. */
export class RollingMedian {
  constructor(size = 20) { this.size = size; this.values = []; }
  add(v) { this.values.push(v); if (this.values.length > this.size) this.values.shift(); }
  get value() {
    if (!this.values.length) return null;
    const s = [...this.values].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
}
