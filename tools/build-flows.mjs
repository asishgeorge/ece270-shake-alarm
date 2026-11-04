// Generates every file that depends on the class broker settings, from ../class-broker.json:
//   ../phone/config.js
//   ../node-red/student-starter.json    what students import (pairing + plumbing pre-built)
//   ../node-red/student-solution.json   the finished activity (for the TA and the demo)
//   ../node-red/instructor-console.json the class console
//
// Usage:
//   node build-flows.mjs                         normal build for the class broker
//   node build-flows.mjs --local <dir> [--student-pass x] [--instructor-pass y]
//                                                flows for a local Mosquitto (localhost:1883, no TLS),
//                                                with test passwords embedded, written to <dir> only.
//   node --env-file=../.env.local build-flows.mjs --class-test <dir>
//                                                flows for the class broker WITH the passwords from
//                                                STUDENT_PASS / INSTRUCTOR_PASS embedded, for testing on
//                                                this machine only. Refuses to write inside the repo.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const LOCAL_DIR = opt('--local');
const CLASS_TEST_DIR = opt('--class-test');
const cfg = JSON.parse(readFileSync(join(ROOT, 'class-broker.json'), 'utf8'));

if (CLASS_TEST_DIR) {
  if (resolve(CLASS_TEST_DIR).startsWith(ROOT + '/') && !resolve(CLASS_TEST_DIR).startsWith(join(ROOT, '.local'))) {
    console.error('--class-test embeds real passwords: write it outside the repo (or to .local/, which git ignores).');
    process.exit(2);
  }
  if (!process.env.STUDENT_PASS || !process.env.INSTRUCTOR_PASS) {
    console.error('--class-test needs STUDENT_PASS and INSTRUCTOR_PASS (run with --env-file=../.env.local).');
    process.exit(2);
  }
}

const broker = LOCAL_DIR
  ? { host: 'localhost', port: '1883', tls: false, studentPass: opt('--student-pass'), instructorPass: opt('--instructor-pass') }
  : CLASS_TEST_DIR
    ? { host: cfg.host, port: String(cfg.mqttTlsPort), tls: true, studentPass: process.env.STUDENT_PASS, instructorPass: process.env.INSTRUCTOR_PASS }
    : { host: cfg.host, port: String(cfg.mqttTlsPort), tls: true };

// Stable ids, so regenerated files diff cleanly and re-imports replace rather than duplicate.
const id = (key) => createHash('sha1').update('ece270-shake:' + key).digest('hex').slice(0, 16);

// ------------------------------------------------------------------ shared config nodes

const BASE = id('ui-base');
const THEME = id('ui-theme');
const TLS = id('tls');

function uiBase() {
  return {
    id: BASE, type: 'ui-base', name: 'ECE 270', path: '/dashboard', appIcon: '', includeClientData: true,
    acceptsClientConfig: ['ui-notification', 'ui-control'], showPathInSidebar: false, headerContent: 'page',
    navigationStyle: 'default', titleBarStyle: 'default', showReconnectNotification: true,
    notificationDisplayTime: 1, showDisconnectNotification: true, allowInstall: false,
  };
}

function uiTheme() {
  return {
    id: THEME, type: 'ui-theme', name: 'ECE 270',
    colors: { surface: '#1d2433', primary: '#0d5fb3', bgPage: '#f6f7f9', groupBg: '#ffffff', groupOutline: '#d9dde5' },
    sizes: { density: 'default', pagePadding: '12px', groupGap: '12px', groupBorderRadius: '6px', widgetGap: '12px' },
  };
}

function uiPage(key, name, path, order) {
  return {
    id: id(key), type: 'ui-page', name, ui: BASE, path, icon: 'home', layout: 'grid', theme: THEME,
    breakpoints: [
      { name: 'Default', px: '0', cols: '3' }, { name: 'Tablet', px: '576', cols: '6' },
      { name: 'Small Desktop', px: '768', cols: '9' }, { name: 'Desktop', px: '1024', cols: '12' },
    ],
    order, className: '', visible: 'true', disabled: 'false',
  };
}

function uiGroup(key, name, page, width, order) {
  return {
    id: id(key), type: 'ui-group', name, page: id(page), width: String(width), height: '1', order,
    showTitle: true, className: '', visible: 'true', disabled: 'false', groupType: 'default',
  };
}

function tlsConfig() {
  return {
    id: TLS, type: 'tls-config', name: 'Class broker TLS', cert: '', key: '', ca: '', certname: '', keyname: '',
    caname: '', servername: '', verifyservercert: true, alpnprotocol: '',
  };
}

function mqttBroker(key, name, user, pass, autoConnect = true) {
  const node = {
    id: id(key), type: 'mqtt-broker', name, broker: broker.host, port: broker.port,
    tls: broker.tls ? TLS : '', clientid: '', autoConnect, usetls: broker.tls, protocolVersion: '4',
    keepalive: '30', cleansession: true, autoUnsubscribe: true,
    birthTopic: '', birthQos: '0', birthRetain: 'false', birthPayload: '', birthMsg: {},
    closeTopic: '', closeQos: '0', closeRetain: 'false', closePayload: '', closeMsg: {},
    willTopic: '', willQos: '0', willRetain: 'false', willPayload: '', willMsg: {},
    userProps: '', sessionExpiry: '',
  };
  // Node-RED never exports passwords. The username is pre-filled; students type the class password.
  node.credentials = pass ? { user, password: pass } : { user };
  return node;
}

// ------------------------------------------------------------------ node helpers

const fn = (key, z, name, func, outputs, x, y, wires, info = '') => ({
  id: id(key), type: 'function', z, name, func, outputs, timeout: 0, noerr: 0, initialize: '', finalize: '',
  libs: [], info, x, y, wires,
});
const inject = (key, z, name, { repeat = '', once = false, onceDelay = '0.5', payload = '', payloadType = 'date', topic = '' }, x, y, wires) => ({
  id: id(key), type: 'inject', z, name, props: [{ p: 'payload' }, { p: 'topic', vt: 'str' }], repeat, crontab: '',
  once, onceDelay, topic, payload, payloadType, x, y, wires,
});
const comment = (key, z, name, info, x, y) => ({ id: id(key), type: 'comment', z, name, info, x, y, wires: [] });
const change = (key, z, name, rules, x, y, wires) => ({
  id: id(key), type: 'change', z, name, rules, action: '', property: '', from: '', to: '', reg: false, x, y, wires,
});
const mqttIn = (key, z, name, brokerKey, topic, x, y, wires) => ({
  id: id(key), type: 'mqtt in', z, name, topic, qos: '0', datatype: 'json', broker: id(brokerKey), nl: false,
  rap: true, rh: 0, inputs: topic ? 0 : 1, x, y, wires,
});
const mqttOut = (key, z, name, brokerKey, x, y) => ({
  id: id(key), type: 'mqtt out', z, name, topic: '', qos: '1', retain: 'false', respTopic: '', contentType: '',
  userProps: '', correl: '', expiry: '', broker: id(brokerKey), x, y, wires: [],
});
const uiText = (key, z, group, order, label, x, y) => ({
  id: id(key), type: 'ui-text', z, group: id(group), order, width: 0, height: 0, name: '', label,
  format: '{{msg.payload}}', layout: 'row-spread', style: false, font: '', fontSize: 16, color: '#1d2433',
  wrapText: true, className: '', value: 'payload', valueType: 'msg', x, y, wires: [],
});
const uiTextInput = (key, z, group, order, label, topic, x, y, wires) => ({
  id: id(key), type: 'ui-text-input', z, group: id(group), name: '', label, order, width: 0, height: 0,
  topic, topicType: 'str', mode: 'text', tooltip: '', delay: 300, passthru: true, sendOnDelay: false,
  sendOnBlur: true, sendOnEnter: true, className: '', clearable: false, sendOnClear: false, icon: '',
  iconPosition: 'left', iconInnerPosition: 'inside', x, y, wires,
});
const uiSlider = (key, z, group, order, label, topic, min, max, step, x, y, wires) => ({
  id: id(key), type: 'ui-slider', z, group: id(group), name: '', label, tooltip: '', order, width: 0, height: 0,
  passthru: false, outs: 'end', topic, topicType: 'str', thumbLabel: true, showTicks: 'false', min, max, step,
  className: '', iconPrepend: '', iconAppend: '', color: '', colorTrack: '', colorThumb: '', showTextField: false,
  x, y, wires,
});
const uiButton = (key, z, group, order, label, topic, x, y, wires) => ({
  id: id(key), type: 'ui-button', z, group: id(group), name: '', label, order, width: 0, height: 0,
  emulateClick: false, tooltip: '', color: '', bgcolor: '', className: '', icon: '', iconPosition: 'left',
  payload: topic, payloadType: 'str', topic, topicType: 'str', buttonColor: '', textColor: '', iconColor: '',
  enableClick: true, enablePointerdown: false, pointerdownPayload: '', pointerdownPayloadType: 'str',
  enablePointerup: false, pointerupPayload: '', pointerupPayloadType: 'str', x, y, wires,
});
const setFlow = (prop) => [{ t: 'set', p: prop, pt: 'flow', to: 'payload', tot: 'msg' }];
const setPayload = (value) => [{ t: 'set', p: 'payload', pt: 'msg', to: value, tot: 'str' }];

