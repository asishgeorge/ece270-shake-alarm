// Loads the finished student flow + the Class Console into a running Node-RED (default
// http://127.0.0.1:1880), with the class passwords from ../.env.local already filled in.
// Any other flows already in that Node-RED are kept.
//
//   cd tools && npm run deploy-demo
//
// The passwords only pass through a temporary folder outside the repo, deleted straight away.
// Node-RED then stores them encrypted in ~/.node-red/flows_cred.json.

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const NR = process.env.NODE_RED_URL || 'http://127.0.0.1:1880';
const FILES = ['student-solution.json', 'instructor-console.json'];

if (!process.env.STUDENT_PASS || !process.env.INSTRUCTOR_PASS) {
  console.error('Put STUDENT_PASS and INSTRUCTOR_PASS in ../.env.local first.');
  process.exit(2);
}

try {
  await fetch(NR + '/flows', { headers: { 'Node-RED-API-Version': 'v1' } });
} catch {
  console.error(`No Node-RED at ${NR}. Start it with: local/node-red.sh start`);
  process.exit(2);
}

const ours = new Map();
const tmp = mkdtempSync(join(tmpdir(), 'ece270-flows-'));
try {
  execFileSync(process.execPath, [join(HERE, 'build-flows.mjs'), '--class-test', tmp], { env: process.env, stdio: 'ignore' });
  for (const f of FILES) for (const n of JSON.parse(readFileSync(join(tmp, f), 'utf8'))) ours.set(n.id, n);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

const existing = await (await fetch(NR + '/flows', { headers: { 'Node-RED-API-Version': 'v1' } })).json();
const kept = existing.filter((n) => !ours.has(n.id));
const otherBases = kept.filter((n) => n.type === 'ui-base');
if (otherBases.length) {
  console.warn(`Note: this Node-RED already has another Dashboard 2.0 base (${otherBases.map((b) => b.name).join(', ')}). Two bases can clash.`);
}

const res = await fetch(NR + '/flows', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Node-RED-Deployment-Type': 'full', 'Node-RED-API-Version': 'v1' },
  body: JSON.stringify([...kept, ...ours.values()]),
});
if (!res.ok) {
  console.error(`Deploy failed: HTTP ${res.status} ${await res.text()}`);
  process.exit(1);
}

// Node-RED keeps the encryption key and the encrypted passwords here; make them private to this user.
if (NR.includes('127.0.0.1')) {
  for (const f of ['.config.runtime.json', 'flows_cred.json']) {
    const path = join(process.env.HOME || '', '.node-red', f);
    if (existsSync(path)) chmodSync(path, 0o600);
  }
}

console.log(`Deployed ${ours.size} nodes (student solution + Class Console); kept ${kept.length} other nodes.`);
console.log(`Editor:            ${NR}`);
console.log(`Student dashboard: ${NR}/dashboard/shake`);
console.log(`Class Console:     ${NR}/dashboard/console`);
