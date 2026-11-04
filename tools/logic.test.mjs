import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shakeLevel, validatePairName, randomPairName, topics, PeakWindow, readingPayload, classDecisionFor,
  syntheticSample, parseCommand, roundTrip, StatusHold, localDecision, RollingMedian, GRAVITY,
  parseRecSec, RecordingBuffer, recordingBatch, recordingSimSample, REC_MIN_GAP_MS,
} from '../phone/logic.js';

test('shake level is ~0 when still and large when shaking', () => {
  assert.ok(shakeLevel({ ax: 0, ay: GRAVITY, az: 0 }) < 1e-9);
  assert.ok(shakeLevel({ ax: 0, ay: 0, az: -GRAVITY }) < 1e-9, 'orientation does not matter');
  assert.ok(shakeLevel({ ax: 15, ay: GRAVITY, az: 5 }) > 6);
});

test('pairing names: valid, invalid, normalised', () => {
  assert.deepEqual(validatePairName('  Calm-Otter-42 '), { ok: true, name: 'calm-otter-42' });
  for (const bad of ['', 'ab', '-abc', 'abc-', 'has space', 'a/b+c', 'x'.repeat(33), 'émile']) {
    assert.equal(validatePairName(bad).ok, false, bad);
  }
  for (let i = 0; i < 200; i++) assert.ok(validatePairName(randomPairName()).ok);
});

test('topics are scoped under the pairing name', () => {
  const t = topics('calm-otter-42');
  assert.equal(t.readings, 'ece270/pair/calm-otter-42/phone');
  assert.equal(t.cmd, 'ece270/pair/calm-otter-42/cmd');
  assert.equal(t.classPhone, 'ece270/class/phones/calm-otter-42');
  assert.equal(t.classDecisions, 'ece270/class/cmd/all', 'must stay under the instructor-only ece270/class/cmd/#');
  assert.equal(t.classBroadcast, 'ece270/class/broadcast');
  assert.ok(t.phoneStatus.startsWith(t.readings + '/'), 'laptop gets readings + status with one phone/# subscription');
});

test('peak window keeps the strongest sample and resets', () => {
  const w = new PeakWindow();
  w.add({ ax: 0, ay: GRAVITY, az: 0 });
  w.add({ ax: 12, ay: GRAVITY, az: 0 });
  w.add({ ax: 1, ay: GRAVITY, az: 0 });
  const best = w.take();
  assert.equal(best.ax, 12);
  assert.equal(w.take(), null);
});

test('reading payload is rounded and carries t and seq', () => {
  const p = readingPayload({ ax: 1.23456, ay: 9.876, az: -0.004, gx: 10.06 }, 1000, 7);
  assert.deepEqual(p, { ax: 1.23, ay: 9.88, az: -0, gx: 10.1, gy: 0, gz: 0, t: 1000, seq: 7 });
});

test('synthetic samples: still is calm, shaking crosses a threshold of 6 within a window', () => {
  for (let t = 0; t < 2000; t += 16) assert.ok(shakeLevel(syntheticSample(t, false)) < 0.5);
  for (let start = 0; start < 2000; start += 200) {
    const w = new PeakWindow();
    for (let t = start; t < start + 200; t += 16) w.add(syntheticSample(t, true));
    assert.ok(w.take().level > 6, `window at ${start}`);
  }
});

test('commands: JSON, bare strings, junk', () => {
  assert.deepEqual(parseCommand('{"cmd":"ALERT","t":123}'), { cmd: 'ALERT', t: 123 });
  assert.deepEqual(parseCommand('{"cmd":"ok","t":null}'), { cmd: 'OK', t: null });
  assert.deepEqual(parseCommand('ALERT'), { cmd: 'ALERT', t: null });
  assert.deepEqual(parseCommand('"OK"'), { cmd: 'OK', t: null });
  assert.equal(parseCommand('BOOM'), null);
  assert.equal(parseCommand('{not json'), null);
});

test('class decisions: pick this phone out of the combined message', () => {
  const msg = JSON.stringify({ d: { 'calm-otter-42': { cmd: 'ALERT', t: 5 }, 'other-name-10': { cmd: 'OK', t: 6 } } });
  assert.deepEqual(classDecisionFor(msg, 'calm-otter-42'), { cmd: 'ALERT', t: 5 });
  assert.equal(classDecisionFor(msg, 'not-there-11'), null);
  assert.equal(classDecisionFor('{"d":{"x-y-z":{"cmd":"BOOM"}}}', 'x-y-z'), null);
  assert.equal(classDecisionFor('garbage', 'x-y-z'), null);
});