const CHART_COLORS = ['#0d5fb3', '#b3261e', '#1f7a4d', '#e0a800', '#7b3fb3', '#00838f', '#c2185b', '#5d4037', '#455a64'];

// ------------------------------------------------------------------ student flow

const PAIR_RE = '/^[a-z0-9][a-z0-9-]{2,30}[a-z0-9]$/';

const CODE = {
  pair: `// Runs when you type a pairing name on the dashboard.
// It subscribes to YOUR phone only: ece270/pair/<name>/phone/#
const name = String(msg.payload ?? '').trim().toLowerCase();
if (!${PAIR_RE}.test(name)) {
    node.status({ fill: 'red', shape: 'ring', text: 'invalid pairing name' });
    return [null, { payload: 'Use 4–32 lowercase letters, numbers or dashes, the same as on your phone.' }, null];
}
// A different phone: clear the previous phone's recording from the Recording panel
// (output 3). Re-pairing with the same name, e.g. after a Deploy, keeps it.
const newName = name !== flow.get('pair');
flow.set('pair', name);
flow.set('pairedAt', Date.now());
flow.set('lastReading', 0);
flow.set('phoneState', null);
flow.set('lastCmd', null);
flow.set('online', true);
node.status({ fill: 'green', shape: 'dot', text: name });
// The laptop connects to the class broker only once paired (the free plan counts connected minutes).
return [
    [
        { action: 'connect' },
        { action: 'unsubscribe', topic: true },
        { action: 'subscribe', topic: { topic: 'ece270/pair/' + name + '/phone/#', qos: 0 } }
    ],
    { payload: 'Paired with "' + name + '". Press Start on your phone.' },
    newName ? { topic: 'recording', payload: { state: 'idle' } } : null
];`,

  router: `// Every reading from your phone comes out of this node, 5 times per second.
// msg.payload = { ax, ay, az, gx, gy, gz, t, seq }   (acceleration in m/s², gravity included)
if (msg.topic.endsWith('/status')) {          // hello / offline messages from the phone
    flow.set('phoneState', msg.payload && msg.payload.state);
    return null;
}
const r = msg.payload;
if (!r || typeof r.ax !== 'number') return null;
flow.set('lastReading', Date.now());
flow.set('count', (flow.get('count') || 0) + 1);
flow.set('phoneState', 'online');
msg.t = r.t;   // when the phone took this reading; used to time the round trip
return msg;`,

  connection: `// Output 1: status text. Output 2: disconnects from the broker after IDLE_MIN quiet minutes.
const IDLE_MIN = 15;
const pair = flow.get('pair');
const count = flow.get('count') || 0;
flow.set('count', 0);
if (!pair) return [{ payload: 'Not paired yet. Type a pairing name above.' }, null];
if (!flow.get('online')) {
    return [{ payload: 'Disconnected after ' + IDLE_MIN + ' minutes without your phone. Press Enter in the pairing box to reconnect.' }, null];
}
const now = Date.now();
const last = flow.get('lastReading') || 0;
const quietFor = now - Math.max(last, flow.get('pairedAt') || now);
if (quietFor > IDLE_MIN * 60000) {
    flow.set('online', false);
    return [{ payload: 'Disconnected after ' + IDLE_MIN + ' minutes without your phone.' }, { action: 'disconnect' }];
}
const age = (now - last) / 1000;
// Readings arriving = the connection works, whatever else we think we know.
if (last && age < 3) return [{ payload: 'Receiving readings (' + count + ' per second)' }, null];
// flow.broker is set only by the "broker connection" status node, from the MQTT node's own status.
const broker = flow.get('broker') || '';
if (broker !== 'connected' && now - (flow.get('pairedAt') || now) > 8000) {
    return [{ payload: 'Not connected to the class broker (' + (broker || 'no answer') + '). Check the password: double-click "my phone", edit the broker, Security tab.' }, null];
}
if (flow.get('phoneState') === 'offline') return [{ payload: 'Your phone went offline' }, null];
if (last) return [{ payload: 'No readings for ' + Math.round(age) + ' s' }, null];
return [{ payload: 'Waiting for a phone using "' + pair + '"' }, null];`,

  restore: `// Clicking Deploy restarts the MQTT connection, and this laptop only connects once paired.
// So if it was paired before the deploy, pair again automatically with the same name.
const pair = flow.get('pair');
if (!pair || !flow.get('online')) return null;
return { payload: pair };`,

  brokerStatus: `// Remembers whether the "my phone" MQTT node is connected, for the status text.
const text = String((msg.status && msg.status.text) || '');
const state = /disconnected/.test(text) ? 'disconnected' : /connecting/.test(text) ? 'connecting'
    : /connected/.test(text) ? 'connected' : text;
flow.set('broker', state);
return null;`,

  heartbeat: `// Lets your phone show "Laptop: Connected", and tells a phone that just (re)started
// the laptop's current decision (the filter node only sends changes).
const pair = flow.get('pair');
if (!pair || !flow.get('online')) return null;
const beat = { state: 'online', last: flow.get('lastCmd') || null, t: Date.now() };
return { topic: 'ece270/pair/' + pair + '/laptop', payload: JSON.stringify(beat) };`,

  send: `// Wire your "ALERT" / "OK" messages into this node. It addresses them to your phone.
const pair = flow.get('pair');
if (!pair || !flow.get('online')) {
    node.status({ fill: 'yellow', shape: 'ring', text: pair ? 'disconnected' : 'not paired yet' });
    return null;
}
const cmd = String(msg.payload).trim().toUpperCase();
if (cmd !== 'ALERT' && cmd !== 'OK') {
    node.warn('Send the text ALERT or OK to the phone, not: ' + msg.payload);
    return null;
}
node.status({ fill: cmd === 'ALERT' ? 'red' : 'green', shape: 'dot', text: cmd });
flow.set('lastCmd', cmd);
const toPhone = {
    topic: 'ece270/pair/' + pair + '/cmd',
    payload: JSON.stringify({ cmd: cmd, t: typeof msg.t === 'number' ? msg.t : null })
};
// No clock times here: Node.js may have older time-zone rules than the laptop's browser.
const n = (flow.get('sentCount') || 0) + 1;
flow.set('sentCount', n);
return [toPhone, { payload: cmd + '  (command #' + n + ')' }];`,

  gaugeRate: `// The dashboard gauge animates every change over 1 second. At 5 readings per second the needle
// never catches up and jumps unevenly, so the gauge gets ONE value per second: the strongest of that second.
// (The chart and the alarm still get every reading.)
const now = Date.now();
const peak = Math.max(context.get('peak') || 0, msg.payload);
if (now - (context.get('sentAt') || 0) < 1000) {
    context.set('peak', peak);
    return null;
}
context.set('sentAt', now);
context.set('peak', 0);
msg.payload = peak;
return msg;`,

  shake: `const { ax, ay, az } = msg.payload;              // m/s², gravity included
const g = Math.sqrt(ax*ax + ay*ay + az*az);      // about 9.8 when still
msg.payload = +Math.abs(g - 9.81).toFixed(2);    // 0 = still, bigger = shaking
return msg;`,

  recorder: `// Pre-built: collects a recording when you tap Record on your phone. You don't need to change it.
// While the phone records, each reading also carries msg.payload.rec, a batch of fast readings:
//   { id, i: batch number 0,1,2..., start, dur: planned seconds, end: true on the last batch,
//     s: [[ms, ax, ay, az, gx, gy, gz], ...] }      ms = milliseconds since the recording started
// The "every second" input (topic "tick") notices a phone that stopped sending.
// Output, to the "Recording" panel:
//   { state: 'recording', seconds, dur }            at most once per second while recording
//   { state: 'ready', pair, startedAt, dur, rows, count, complete, missingBatches }
//   each row: [time_s, ax, ay, az, gx, gy, gz, shake]
const MAX_MS = 120000;      // keep at most 120 s of readings, ignore anything later
const MAX_ROWS = 30000;     // and never more rows than this
const QUIET_MS = 3000;      // no batch for 3 s: the recording ended without its last batch
const now = Date.now();
const pair = flow.get('pair') || '';
const out = [];
let rec = context.get('rec') || null;
const num = (v) => (typeof v === 'number' && isFinite(v)) ? v : null;

function progress(r) {
    r.statusAt = now;
    const seconds = Math.floor(r.maxMs / 1000);
    node.status({ fill: 'blue', shape: 'dot', text: 'recording ' + seconds + ' s' });
    return { topic: 'recording', payload: { state: 'recording', seconds: seconds, dur: r.dur } };
}

function finish(r, gotEnd) {
    const last = r.endIndex >= 0 ? r.endIndex : r.maxIndex;
    let got = 0;
    for (const k of Object.keys(r.got)) if (Number(k) <= last) got++;
    const missingBatches = Math.max(0, last + 1 - got);
    const complete = gotEnd && missingBatches === 0;
    r.rows.sort((a, b) => a[0] - b[0]);
    context.set('done', (context.get('done') || []).concat(r.id).slice(-10));   // ignore late batches
    node.status({ fill: complete ? 'green' : 'yellow', shape: 'dot',
        text: r.rows.length + ' readings' + (complete ? '' : ', incomplete') });
    return { topic: 'recording', payload: {
        state: 'ready', pair: r.pair, startedAt: r.startedAt, dur: r.dur, rows: r.rows,
        count: r.rows.length, complete: complete, missingBatches: missingBatches } };
}

// A new pairing name: forget a recording in progress.
if (rec && rec.pair !== pair) {
    rec = null;
    node.status({});
    out.push({ topic: 'recording', payload: { state: 'idle' } });
}

const b = msg.topic !== 'tick' && msg.payload ? msg.payload.rec : null;
if (b && typeof b === 'object' && b.id !== undefined && b.id !== null && b.id !== ''
        && !(context.get('done') || []).includes(String(b.id))) {
    const recId = String(b.id);
    if (rec && rec.id !== recId) {            // a new recording started before the old one ended
        out.push(finish(rec, false));
        rec = null;
    }
    if (!rec) {
        rec = { id: recId, pair: pair, startedAt: num(b.start) || now, dur: num(b.dur) || 0,
                got: {}, maxIndex: -1, endIndex: -1, maxMs: 0, rows: [], lastAt: now, statusAt: 0 };
    }
    const i = Number.isInteger(b.i) && b.i >= 0 ? b.i : -1;
    if (i < 0 || !rec.got[i]) {               // skip a batch that arrived twice
        if (i >= 0) { rec.got[i] = true; rec.maxIndex = Math.max(rec.maxIndex, i); }
        rec.lastAt = now;
        for (const s of Array.isArray(b.s) ? b.s : []) {
            if (!Array.isArray(s)) continue;
            const ms = num(s[0]), ax = num(s[1]), ay = num(s[2]), az = num(s[3]);
            if (ms === null || ms < 0 || ax === null || ay === null || az === null) continue;
            if (ms > MAX_MS || rec.rows.length >= MAX_ROWS) continue;
            rec.maxMs = Math.max(rec.maxMs, ms);
            const g = Math.sqrt(ax*ax + ay*ay + az*az);
            rec.rows.push([+(ms / 1000).toFixed(3), ax, ay, az, num(s[4]), num(s[5]), num(s[6]),
                           +Math.abs(g - 9.81).toFixed(2)]);
        }
    }
    if (b.end === true) {
        rec.endIndex = i >= 0 ? i : rec.maxIndex;
        out.push(finish(rec, true));
        rec = null;
    } else if (now - rec.statusAt >= 1000) {
        out.push(progress(rec));
    }
}

if (rec && now - rec.lastAt > QUIET_MS) {
    out.push(finish(rec, false));
    rec = null;
} else if (rec && msg.topic === 'tick' && now - rec.statusAt >= 1000) {
    out.push(progress(rec));
}
context.set('rec', rec);
return out.length ? [out] : null;`,
};

