// Checks the class broker from class-broker.json: logins, both ports, and the deny rules.
// Run once after setting up the broker and once per term:
//   cd tools && npm run broker-check        (reads STUDENT_PASS / INSTRUCTOR_PASS from ../.env.local)
// Never prints passwords.

import mqtt from 'mqtt';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const cfg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'class-broker.json'), 'utf8'));
const MQTTS = `mqtts://${cfg.host}:${cfg.mqttTlsPort}`;
const WSS = `wss://${cfg.host}:${cfg.websocketTlsPort}${cfg.websocketPath}`;
const { STUDENT_PASS, INSTRUCTOR_PASS } = process.env;
if (!STUDENT_PASS || !INSTRUCTOR_PASS) {
  console.error('Set STUDENT_PASS and INSTRUCTOR_PASS in ../.env.local first.');
  process.exit(2);
}
setTimeout(() => { console.log('FAIL  timed out'); process.exit(2); }, 60000).unref();

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
};
const rnd = () => Math.random().toString(16).slice(2, 8);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(url, username, password, protocolVersion = 4) {
  return new Promise((resolve) => {
    const started = Date.now();
    const c = mqtt.connect(url, { clientId: `check-${rnd()}`, username, password, protocolVersion, reconnectPeriod: 0, connectTimeout: 10000 });
    c.once('connect', () => resolve({ c, ok: true, ms: Date.now() - started }));
    c.once('error', (e) => { c.end(true); resolve({ c, ok: false, err: e.message }); });
  });
}

console.log(`Broker: ${cfg.host}\n`);

// 1. Logins on both ports
const s1 = await connect(MQTTS, cfg.studentUser, STUDENT_PASS);
check(`student login, MQTT over TLS (${cfg.mqttTlsPort}) like Node-RED`, s1.ok, s1.ok ? `${s1.ms} ms` : s1.err);
const s2 = await connect(WSS, cfg.studentUser, STUDENT_PASS);
check(`student login, WebSocket over TLS (${cfg.websocketTlsPort}${cfg.websocketPath}) like the phone`, s2.ok, s2.ok ? `${s2.ms} ms` : s2.err);
const ins = await connect(MQTTS, cfg.instructorUser, INSTRUCTOR_PASS);
check('instructor login', ins.ok, ins.ok ? `${ins.ms} ms` : ins.err);
const bad = await connect(MQTTS, cfg.studentUser, 'definitely-wrong-' + rnd());
check('wrong password is rejected', !bad.ok, bad.err || 'it connected!');
if (!s1.ok || !ins.ok) { console.log('\nCannot continue without both logins.'); process.exit(1); }

// 2. Deny rules: the instructor listens, the student tries to publish (MQTT 5 so the broker can say "not authorised").
const stu5 = await connect(MQTTS, cfg.studentUser, STUDENT_PASS, 5);
const pair = `check-${rnd()}`;
const heard = [];
await new Promise((r) => ins.c.subscribe(['ece270/class/broadcast', 'ece270/class/cmd/#', `ece270/pair/${pair}/#`, 'ece270/class/phones/+'], { qos: 1 }, r));
ins.c.on('message', (topic, buf) => heard.push({ topic, text: buf.toString() }));

function pub(client, topic, text) {
  return new Promise((resolve) => client.c.publish(topic, text, { qos: 1 }, (err, packet) => resolve({ err, reason: packet?.reasonCode })));
}
const marker = `check-${rnd()}`;
const r1 = await pub(stu5, 'ece270/class/broadcast', JSON.stringify({ level: 'info', text: marker }));
const r2 = await pub(stu5, 'ece270/class/cmd/all', JSON.stringify({ marker }));
const r3 = await pub(stu5, `ece270/pair/${pair}/phone`, JSON.stringify({ marker }));
const r4 = await pub(stu5, `ece270/class/phones/${pair}`, JSON.stringify({ marker }));
const insMarker = `instructor-${rnd()}`;
const r5 = await pub(ins, 'ece270/class/broadcast', JSON.stringify({ level: 'clear', marker: insMarker }));
await sleep(2000);
const got = (topic) => heard.some((h) => h.topic === topic && h.text.includes(marker));
const reason = (r) => (r.err ? r.err.message : `reason code ${r.reason ?? 0}`);

check('student CANNOT publish to ece270/class/broadcast', !got('ece270/class/broadcast'), reason(r1));
check('student CANNOT publish to ece270/class/cmd/...', !got('ece270/class/cmd/all'), reason(r2));
check('student CAN publish to its own pair topic', got(`ece270/pair/${pair}/phone`), reason(r3));
check('student CAN share with the class console', got(`ece270/class/phones/${pair}`), reason(r4));
check('instructor CAN publish to ece270/class/broadcast', heard.some((h) => h.topic === 'ece270/class/broadcast' && h.text.includes(insMarker)), reason(r5));

for (const x of [s1, s2, ins, stu5]) x.c?.end(true);
console.log(failed ? `\n${failed} check(s) failed.` : '\nAll broker checks passed.');
process.exit(failed ? 1 : 0);
