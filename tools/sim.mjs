// Classroom load simulation: N phones + N laptops on one broker, plus the real class console.
//
//  - Phones connect over WebSocket (like the real phone page) and publish 5 readings/s,
//    with a 1.5 s shake every 6-12 s, and everyone shaking together at --quake-at seconds.
//  - Laptops connect over plain MQTT (like Node-RED) and run the same logic as the solution
//    flow: shake level > threshold -> ALERT, only send changes, heartbeat every 5 s.
//  - With --share, phones also share with the class console, which should detect the earthquake.
//
// Usage: node sim.mjs [--phones 30] [--seconds 60] [--quake-at 30] [--share]
//                     [--phone-url ws://localhost:9001] [--laptop-url mqtt://localhost:1883]
//                     [--user student] [--pass dev-student]

import mqtt from 'mqtt';
import { topics, syntheticSample, PeakWindow, readingPayload, shakeLevel } from '../phone/logic.js';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const N = Number(opt('--phones', 30));
const SECONDS = Number(opt('--seconds', 60));
const QUAKE_AT = Number(opt('--quake-at', 30));
const SHARE = args.includes('--share');
const PHONE_URL = opt('--phone-url', 'ws://localhost:9001');
const LAPTOP_URL = opt('--laptop-url', 'mqtt://localhost:1883');
const USER = opt('--user', 'student');
const PASS = opt('--pass', 'dev-student');
const THRESHOLD = 6;

const t0 = Date.now();
const stats = {
  readingsSent: 0, readingsReceived: 0, bytesPublished: 0,
  bursts: 0, burstsDetected: 0, falseAlerts: 0, rtt: [], detect: [],
  quakeReceived: new Map(), falseQuakes: new Set(), connectFailures: 0,
};
const pct = (arr, q) => { if (!arr.length) return '-'; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };

function connect(url, clientId, extra = {}) {
  return new Promise((resolve) => {
    const c = mqtt.connect(url, { clientId, username: USER || undefined, password: PASS || undefined, keepalive: 10, reconnectPeriod: 2000, protocolVersion: 4, ...extra });
    const fail = setTimeout(() => { stats.connectFailures++; resolve(c); }, 10000);
    c.once('connect', () => { clearTimeout(fail); resolve(c); });
  });
}

function publish(c, topic, obj, qos = 0) {
  const payload = typeof obj === 'string' ? obj : JSON.stringify(obj);
  stats.bytesPublished += topic.length + payload.length;
  c.publish(topic, payload, { qos });
}

// ------------------------------------------------------------------ phone
async function phone(i) {
  const pair = `sim-phone-${String(i).padStart(2, '0')}`;
  const T = topics(pair);
  const cid = `sim-ph-${i}-${Math.random().toString(16).slice(2, 6)}`;
  const c = await connect(PHONE_URL, cid, { will: { topic: T.phoneStatus, payload: JSON.stringify({ state: 'offline', cid }), qos: 1, retain: false } });
  const sent = new Set();
  let burst = null;              // { start, end, detected }
  let nextBurst = Date.now() + 3000 + Math.random() * 6000;
  let lastRtt = null;
  let seq = 0;

  c.subscribe([T.cmd, T.laptop, T.phoneStatus], { qos: 1 });
  if (SHARE) c.subscribe([T.classBroadcast, T.classCmd], { qos: 1 });
  publish(c, T.phoneStatus, { state: 'hello', cid }, 1);

  c.on('message', (topic, buf) => {
    const now = Date.now();
    if (topic === T.cmd) {
      const m = JSON.parse(buf.toString());
      if (sent.has(m.t)) { lastRtt = now - m.t; stats.rtt.push(lastRtt); }
      if (m.cmd === 'ALERT') {
        const inBurst = burst && now >= burst.start && now <= burst.end + 1500;
        if (inBurst && !burst.detected) { burst.detected = true; stats.burstsDetected++; stats.detect.push(now - burst.start); }
        if (!inBurst) stats.falseAlerts++;
      }
    } else if (topic === T.classBroadcast) {
      const m = JSON.parse(buf.toString());
      if (m.level !== 'alert') return;
      const sinceQuake = now - (t0 + QUAKE_AT * 1000);
      if (sinceQuake < 0 || sinceQuake > 15000) stats.falseQuakes.add(m.t);          // fired with no class-wide shake
      else if (!stats.quakeReceived.has(pair)) stats.quakeReceived.set(pair, sinceQuake);
    }
  });

  const quakeStart = t0 + QUAKE_AT * 1000;
  const timer = setInterval(() => {
    const now = Date.now();
    if (!burst || now > burst.end + 1500) {
      if (now >= quakeStart && now < quakeStart + 500 && !(burst && burst.quake)) {
        burst = { start: now, end: now + 3000, detected: false, quake: true }; stats.bursts++;
      } else if (now >= nextBurst && Math.abs(now - quakeStart) <= 5000) {
        // Keep individual shakes away from the class-wide one, without bunching them up afterwards.
        nextBurst = quakeStart + 5000 + Math.random() * 9000;
      } else if (now >= nextBurst) {
        burst = { start: now, end: now + 1500, detected: false }; stats.bursts++;
        nextBurst = now + 6000 + Math.random() * 6000;
      }
    }
    const shaking = burst && now >= burst.start && now <= burst.end;
    const w = new PeakWindow();
    for (let k = 0; k < 200; k += 16) w.add(syntheticSample(now - 200 + k, shaking));
    const s = w.take();
    publish(c, T.readings, readingPayload(s, now, ++seq));
    sent.add(now);
    stats.readingsSent++;
    if (SHARE) publish(c, T.classPhone, { s: Math.round(shakeLevel(s) * 10) / 10, t: now, rtt: lastRtt, by: 'laptop' });
  }, 200);
  return () => { clearInterval(timer); c.end(true); };
}