// ------------------------------------------------------------------ recording panel (ui-template)

// Plotly's official "gl3d" partial bundle: scatter, scatter3d, surface, mesh3d and a few more 3D types.
// 1.76 MB (about 560 kB over the network), against 4.8 MB for the full bundle. Pinned, with its hash,
// so the browser refuses the file if the CDN ever serves different bytes.
const PLOTLY_URL = 'https://cdn.plot.ly/plotly-gl3d-4.2.0.min.js';
const PLOTLY_SRI = 'sha384-FIPest0F2WAPBZywmHOfM9f+AiwK/u8Ofa/lKAhctEZkupuN7c4zxUyFsbc2QHPq';

// A Vue component. The dashboard parses <template> as HTML, so the template avoids <, > and & in
// expressions (they live in computed values), and the script avoids ?. and ?? (its parser is older).
const RECORDING_PANEL = `<template>
  <div class="shake-recording">
    <div class="rec-status" :class="statusClass">{{ statusText }}</div>
    <div class="rec-detail" v-if="detailText">{{ detailText }}</div>
    <div class="rec-body" v-show="state === 'ready'">
      <div class="rec-controls">
        <label class="rec-control">Window start
          <input type="range" class="rec-slider" min="0" :max="sliderMax" step="0.1" :value="start"
                 :disabled="width === 'all'" @input="onSlide">
        </label>
        <span class="rec-window">{{ windowText }}</span>
        <label class="rec-control">Window width
          <select class="rec-width" v-model="width" @change="onWidth">
            <option value="1">1 s</option>
            <option value="2">2 s</option>
            <option value="5">5 s</option>
            <option value="all">All</option>
          </select>
        </label>
        <button type="button" class="rec-download" @click="download">Download CSV</button>
      </div>
      <div class="rec-plot-msg" v-if="plotMsg">{{ plotMsg }}</div>
      <div class="rec-timeseries"></div>
      <div class="rec-caption">Shaded: the window you chose. Move the slider to slide it along the recording.</div>
      <div class="rec-3d-row">
        <div class="rec-3d"></div>
        <div class="rec-caption">Each dot is one reading of (ax, ay, az). Held still, the phone feels only gravity, so its
          dots sit on the sphere of radius 9.81 m/s². Turning the phone moves them around the sphere; shaking throws them
          off it. The chosen window is drawn as a line, light blue at its start and dark blue at its end.
          Drag the plot to rotate it.</div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
    data() {
        return {
            state: 'idle', seconds: 0, dur: 0, count: 0, span: 0, complete: true, missing: 0,
            pair: '', startedAt: 0, start: 0, width: '2', plotly: 'loading'
        };
    },
    computed: {
        statusText() {
            if (this.state === 'recording') return 'Recording from your phone… ' + this.seconds + ' s';
            if (this.state !== 'ready') return 'No recording yet. On your phone, tap Record.';
            let t = 'Recording: ' + this.count + ' readings over ' + this.span.toFixed(1) + ' s';
            if (this.missing > 0) t += ' (incomplete: ' + this.missing + ' batches missing)';
            else if (!this.complete) t += ' (incomplete: the phone stopped sending before the end)';
            return t;
        },
        statusClass() {
            if (this.state === 'ready' && !this.complete) return 'rec-incomplete';
            return 'rec-' + this.state;
        },
        detailText() {
            if (this.state !== 'ready' || !this.startedAt) return '';
            const d = new Date(this.startedAt);
            const p2 = function (n) { return String(n).padStart(2, '0'); };
            return 'From the phone "' + this.pair + '", started at ' + p2(d.getHours()) + ':' + p2(d.getMinutes()) +
                ':' + p2(d.getSeconds()) + '.';
        },
        sliderMax() {
            if (this.width === 'all') return 0;
            return Math.max(0, Math.round((this.span - Number(this.width)) * 10) / 10);
        },
        windowText() {
            const w = this.windowRange();
            return 'Showing ' + w[0].toFixed(1) + ' to ' + w[1].toFixed(1) + ' s';
        },
        plotMsg() {
            if (this.plotly === 'loading') return 'Loading the plotting library…';
            if (this.plotly === 'failed') {
                return 'Could not load the plotting library from cdn.plot.ly, so the plots cannot be shown. ' +
                    'Check the internet connection and reload this page. Download CSV still works.';
            }
            return '';
        }
    },
    watch: {
        msg: function () { this.load(this.msg); }
    },
    methods: {
        el(cls) {
            const root = this.$el && this.$el.querySelector ? this.$el : document;
            return root.querySelector(cls);
        },
        load(m) {
            const p = m ? m.payload : null;
            if (p && p.state === 'ready' && Array.isArray(p.rows)) {
                const n = p.rows.length;
                const d = { rows: new Array(n), t: new Array(n), ax: new Array(n), ay: new Array(n),
                    az: new Array(n), shake: new Array(n), maxAbs: 0 };
                for (let k = 0; k < n; k++) {
                    const r = p.rows[k];
                    const row = [r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7]];
                    d.rows[k] = row;
                    d.t[k] = row[0]; d.ax[k] = row[1]; d.ay[k] = row[2]; d.az[k] = row[3]; d.shake[k] = row[7];
                    d.maxAbs = Math.max(d.maxAbs, Math.abs(row[1]), Math.abs(row[2]), Math.abs(row[3]));
                }
                this.clearPlots();
                this.recData = d;
                this.recKey = (this.recKey || 0) + 1;
                this.count = n;
                this.span = n ? Number(d.t[n - 1]) || 0 : 0;
                this.complete = p.complete !== false;
                this.missing = Number(p.missingBatches) || 0;
                this.pair = String(p.pair || '');
                this.startedAt = Number(p.startedAt) || 0;
                this.dur = Number(p.dur) || 0;
                this.start = 0;
                this.state = 'ready';
                const self = this;
                this.$nextTick(function () { self.draw(); });
                return;
            }
            this.clearPlots();
            this.recData = null;
            if (p && p.state === 'recording') {
                this.seconds = Math.max(0, Math.floor(Number(p.seconds) || 0));
                this.dur = Number(p.dur) || 0;
                this.state = 'recording';
            } else {
                this.state = 'idle';
            }
        },
        windowRange() {
            if (this.width === 'all') return [0, this.span];
            const w = Number(this.width);
            const s = Math.min(Math.max(0, Number(this.start) || 0), this.sliderMax);
            return [s, s + w];
        },
        windowPoints() {
            const d = this.recData;
            const w = this.windowRange();
            const pts = { x: [], y: [], z: [], t: [], text: [] };
            for (let k = 0; k < d.t.length; k++) {
                const t = d.t[k];
                if (t >= w[0] && t <= w[1]) {
                    pts.x.push(d.ax[k]); pts.y.push(d.ay[k]); pts.z.push(d.az[k]); pts.t.push(t);
                    pts.text.push(t.toFixed(2));
                }
            }
            return pts;
        },
        windowShape() {
            const w = this.windowRange();
            return { type: 'rect', xref: 'x', yref: 'paper', x0: w[0], x1: w[1], y0: 0, y1: 1,
                fillcolor: '#0d5fb3', opacity: 0.12, line: { width: 0 }, layer: 'below' };
        },
        sphere() {
            const r = 9.81, x = [], y = [], z = [];
            for (let i = 0; i <= 24; i++) {
                const th = Math.PI * i / 24, rx = [], ry = [], rz = [];
                for (let j = 0; j <= 48; j++) {
                    const ph = 2 * Math.PI * j / 48;
                    rx.push(r * Math.sin(th) * Math.cos(ph));
                    ry.push(r * Math.sin(th) * Math.sin(ph));
                    rz.push(r * Math.cos(th));
                }
                x.push(rx); y.push(ry); z.push(rz);
            }
            return { x: x, y: y, z: z };
        },
        draw() {
            const P = window.Plotly, d = this.recData;
            const ts = this.el('.rec-timeseries'), sc = this.el('.rec-3d');
            if (!P || !d || this.state !== 'ready' || this.gone || !ts || !sc) return;
            const family = this.$el && this.$el.nodeType === 1 ? getComputedStyle(this.$el).fontFamily : '';
            const font = { family: family || 'sans-serif', size: 12, color: '#1d2433' };
            const series = [
                { name: 'ax', y: d.ax, color: '#0d5fb3', dash: 'solid', width: 1.5 },
                { name: 'ay', y: d.ay, color: '#b3261e', dash: 'solid', width: 1.5 },
                { name: 'az', y: d.az, color: '#1f7a4d', dash: 'dash', width: 1.5 },
                { name: 'shake level', y: d.shake, color: '#e0a800', dash: 'solid', width: 2.5 }
            ];
            const lines = series.map(function (s) {
                return { type: 'scatter', mode: 'lines', name: s.name, x: d.t, y: s.y,
                    line: { color: s.color, width: s.width, dash: s.dash }, hovertemplate: '%{y:.2f} m/s²' };
            });
            const config = { displaylogo: false, responsive: true };
            P.newPlot(ts, lines, {
                height: 260, margin: { l: 50, r: 10, t: 36, b: 40 }, font: font,
                paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
                xaxis: { title: { text: 'time (s)' }, range: [0, Math.max(this.span, 0.1)], zeroline: false, gridcolor: '#e5e5e5' },
                yaxis: { title: { text: 'm/s²' }, gridcolor: '#e5e5e5', zerolinecolor: '#c9ced8' },
                legend: { orientation: 'h', x: 0, y: 1.02, yanchor: 'bottom' },
                hovermode: 'x unified', shapes: [this.windowShape()], uirevision: this.recKey
            }, config);

            const R = Math.max(15, Math.ceil(d.maxAbs * 1.05));
            const axis = function (title) {
                return { title: { text: title }, range: [-R, R], autorange: false, gridcolor: '#d9dde5', zerolinecolor: '#9aa3b2' };
            };
            const w = this.windowRange();
            const pts = this.windowPoints();
            const scale = [[0, '#9ec5f0'], [1, '#08306b']];
            const ball = this.sphere();
            P.newPlot(sc, [
                { type: 'scatter3d', mode: 'markers', name: 'All readings', x: d.ax, y: d.ay, z: d.az,
                    marker: { size: 2, color: '#8a93a3', opacity: 0.35 }, hoverinfo: 'skip' },
                { type: 'scatter3d', mode: 'lines+markers', name: 'Chosen window', x: pts.x, y: pts.y, z: pts.z,
                    text: pts.text,
                    marker: { size: 3, color: pts.t, colorscale: scale, cmin: w[0], cmax: w[1], showscale: true,
                        colorbar: { title: { text: 'time (s)' }, thickness: 12, len: 0.6 } },
                    line: { width: 4, color: pts.t, colorscale: scale, cmin: w[0], cmax: w[1] },
                    hovertemplate: 'time %{text} s<br>ax %{x:.2f}<br>ay %{y:.2f}<br>az %{z:.2f}<extra></extra>' },
                { type: 'surface', name: 'Gravity sphere, 9.81 m/s²', x: ball.x, y: ball.y, z: ball.z,
                    opacity: 0.1, showscale: false, colorscale: [[0, '#5f6b7d'], [1, '#5f6b7d']],
                    hoverinfo: 'skip', showlegend: true }
            ], {
                height: 420, margin: { l: 0, r: 0, t: 30, b: 10 }, font: font, paper_bgcolor: 'rgba(0,0,0,0)',
                showlegend: true, legend: { orientation: 'h', x: 0, y: 1 },
                scene: { aspectmode: 'cube', xaxis: axis('ax (m/s²)'), yaxis: axis('ay (m/s²)'), zaxis: axis('az (m/s²)'),
                    camera: { eye: { x: 1.6, y: 1.6, z: 0.8 } } },
                uirevision: this.recKey
            }, config);
            this.drawn = true;
        },
        redrawWindow() {
            const P = window.Plotly;
            if (!P || !this.drawn) return;
            const w = this.windowRange();
            const pts = this.windowPoints();
            P.relayout(this.el('.rec-timeseries'), { 'shapes[0].x0': w[0], 'shapes[0].x1': w[1] });
            P.restyle(this.el('.rec-3d'), {
                x: [pts.x], y: [pts.y], z: [pts.z], text: [pts.text],
                'marker.color': [pts.t], 'marker.cmin': w[0], 'marker.cmax': w[1],
                'line.color': [pts.t], 'line.cmin': w[0], 'line.cmax': w[1]
            }, [1]);
        },
        clearPlots() {
            const P = window.Plotly;
            if (P && this.drawn) {
                const ts = this.el('.rec-timeseries'), sc = this.el('.rec-3d');
                if (ts) P.purge(ts);
                if (sc) P.purge(sc);
            }
            this.drawn = false;
        },
        onSlide(e) {
            this.start = Math.min(Math.max(0, Number(e.target.value) || 0), this.sliderMax);
            this.redrawWindow();
        },
        onWidth(e) {
            this.width = e.target.value;
            this.start = Math.min(this.start, this.sliderMax);
            this.redrawWindow();
        },
        download() {
            const d = this.recData;
            if (!d) return;
            const lines = ['time_s,ax,ay,az,gx,gy,gz,shake'];
            for (let k = 0; k < d.rows.length; k++) {
                lines.push(d.rows[k].map(function (v) { return v === null || v === undefined ? '' : String(v); }).join(','));
            }
            const p2 = function (n) { return String(n).padStart(2, '0'); };
            const t = new Date(this.startedAt || Date.now());
            const stamp = t.getFullYear() + p2(t.getMonth() + 1) + p2(t.getDate()) + '-' +
                p2(t.getHours()) + p2(t.getMinutes()) + p2(t.getSeconds());
            const name = (this.pair || 'phone').toLowerCase().replace(/[^a-z0-9-]/g, '-');
            const url = URL.createObjectURL(new Blob([lines.join('\\n') + '\\n'], { type: 'text/csv' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = 'shake-recording-' + name + '-' + stamp + '.csv';
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
        },
        loadPlotly() {
            // One <script> tag for the whole dashboard, however many panels are open.
            const w = window;
            if (w.Plotly) return Promise.resolve(w.Plotly);
            if (!w.ece270PlotlyLoading) {
                w.ece270PlotlyLoading = new Promise(function (resolve, reject) {
                    const s = document.createElement('script');
                    s.src = '${PLOTLY_URL}';
                    s.integrity = '${PLOTLY_SRI}';
                    s.crossOrigin = 'anonymous';
                    s.async = true;
                    s.onload = function () { if (w.Plotly) resolve(w.Plotly); else reject(new Error('no Plotly')); };
                    s.onerror = function () { s.remove(); reject(new Error('could not load Plotly')); };
                    document.head.appendChild(s);
                }).catch(function (err) { w.ece270PlotlyLoading = null; throw err; });
            }
            return w.ece270PlotlyLoading;
        }
    },
    mounted() {
        this.gone = false;
        this.drawn = false;
        this.load(this.msg);
        const self = this;
        this.loadPlotly().then(function () {
            if (self.gone) return;
            self.plotly = 'ready';
            self.$nextTick(function () { self.draw(); });
        }).catch(function () {
            if (!self.gone) self.plotly = 'failed';
        });
    },
    unmounted() {
        this.clearPlots();
        this.gone = true;
    }
};
</script>

<style>
.shake-recording { display: flex; flex-direction: column; gap: 8px; width: 100%; color: #1d2433; }
.shake-recording .rec-status { font-size: 16px; }
.shake-recording .rec-status.rec-recording { color: #0d5fb3; }
.shake-recording .rec-status.rec-incomplete { color: #8a4b00; }
.shake-recording .rec-detail, .shake-recording .rec-caption, .shake-recording .rec-window { font-size: 13px; color: #5b6475; }
.shake-recording .rec-body { display: flex; flex-direction: column; gap: 6px; }
.shake-recording .rec-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 20px; }
.shake-recording .rec-control { display: flex; align-items: center; gap: 8px; font-size: 14px; }
.shake-recording .rec-slider { width: 260px; accent-color: #0d5fb3; }
.shake-recording .rec-width { appearance: auto; border: 1px solid #c9ced8; border-radius: 4px; padding: 2px 6px; background: #ffffff; }
.shake-recording .rec-download { background: #0d5fb3; color: #ffffff; border-radius: 4px; padding: 6px 14px; font-size: 14px; }
.shake-recording .rec-download:hover { background: #0a4c8f; }
.shake-recording .rec-plot-msg { font-size: 14px; color: #5b6475; }
.shake-recording .rec-timeseries { width: 100%; min-height: 260px; }
.shake-recording .rec-3d-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 24px; }
.shake-recording .rec-3d { flex: 0 1 640px; min-width: 320px; min-height: 420px; }
.shake-recording .rec-3d-row .rec-caption { flex: 1 1 240px; max-width: 520px; }
</style>`;

