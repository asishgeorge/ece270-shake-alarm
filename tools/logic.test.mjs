import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shakeLevel, validatePairName, randomPairName, topics, PeakWindow, readingPayload,
  syntheticSample, parseCommand, roundTrip, StatusHold, localDecision, RollingMedian, GRAVITY,
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