test('round trip only for timestamps this phone sent', () => {
  const sent = new Set([1000]);
  assert.equal(roundTrip(1000, 1250, sent), 250);
  assert.equal(roundTrip(999, 1250, sent), null, 'spoofed or foreign timestamp');
  assert.equal(roundTrip(null, 1250, sent), null);
});

test('status hold: at most one change per second, latest wins', () => {
  const h = new StatusHold(1000);
  assert.equal(h.request('OK', 0), 'OK');
  assert.equal(h.request('ALERT', 100), null, 'too soon');
  assert.equal(h.request('OK', 200), null, 'back to the shown state cancels the pending change');
  assert.equal(h.tick(1100), null);
  assert.equal(h.request('ALERT', 1200), 'ALERT');
  assert.equal(h.request('OK', 1300), null);
  assert.equal(h.request('ALERT', 1400), null);
  assert.equal(h.request('OK', 1500), null);
  assert.equal(h.tick(1999), null);
  assert.equal(h.tick(2200), 'OK');
  // Count changes under a 20 Hz storm: never more than 1 per second.
  const s = new StatusHold(1000);
  let changes = 0;
  for (let t = 0; t < 10000; t += 50) {
    if (s.request(t % 100 ? 'ALERT' : 'OK', t)) changes++;
    if (s.tick(t)) changes++;
  }
  assert.ok(changes <= 11, `changes=${changes}`);
});

test('local decision and rolling median', () => {
  assert.equal(localDecision(7, 6), 'ALERT');
  assert.equal(localDecision(6, 6), 'OK');
  const m = new RollingMedian(3);
  assert.equal(m.value, null);
  [100, 300, 200, 900].forEach((v) => m.add(v));
  assert.equal(m.value, 300);
});

// ---------------------------------------------------------------- recording

test('recsec link option: whole seconds 1-60, anything else ignored', () => {
  assert.equal(parseRecSec('4'), 4);
  assert.equal(parseRecSec('1'), 1);
  assert.equal(parseRecSec('60'), 60);
  assert.equal(parseRecSec(' 20 '), 20);
  for (const bad of [null, undefined, '', '0', '61', '100', '-3', '4.5', '1e1', 'abc', '0x10']) {
    assert.equal(parseRecSec(bad), null, String(bad));
  }
});

test('recording buffer: keeps samples 15 ms apart, whole ms, oldest first', () => {
  assert.equal(REC_MIN_GAP_MS, 15);
  const b = new RecordingBuffer();
  const s = { ax: 1, ay: 2, az: 3, gx: 4, gy: 5, gz: 6 };
  assert.equal(b.add(-1, s), false, 'before the start');
  assert.equal(b.add(0.7, s), true);
  assert.equal(b.add(10, s), false, 'only 10 ms after');
  assert.equal(b.add(15.2, s), true);
  assert.equal(b.add(29.9, s), false, '14 ms after');
  assert.equal(b.add(30, s), true);
  assert.deepEqual(b.drain(), [[0, 1, 2, 3, 4, 5, 6], [15, 1, 2, 3, 4, 5, 6], [30, 1, 2, 3, 4, 5, 6]]);
  assert.deepEqual(b.drain(), [], 'drain empties');
  assert.equal(b.add(40, s), false, 'the gap also holds across batches');
  assert.equal(b.add(45, { ax: 1, ay: 2, az: 3 }), true, 'missing rotation counts as 0');
  assert.deepEqual(b.drain(), [[45, 1, 2, 3, 0, 0, 0]]);
  // A 100 Hz sensor is capped at one sample per 20 ms here (50/s); 60 Hz passes through.
  const fast = new RecordingBuffer();
  let kept = 0;
  for (let t = 0; t < 1000; t += 10) if (fast.add(t, s)) kept++;
  assert.equal(kept, 50);
  const normal = new RecordingBuffer();
  kept = 0;
  for (let k = 0; k < 60; k++) if (normal.add((k * 1000) / 60, s)) kept++;
  assert.equal(kept, 60);
});