const STARTER_INFO = `# Shake Alarm

**Already built for you (don't change):** pairing with your phone, the connection status,
the Recording panel, and the node that sends commands back to your phone.

**You build** the part in the middle:

1. A **function** "shake level" that turns ax, ay, az into one number.
2. A **gauge** and a **chart** that show it.
3. A **switch** that checks if it's above the threshold (flow.threshold).
4. Two **change** nodes: set msg.payload to ALERT, or to OK.
5. A **filter** node (block unless value changes).
6. Wire the filter into "send to my phone".
7. A **slider** wired into "store threshold".
8. *Optional:* a **range** node set to "Scale and limit to the target range", 0–${cfg.shakeScaleMax} to 0–${cfg.shakeScaleMax},
   in front of the gauge and chart. A hard knock can reach 90+ m/s², which would overshoot the gauge.
9. *Optional:* the gauge animates every change over 1 s, so at 5 readings per second its needle lags.
   Put a **delay** node (Rate limit, 1 message per second, drop intermediate messages) in front of the gauge only.

Then open http://127.0.0.1:1880/dashboard, type your pairing name, and shake your phone.`;

function studentFlow(withSolution) {
  const z = id('student-tab');
  const B = 'student-broker';
  const routerWires = withSolution ? [[id('s-shake'), id('s-rec')]] : [[id('s-rec')]];
  const nodes = [
    { id: z, type: 'tab', label: 'Shake Alarm', disabled: false, info: STARTER_INFO },
    comment('s-c-readme', z, 'READ ME: Shake Alarm (double-click)', STARTER_INFO, 170, 40),
    comment('s-c-pair', z, 'Pairing and connection (pre-built)', '', 180, 100),
    uiTextInput('s-pair-in', z, 's-g-pair', 1, 'Pairing name (same as on your phone)', 'pair', 170, 140, [[id('s-pair')]]),
    fn('s-pair', z, 'pair with my phone', CODE.pair, 3, 420, 140, [[id('s-mqtt-in')], [id('s-pair-info')], [id('s-rec-panel')]]),
    inject('s-restore-tick', z, 'after every deploy', { once: true, onceDelay: '1' }, 150, 60, [[id('s-restore')]]),
    fn('s-restore', z, 're-pair after deploy', CODE.restore, 1, 400, 60, [[id('s-pair')]]),
    mqttIn('s-mqtt-in', z, 'my phone', B, '', 640, 120, [[id('s-router')]]),
    uiText('s-pair-info', z, 's-g-pair', 2, 'Pairing', 650, 180),
    inject('s-tick', z, 'every second', { repeat: '1', once: true }, 160, 240, [[id('s-conn')]]),
    fn('s-conn', z, 'phone connection', CODE.connection, 2, 380, 240, [[id('s-phone-text')], [id('s-mqtt-in')]]),
    { id: id('s-broker-status'), type: 'status', z, name: 'broker connection', scope: [id('s-mqtt-in')], x: 150, y: 200, wires: [[id('s-broker-fn')]] },
    fn('s-broker-fn', z, 'remember broker state', CODE.brokerStatus, 0, 380, 200, []),
    uiText('s-phone-text', z, 's-g-pair', 3, 'Phone', 600, 240),
    inject('s-beat-tick', z, 'every 5 s', { repeat: '5', once: true, onceDelay: '1' }, 150, 300, [[id('s-beat')]]),
    fn('s-beat', z, "tell my phone I'm here", CODE.heartbeat, 1, 380, 300, [[id('s-mqtt-out')]]),

    comment('s-c-build', z, 'YOUR NODES GO HERE: wire from "phone readings" ... into "send to my phone"', '', 330, 380),
    fn('s-router', z, 'phone readings (wire from here)', CODE.router, 1, 900, 120, routerWires),

    fn('s-send', z, 'send to my phone (wire into here)', CODE.send, 2, 1160, 560, [[id('s-mqtt-out')], [id('s-cmd-text')]]),
    mqttOut('s-mqtt-out', z, 'to my phone', B, 1430, 540),
    uiText('s-cmd-text', z, 's-g-control', 2, 'Last command sent to phone', 1440, 600),

    inject('s-thr-default', z, 'start-up threshold = 6', { once: true, payload: String(cfg.defaultThreshold), payloadType: 'num', topic: 'threshold' }, 180, 660,
      withSolution ? [[id('s-thr-store'), id('s-slider')]] : [[id('s-thr-store')]]),
    change('s-thr-store', z, 'store threshold', setFlow('threshold'), 450, 660, [[]]),

    // Recording (pre-built): Record on the phone -> fast readings in batches -> one recording -> plots + CSV
    comment('s-c-record', z, 'Recording from the phone (pre-built)', '', 1190, 60),
    inject('s-rec-tick', z, 'every second', { repeat: '1', topic: 'tick' }, 950, 200, [[id('s-rec')]]),
    fn('s-rec', z, 'recording collector', CODE.recorder, 1, 1190, 160, [[id('s-rec-panel')]]),
    {
      id: id('s-rec-panel'), type: 'ui-template', z, group: id('s-g-record'), page: '', ui: '', name: 'Recording panel',
      order: 1, width: '0', height: '0', head: '', format: RECORDING_PANEL, storeOutMessages: true, passthru: false,
      resendOnRefresh: true, templateScope: 'local', className: '', x: 1440, y: 160, wires: [[]],
    },

    // Dashboard layout
    uiPage('s-page', 'Shake Alarm', '/shake', 1),
    uiGroup('s-g-pair', 'Pair with your phone', 's-page', 4, 1),
    uiGroup('s-g-motion', "My phone's motion", 's-page', 8, 2),
    uiGroup('s-g-control', 'Alarm control', 's-page', 4, 3),
    uiGroup('s-g-record', 'Recording', 's-page', 12, 4),
    uiBase(), uiTheme(),
    mqttBroker(B, 'Class broker (student)', cfg.studentUser, broker.studentPass, false),
  ];
  if (broker.tls) nodes.push(tlsConfig());

  if (withSolution) {
    nodes.push(
      fn('s-shake', z, 'shake level', CODE.shake, 1, 340, 460, [[id('s-limit'), id('s-switch')]]),
      // A hard flick or knock can reach 90+ m/s². The alarm uses the true value; the gauge and chart
      // get it limited to their 0-30 scale, or the gauge shows e.g. 93 with the needle in the wrong place.
      {
        id: id('s-limit'), type: 'range', z, name: 'limit to the display scale', minin: '0', maxin: String(cfg.shakeScaleMax),
        minout: '0', maxout: String(cfg.shakeScaleMax), action: 'clamp', round: false, property: 'payload',
        x: 560, y: 380, wires: [[id('s-gauge-rate'), id('s-chart')]],
      },
      fn('s-gauge-rate', z, 'one value per second for the gauge', CODE.gaugeRate, 1, 800, 380, [[id('s-gauge')]]),
      {
        id: id('s-gauge'), type: 'ui-gauge', z, name: '', group: id('s-g-motion'), order: 1, value: 'payload', valueType: 'msg',
        width: 3, height: 3, gtype: 'gauge-half', gstyle: 'needle', title: 'Shake level', alwaysShowTitle: false,
        floatingTitlePosition: 'top-left', units: 'm/s²', icon: '', prefix: '', suffix: '',
        // Real shakes measured on iPhone and Android reach 15-27 m/s², so the scale goes to 30.
        // Green below the default threshold, amber above it, red for a strong shake (half the scale).
        segments: [{ from: '0', color: '#1f7a4d' }, { from: String(cfg.defaultThreshold), color: '#e0a800' }, { from: String(cfg.shakeScaleMax / 2), color: '#b3261e' }],
        min: 0, max: cfg.shakeScaleMax, sizeThickness: 16, sizeGap: 4, sizeKeyThickness: 8, styleRounded: true, styleGlow: false,
        className: '', x: 560, y: 420, wires: [[]],
      },
      {
        id: id('s-chart'), type: 'ui-chart', z, group: id('s-g-motion'), name: '', label: 'Shake level, last minute', order: 2,
        chartType: 'line', category: 'shake level', categoryType: 'str', xAxisLabel: '', xAxisProperty: '',
        xAxisPropertyType: 'timestamp', xAxisType: 'time', xAxisFormat: '', xAxisFormatType: 'auto', xmin: '', xmax: '',
        yAxisLabel: 'm/s²', yAxisProperty: 'payload', yAxisPropertyType: 'msg', ymin: '0', ymax: String(cfg.shakeScaleMax), bins: 10,
        action: 'append', stackSeries: false, pointShape: 'circle', pointRadius: 2, showLegend: false,
        removeOlder: 1, removeOlderUnit: '60', removeOlderPoints: '', colors: CHART_COLORS,
        textColor: ['#666666'], textColorDefault: true, gridColor: ['#e5e5e5'], gridColorDefault: true,
        width: 5, height: 4, className: '', interpolation: 'linear', x: 560, y: 460, wires: [[]],
      },
      {
        id: id('s-switch'), type: 'switch', z, name: 'above threshold?', property: 'payload', propertyType: 'msg',
        rules: [{ t: 'gt', v: 'threshold', vt: 'flow' }, { t: 'else' }], checkall: 'false', repair: false, outputs: 2,
        x: 570, y: 540, wires: [[id('s-alert')], [id('s-ok')]],
      },
      change('s-alert', z, 'ALERT', setPayload('ALERT'), 760, 520, [[id('s-filter')]]),
      change('s-ok', z, 'OK', setPayload('OK'), 750, 560, [[id('s-filter')]]),
      {
        id: id('s-filter'), type: 'rbe', z, name: 'only send changes', func: 'rbe', gap: '', start: '', inout: 'out',
        septopics: true, property: 'payload', topi: 'topic', x: 940, y: 540, wires: [[id('s-send')]],
      },
      uiSlider('s-slider', z, 's-g-control', 1, 'Alarm threshold (m/s²)', 'threshold', 1, 20, 0.5, 450, 720, [[id('s-thr-store')]]),
    );
  }
  return nodes;
}

