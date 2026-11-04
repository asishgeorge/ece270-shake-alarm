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
    return [null, { payload: 'Use 4–32 lowercase letters, numbers or dashes, the same as on your phone.' }];
}
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
    { payload: 'Paired with "' + name + '". Press Start on your phone.' }
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
};

const STARTER_INFO = `# Shake Alarm

**Already built for you (don't change):** pairing with your phone, the connection status,
and the node that sends commands back to your phone.

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
  const routerWires = withSolution ? [[id('s-shake')]] : [[]];
  const nodes = [
    { id: z, type: 'tab', label: 'Shake Alarm', disabled: false, info: STARTER_INFO },
    comment('s-c-readme', z, 'READ ME: Shake Alarm (double-click)', STARTER_INFO, 170, 40),
    comment('s-c-pair', z, 'Pairing and connection (pre-built)', '', 180, 100),
    uiTextInput('s-pair-in', z, 's-g-pair', 1, 'Pairing name (same as on your phone)', 'pair', 170, 140, [[id('s-pair')]]),
    fn('s-pair', z, 'pair with my phone', CODE.pair, 2, 420, 140, [[id('s-mqtt-in')], [id('s-pair-info')]]),
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

    // Dashboard layout
    uiPage('s-page', 'Shake Alarm', '/shake', 1),
    uiGroup('s-g-pair', 'Pair with your phone', 's-page', 4, 1),
    uiGroup('s-g-motion', "My phone's motion", 's-page', 8, 2),
    uiGroup('s-g-control', 'Alarm control', 's-page', 4, 3),
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