test('recording batch: contract fields, rounding like readings', () => {
  const meta = { id: 'ece270-ph-abc-1700000000000', start: 1700000000000, dur: 20, other: 'ignored' };
  const rows = [[0, 1.23456, 9.876, -0.004, 10.06, -3.04, 0], [16, 0, 9.81, 0, 0, 0, 0.25]];
  const b = recordingBatch(meta, 0, false, rows);
  assert.deepEqual(b, {
    id: meta.id, i: 0, start: meta.start, dur: 20, end: false,
    s: [[0, 1.23, 9.88, -0, 10.1, -3, 0], [16, 0, 9.81, 0, 0, 0, 0.3]],
  });
  assert.deepEqual(Object.keys(b), ['id', 'i', 'start', 'dur', 'end', 's']);
  const last = recordingBatch(meta, 7, true, []);
  assert.equal(last.end, true);
  assert.deepEqual(last.s, [], 'the last batch may be empty');
  // It rides inside the normal readings message, which keeps all its usual fields.
  const msg = readingPayload({ ax: 0, ay: 9.81, az: 0 }, 1000, 7, b);
  assert.deepEqual(Object.keys(msg), ['ax', 'ay', 'az', 'gx', 'gy', 'gz', 't', 'seq', 'rec']);
  assert.equal(JSON.parse(JSON.stringify(msg)).rec.s[0][3], 0, '-0 becomes 0 in JSON');
});

test('simulated recording: still, tilt, shake, circle', () => {
  const dur = 20000;
  const level = (s) => shakeLevel(s);
  // Pure: same time, same sample.
  for (const t of [0, 5000, 9999, 12345, 17000]) assert.deepEqual(recordingSimSample(t, dur), recordingSimSample(t, dur));
  // 0-20 %: still, gravity on y.
  for (let t = 0; t < 4000; t += 20) {
    const s = recordingSimSample(t, dur);
    assert.deepEqual([s.ax, s.ay, s.az], [0, GRAVITY, 0], `still at ${t}`);
  }
  // 20-45 %: gravity keeps its size and turns from y to z and back.
  let maxZ = 0;
  for (let t = 4000; t < 9000; t += 20) {
    const s = recordingSimSample(t, dur);
    assert.ok(level(s) < 1e-9, `tilt at ${t} keeps |a| = g`);
    maxZ = Math.max(maxZ, s.az);
  }
  assert.ok(maxZ > 9.7, `turns all the way to z (${maxZ})`);
  assert.ok(recordingSimSample(4000, dur).ay > 9.8 && recordingSimSample(8980, dur).ay > 9.7, 'starts and ends on y');
  assert.ok(Math.abs(recordingSimSample(5250, dur).gy) > 10, 'rotation rate while turning');
  // 45-70 %: shaking, over 6 m/s² in every 200 ms window.
  for (let start = 9000; start < 14000; start += 200) {
    const w = new PeakWindow();
    for (let t = start; t < start + 200; t += 20) w.add(recordingSimSample(t, dur));
    assert.ok(w.take().level > 6, `shake window at ${start}`);
  }
  // 70-100 %: about 3 m/s² going round in the x-y plane, about once per second.
  const angles = [];
  for (let t = 14000; t < 20000; t += 20) {
    const s = recordingSimSample(t, dur);
    const r = Math.hypot(s.ax, s.ay - GRAVITY);
    assert.ok(r > 2.5 && r < 3.5 && s.az === 0, `circle at ${t}`);
    angles.push(Math.atan2(s.ay - GRAVITY, s.ax));
  }
  let turns = 0;
  for (let k = 1; k < angles.length; k++) if (angles[k - 1] > 3 && angles[k] < -3) turns++;
  assert.ok(turns >= 5 && turns <= 7, `~1 turn per second over 6 s (${turns})`);
});

test('simulated 4 s recording at 50/s: 200 samples in 0..3980 ms', () => {
  const b = new RecordingBuffer();
  for (let t = 0; t < 4000; t += 20) b.add(t, recordingSimSample(t, 4000));
  const s = recordingBatch({ id: 'x', start: 0, dur: 4 }, 0, true, b.drain()).s;
  assert.equal(s.length, 200);
  assert.equal(s[0][0], 0);
  assert.equal(s.at(-1)[0], 3980);
  for (let k = 1; k < s.length; k++) assert.ok(s[k][0] > s[k - 1][0]);
});