// ------------------------------------------------------------------ instructor console

const CONSOLE_CODE = {
  track: `// One message per shared phone, 5 per second: { s: shake level, t, rtt, by }
const name = msg.topic.split('/')[3];
const d = msg.payload || {};
const phones = flow.get('phones') || {};
const p = phones[name] || {};
const now = Date.now();
p.s = Number(d.s) || 0;
p.rtt = typeof d.rtt === 'number' ? d.rtt : p.rtt;
p.by = d.by || '?';
p.last = now;
p.max1s = Math.max(p.max1s || 0, p.s);
const threshold = flow.get('classThreshold') ?? ${cfg.defaultThreshold};
if (p.s > threshold) p.lastShake = now;
phones[name] = p;
flow.set('phones', phones);

// When a phone chooses "Class console" as its decision maker, decide here (Level 3 / 6).
// "send class decisions" publishes all of them together, at most 4 times per second.
if (p.by !== 'class') { p.cmd = null; return null; }
const cmd = p.s > threshold ? 'ALERT' : 'OK';
if (cmd !== p.cmd) {
    p.cmd = cmd;
    p.cmdT = typeof d.t === 'number' ? d.t : null;
    flow.set('decisionsChanged', true);
}
return null;`,

  decisions: `// One combined message for every phone that lets the console decide. EMQX's free plan
// allows each client 10 publishes per second, so 30 separate messages at once would be too many.
if (!flow.get('decisionsChanged')) return null;
flow.set('decisionsChanged', false);
const now = Date.now();
const d = {};
for (const [name, p] of Object.entries(flow.get('phones') || {})) {
    if (p.by === 'class' && p.cmd && now - p.last < 5000) d[name] = { cmd: p.cmd, t: p.cmdT };
}
return { topic: 'ece270/class/cmd/all', payload: JSON.stringify({ t: now, d: d }) };`,

  dashboard: `const phones = flow.get('phones') || {};
const now = Date.now();
const rows = [];
const points = [];
const rtts = [];
let shaking = 0;
for (const [name, p] of Object.entries(phones)) {
    const age = (now - p.last) / 1000;
    if (age > 120) { delete phones[name]; continue; }
    const online = age < 5;
    const level = p.max1s || p.s || 0;
    if (online) {
        points.push({ topic: name, payload: Math.min(level, ${cfg.shakeScaleMax}) });   // keep the chart on its 0-${cfg.shakeScaleMax} scale
        if (typeof p.rtt === 'number') rtts.push(p.rtt);
        if (now - (p.lastShake || 0) < 1000) shaking++;
    }
    rows.push({
        'Pairing name': name,
        'Shake (m/s²)': online ? level.toFixed(1) : '-',
        'Round trip (ms)': typeof p.rtt === 'number' ? p.rtt : '-',
        'Decided by': p.by,
        'Last seen': online ? 'now' : Math.round(age) + ' s ago'
    });
    p.max1s = 0;
}
flow.set('phones', phones);
rows.sort((a, b) => a['Pairing name'].localeCompare(b['Pairing name']));
rtts.sort((a, b) => a - b);
const pct = (q) => rtts.length ? rtts[Math.min(rtts.length - 1, Math.floor(rtts.length * q))] : '-';
const summary = points.length + ' phone' + (points.length === 1 ? '' : 's') + ' sharing · ' + shaking +
    ' shaking now · round trip median ' + pct(0.5) + ' ms, 90th percentile ' + pct(0.9) + ' ms';
return [{ payload: rows }, points, { payload: summary }];`,

  quake: `// Class earthquake detector: many phones shaking at the same moment.
if (!flow.get('quakeOn')) return null;
const phones = Object.values(flow.get('phones') || {});
const now = Date.now();
const active = phones.filter(p => now - p.last < 5000);
// A phone counts as shaking if it was above the threshold in the last second.
const shaking = active.filter(p => now - (p.lastShake || 0) < 1000).length;
const need = Math.max(flow.get('quakeMin') ?? 2, Math.ceil(active.length * (flow.get('quakePct') ?? 50) / 100));
// Students shake their own phones all the time, so random overlaps must not count:
// enough phones must keep shaking together for a full second.
if (!active.length || shaking < need) { flow.set('quakeSince', 0); return null; }
if (!flow.get('quakeSince')) flow.set('quakeSince', now);
if (now - flow.get('quakeSince') < 1000) return null;
if (now - (flow.get('lastQuake') || 0) < 15000) return null;   // at most one alert per 15 s
flow.set('lastQuake', now);
flow.set('quakeCount', (flow.get('quakeCount') || 0) + 1);
const text = 'Earthquake! ' + shaking + ' of ' + active.length + ' phones shook at the same time.';
return [
    { topic: 'ece270/class/broadcast', payload: JSON.stringify({ level: 'alert', text: text, t: now }) },
    { payload: 'Earthquake #' + flow.get('quakeCount') + ': ' + shaking + ' of ' + active.length + ' phones' }
];`,

  broadcast: `// Typed message -> every phone that shares with the class. The "Clear" button sends topic "clear".
const now = Date.now();
if (msg.topic === 'clear') {
    return { topic: 'ece270/class/broadcast', payload: JSON.stringify({ level: 'clear', t: now }) };
}
const text = String(msg.payload ?? '').trim().slice(0, 200);
if (!text) return null;
return { topic: 'ece270/class/broadcast', payload: JSON.stringify({ level: 'info', text: text, t: now }) };`,

  defaults: `flow.set('classThreshold', ${cfg.defaultThreshold});
flow.set('quakeOn', true);
flow.set('quakePct', 50);
flow.set('quakeMin', 2);
return [{ payload: ${cfg.defaultThreshold} }, { payload: true }, { payload: 50 }];`,

  forget: `flow.set('phones', {});
return { payload: [] };`,
};