// ------------------------------------------------------------------ laptop (same logic as the solution flow)
async function laptop(i) {
  const pair = `sim-phone-${String(i).padStart(2, '0')}`;
  const T = topics(pair);
  const c = await connect(LAPTOP_URL, `sim-lt-${i}-${Math.random().toString(16).slice(2, 6)}`);
  let last = null;
  c.subscribe(`${T.readings}/#`, { qos: 0 });
  c.on('message', (topic, buf) => {
    if (topic.endsWith('/status')) return;
    const r = JSON.parse(buf.toString());
    stats.readingsReceived++;
    const cmd = shakeLevel(r) > THRESHOLD ? 'ALERT' : 'OK';
    if (cmd === last) return;            // filter node: only send changes
    last = cmd;
    publish(c, T.cmd, { cmd, t: r.t }, 1);
  });
  const beat = setInterval(() => publish(c, T.laptop, { state: 'online', last, t: Date.now() }), 5000);
  return () => { clearInterval(beat); c.end(true); };
}

// ------------------------------------------------------------------ run
console.log(`Simulating ${N} phones + ${N} laptops for ${SECONDS} s (earthquake at ${QUAKE_AT} s, sharing ${SHARE ? 'on' : 'off'})`);
const stops = await Promise.all([
  ...Array.from({ length: N }, (_, i) => laptop(i + 1)),
  ...Array.from({ length: N }, (_, i) => phone(i + 1)),
]);
await new Promise((r) => setTimeout(r, SECONDS * 1000));
stops.forEach((s) => s());

const quakeDelays = [...stats.quakeReceived.values()];
const mbPerHalfHour = (stats.bytesPublished / SECONDS) * 1800 / 1e6;
console.log(`
Connections failed:          ${stats.connectFailures}
Readings sent / received:    ${stats.readingsSent} / ${stats.readingsReceived}  (${(100 * (1 - stats.readingsReceived / stats.readingsSent)).toFixed(2)}% lost)
Shakes detected:             ${stats.burstsDetected} of ${stats.bursts}
False alarms:                ${stats.falseAlerts}
Round trip phone->laptop->phone (ms): median ${pct(stats.rtt, 0.5)}, 95th ${pct(stats.rtt, 0.95)}, max ${pct(stats.rtt, 1)}
Shake start -> ALERT on phone (ms):   median ${pct(stats.detect, 0.5)}, 95th ${pct(stats.detect, 0.95)}
Earthquake alert reached:    ${SHARE ? `${stats.quakeReceived.size} of ${N} phones, ${pct(quakeDelays, 0.5)} ms after the class started shaking` : 'n/a (no --share)'}
False earthquakes:           ${SHARE ? stats.falseQuakes.size : 'n/a'}
Data published by clients:   ${(stats.bytesPublished / 1e6).toFixed(1)} MB in ${SECONDS} s  (~${mbPerHalfHour.toFixed(0)} MB per 30 min before broker fan-out)
`);
process.exit(0);