const CONSOLE_INFO = `# Class Console

Shows only phones whose owner turned on **Share my shake level with the class console**.
Raw sensor data never comes here: just pairing name, shake level, round-trip time and who decides.

- **Earthquake detector:** if at least half the sharing phones (adjustable) keep shaking together for 1 s, every sharing phone gets an alert message.
- **Class console as decision maker:** phones that pick "Class console" get ALERT/OK from here.
- **Message to phones:** shows a text banner on every sharing phone.

Dashboard: http://127.0.0.1:1880/dashboard/console`;

function consoleFlow() {
  const z = id('console-tab');
  const B = 'instructor-broker';
  const nodes = [
    { id: z, type: 'tab', label: 'Class Console', disabled: false, info: CONSOLE_INFO },
    comment('c-readme', z, 'READ ME: Class Console (double-click)', CONSOLE_INFO, 170, 40),
    mqttIn('c-in', z, 'shared phones', B, 'ece270/class/phones/+', 150, 120, [[id('c-track')]]),
    fn('c-track', z, 'track phones + class decisions', CONSOLE_CODE.track, 0, 400, 120, []),
    mqttOut('c-out', z, 'to phones', B, 1050, 260),

    inject('c-tick', z, 'every second', { repeat: '1', once: true }, 150, 200, [[id('c-dash')]]),
    fn('c-dash', z, 'table, chart, summary', CONSOLE_CODE.dashboard, 3, 400, 200, [[id('c-table')], [id('c-chart')], [id('c-summary')]]),
    {
      id: id('c-table'), type: 'ui-table', z, group: id('c-g-table'), name: '', label: '', order: 1, width: 0, height: 0,
      maxrows: 0, passthru: false, autocols: true, showSearch: false, deselect: true, selectionType: 'none', columns: [],
      mobileBreakpoint: 'sm', mobileBreakpointType: 'defaults', action: 'replace', className: '', x: 650, y: 160, wires: [[]],
    },
    {
      id: id('c-chart'), type: 'ui-chart', z, group: id('c-g-fleet'), name: '', label: 'Shake level of every sharing phone', order: 1,
      chartType: 'line', category: 'topic', categoryType: 'msg', xAxisLabel: '', xAxisProperty: '',
      xAxisPropertyType: 'timestamp', xAxisType: 'time', xAxisFormat: '', xAxisFormatType: 'auto', xmin: '', xmax: '',
      yAxisLabel: 'm/s²', yAxisProperty: 'payload', yAxisPropertyType: 'msg', ymin: '0', ymax: String(cfg.shakeScaleMax), bins: 10,
      action: 'append', stackSeries: false, pointShape: 'circle', pointRadius: 2, showLegend: true,
      removeOlder: 1, removeOlderUnit: '60', removeOlderPoints: '', colors: CHART_COLORS,
      textColor: ['#666666'], textColorDefault: true, gridColor: ['#e5e5e5'], gridColorDefault: true,
      width: 12, height: 5, className: '', interpolation: 'linear', x: 660, y: 200, wires: [[]],
    },
    uiText('c-summary', z, 'c-g-class', 1, 'Now', 640, 240),

    inject('c-quake-tick', z, 'every 250 ms', { repeat: '0.25', once: true }, 160, 300, [[id('c-quake'), id('c-decisions')]]),
    fn('c-decisions', z, 'send class decisions', CONSOLE_CODE.decisions, 1, 400, 360, [[id('c-out')]]),
    fn('c-quake', z, 'earthquake detector', CONSOLE_CODE.quake, 2, 400, 300, [[id('c-out')], [id('c-quake-text'), id('c-notify')]]),
    uiText('c-quake-text', z, 'c-g-class', 2, 'Last earthquake', 660, 320),
    {
      id: id('c-notify'), type: 'ui-notification', z, ui: BASE, position: 'top right', colorDefault: true, color: null,
      displayTime: '5', showCountdown: true, outputs: 1, allowDismiss: true, dismissText: 'Close', allowConfirm: false,
      confirmText: 'Confirm', raw: false, className: '', name: 'earthquake popup', x: 670, y: 360, wires: [[]],
    },

    inject('c-defaults-tick', z, 'defaults at start', { once: true, onceDelay: '0.5' }, 170, 440, [[id('c-defaults')]]),
    fn('c-defaults', z, 'default settings', CONSOLE_CODE.defaults, 3, 400, 440, [[id('c-thr')], [id('c-quake-on')], [id('c-quake-pct')]]),
    uiSlider('c-thr', z, 'c-g-controls', 1, 'Shake threshold (m/s²)', 'threshold', 1, 20, 0.5, 640, 420, [[id('c-thr-store')]]),
    change('c-thr-store', z, 'store', setFlow('classThreshold'), 860, 420, [[]]),
    {
      id: id('c-quake-on'), type: 'ui-switch', z, name: '', label: 'Earthquake detector', group: id('c-g-controls'), order: 2,
      width: 0, height: 0, passthru: false, decouple: false, topic: 'quake', topicType: 'str', style: '', className: '',
      layout: 'row-spread', clickableArea: 'switch', onvalue: 'true', onvalueType: 'bool', onicon: '', oncolor: '',
      offvalue: 'false', offvalueType: 'bool', officon: '', offcolor: '', x: 650, y: 460, wires: [[id('c-quake-on-store')]],
    },
    change('c-quake-on-store', z, 'store', setFlow('quakeOn'), 860, 460, [[]]),
    uiSlider('c-quake-pct', z, 'c-g-controls', 3, '% of sharing phones needed', 'pct', 10, 100, 5, 660, 500, [[id('c-quake-pct-store')]]),
    change('c-quake-pct-store', z, 'store', setFlow('quakePct'), 860, 500, [[]]),
    uiButton('c-forget', z, 'c-g-controls', 4, 'Forget all phones', 'forget', 640, 540, [[id('c-forget-fn')]]),
    fn('c-forget-fn', z, 'forget phones', CONSOLE_CODE.forget, 1, 860, 540, [[id('c-table')]]),

    uiTextInput('c-msg', z, 'c-g-broadcast', 1, 'Message to all sharing phones (Enter to send)', 'message', 200, 620, [[id('c-broadcast')]]),
    uiButton('c-clear', z, 'c-g-broadcast', 2, 'Clear message on phones', 'clear', 190, 660, [[id('c-broadcast')]]),
    fn('c-broadcast', z, 'message to phones', CONSOLE_CODE.broadcast, 1, 460, 640, [[id('c-out')]]),

    uiPage('c-page', 'Class Console', '/console', 2),
    uiGroup('c-g-class', 'Class', 'c-page', 12, 1),
    uiGroup('c-g-fleet', 'Fleet', 'c-page', 12, 2),
    uiGroup('c-g-table', 'Phones', 'c-page', 6, 3),
    uiGroup('c-g-controls', 'Controls', 'c-page', 3, 4),
    uiGroup('c-g-broadcast', 'Message to phones', 'c-page', 3, 5),
    uiBase(), uiTheme(),
    mqttBroker(B, 'Class broker (instructor)', cfg.instructorUser, broker.instructorPass),
  ];
  if (broker.tls) nodes.push(tlsConfig());
  return nodes;
}

// ------------------------------------------------------------------ phone config

function phoneConfig() {
  const url = `wss://${cfg.host}:${cfg.websocketTlsPort}${cfg.websocketPath}`;
  return `// GENERATED by tools/build-flows.mjs from class-broker.json. Edit that file, not this one.
export const CONFIG = {
  brokerUrl: ${JSON.stringify(url)},
  username: ${JSON.stringify(cfg.studentUser)},
  defaultThreshold: ${Number(cfg.defaultThreshold)},
  shakeScaleMax: ${Number(cfg.shakeScaleMax)},
  recordSeconds: ${Number(cfg.recordSeconds)},
  autoPauseMinutes: ${Number(cfg.autoPauseMinutes)},
};
`;
}

// ------------------------------------------------------------------ write

const outDir = LOCAL_DIR ? resolve(LOCAL_DIR) : CLASS_TEST_DIR ? resolve(CLASS_TEST_DIR) : join(ROOT, 'node-red');
mkdirSync(outDir, { recursive: true });
const write = (name, data) => {
  const path = join(outDir, name);
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
  console.log('wrote', path);
};
write('student-starter.json', studentFlow(false));
write('student-solution.json', studentFlow(true));
write('instructor-console.json', consoleFlow());
if (!LOCAL_DIR && !CLASS_TEST_DIR) {
  writeFileSync(join(ROOT, 'phone', 'config.js'), phoneConfig());
  console.log('wrote', join(ROOT, 'phone', 'config.js'));
}
