// ECE 270 Shake Alarm, phone page.
// Reads the phone's motion sensor, publishes 5 readings/s over MQTT (WebSocket + TLS)
// to ece270/pair/<pairing name>/phone, and shows the decision sent back by the student's
// Node-RED flow (or made on the phone, or by the class console) as words on the screen.

import mqtt from './vendor/mqtt-5.16.1.esm.js';
import { CONFIG } from './config.js';
import {
  topics, validatePairName, randomPairName, PeakWindow, readingPayload, syntheticSample,
  shakeLevel, parseCommand, roundTrip, StatusHold, localDecision, RollingMedian, classDecisionFor,
} from './logic.js';

const PUBLISH_MS = 200;          // 5 readings per second
const SHARE_EVERY = 2;           // class summary every 2nd reading (2.5/s): with the readings that is
                                 // 7.5 publishes/s, under EMQX's free-tier limit of 10 per client
const LAPTOP_TIMEOUT_MS = 12000; // laptop heartbeat is every 5 s
const BROADCAST_ALERT_MS = 20000;
const NO_SENSOR_AFTER_MS = 2500;

const params = new URLSearchParams(location.search);
const BROKER_URL = params.get('broker') || CONFIG.brokerUrl;
const USERNAME = params.has('user') ? params.get('user') : CONFIG.username;
const FORCE_SIM = params.has('sim'); // tests and laptops: no motion sensor, use simulated shakes
const BROKER_OVERRIDDEN = params.has('broker');
const BROKER_CONFIGURED = !/YOUR-CLUSTER/i.test(BROKER_URL);

const $ = (id) => document.getElementById(id);
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* private mode */ } },
};

const S = {
  client: null, cid: '', pair: '', T: null, password: '', shareTick: 0, shareMax: 0, lastClassT: null,
  running: false, paused: false, startedAt: 0, timer: null,
  win: new PeakWindow(), seq: 0, sent: 0, sentSet: new Set(), sentQueue: [],
  sensor: 'starting', sensorRate: 0, sensorStartedAt: 0, burstUntil: 0, level: 0,
  laptopSeenAt: 0, laptopCmd: null, laptopCmdAt: 0, classCmd: null,
  decider: 'laptop', share: false, threshold: CONFIG.defaultThreshold,
  rtt: new RollingMedian(10), lastRtt: null,
  hold: new StatusHold(1000), shown: 'WAIT', shownAt: 0,
  broadcastAt: 0, broadcastLevel: null, wakeLock: null, nameConflict: false,
};

// ------------------------------------------------------------------ setup screen

function initSetup() {
  $('insecure').hidden = window.isSecureContext;
  let host = BROKER_URL;
  try { host = new URL(BROKER_URL).host; } catch { /* show as typed */ }
  $('broker-host').textContent = host;

  if (!BROKER_CONFIGURED) {
    showWarning('No class broker is configured in this copy of the page yet. Ask your instructor for the right link.');
    $('start').disabled = true;
  } else if (BROKER_OVERRIDDEN) {
    showWarning(`This link uses a different broker (${host}). Only type the class password if your instructor gave you this link.`);
  }

  $('pair').value = store.get('ece270.pair') || randomPairName();
  const saved = store.get('ece270.password');
  if (saved) $('password').value = saved;
  if (USERNAME === '' && !saved) $('password').required = false;

  $('new-name').addEventListener('click', () => { $('pair').value = randomPairName(); });
  $('setup-form').addEventListener('submit', onStart);
}

function showWarning(text) {
  const w = $('broker-warning');
  w.textContent = text;
  w.hidden = false;
}

function setupError(text) { $('setup-error').textContent = text; }

async function onStart(ev) {
  ev.preventDefault();
  setupError('');
  const v = validatePairName($('pair').value);
  if (!v.ok) { setupError(v.reason); return; }
  const password = $('password').value;

  // Must be the first await: iOS only shows the permission prompt during the tap.
  const permission = FORCE_SIM ? 'simulated' : await requestMotionPermission();

  store.set('ece270.pair', v.name);
  if ($('remember').checked) store.set('ece270.password', password);
  else store.del('ece270.password');

  start(v.name, password, permission);
}

async function requestMotionPermission() {
  if (typeof DeviceMotionEvent === 'undefined') return 'unsupported';
  if (typeof DeviceMotionEvent.requestPermission === 'function') {
    try { return await DeviceMotionEvent.requestPermission(); } catch { return 'error'; }
  }
  return 'granted';
}

// ------------------------------------------------------------------ running

function start(pair, password, permission) {
  Object.assign(S, {
    password, shareTick: 0, shareMax: 0, lastClassT: null,
    pair, T: topics(pair), running: true, paused: false, startedAt: Date.now(), seq: 0, sent: 0,
    laptopSeenAt: 0, laptopCmd: null, laptopCmdAt: 0, classCmd: null, lastRtt: null, nameConflict: false,
    hold: new StatusHold(1000), rtt: new RollingMedian(10), sentSet: new Set(), sentQueue: [],
  });
  $('info-pair').textContent = pair;
  $('name-warning').hidden = true;
  $('paused').hidden = true;
  $('pause-minutes').textContent = CONFIG.autoPauseMinutes;
  $('setup').hidden = true;
  $('run').hidden = false;
  renderStatus('WAIT');

  S.sensorStartedAt = performance.now();
  if (permission === 'granted') {
    S.sensor = 'starting';
    window.addEventListener('devicemotion', onMotion);
  } else {
    S.sensor = permission === 'denied' ? 'denied' : 'none';
  }

  connect(password);
  keepAwake();
  S.timer = setInterval(tick, PUBLISH_MS);
}

function stop(reason) {
  if (S.client) {
    const c = S.client;
    if (c.connected) c.publish(S.T.phoneStatus, JSON.stringify({ state: 'offline', cid: S.cid }), { qos: 1 });
    c.end(false);
    S.client = null;
  }
  clearInterval(S.timer);
  window.removeEventListener('devicemotion', onMotion);
  S.running = false;
  S.share = false;
  $('share').checked = false;
  $('decider-class').disabled = true;
  setDecider('laptop');
  releaseWake();
  $('run').hidden = true;
  $('setup').hidden = false;
  if (reason) setupError(reason);
}

function onMotion(e) {
  const a = e.accelerationIncludingGravity;
  if (!a || a.x == null || a.y == null || a.z == null) return;
  const r = e.rotationRate || {};
  S.sensor = 'ok';
  S.win.add({ ax: a.x, ay: a.y, az: a.z, gx: r.alpha ?? 0, gy: r.beta ?? 0, gz: r.gamma ?? 0 });
}

function burstSample(now) {
  const w = new PeakWindow();
  for (let k = 0; k < PUBLISH_MS; k += 16) w.add(syntheticSample(now - PUBLISH_MS + k, true));
  return w.take();
}

function tick() {
  const now = Date.now();
  const delayed = S.hold.tick(now);
  if (delayed) renderStatus(delayed);
  if (!S.running) return;

  if (!S.paused && now - S.startedAt > CONFIG.autoPauseMinutes * 60000) pause();

  if (S.sensor === 'starting' && performance.now() - S.sensorStartedAt > NO_SENSOR_AFTER_MS) S.sensor = 'none';

  // One sample per window: the strongest real reading, or a simulated one.
  S.sensorRate = S.win.count * (1000 / PUBLISH_MS);
  let sample = S.win.take();
  if (now < S.burstUntil) sample = burstSample(now);
  else if (S.sensor !== 'ok') sample = syntheticSample(now, false);

  if (sample && !S.paused) {
    S.level = shakeLevel(sample);
    const seq = ++S.seq;
    if (S.client?.connected) {
      S.client.publish(S.T.readings, JSON.stringify(readingPayload(sample, now, seq)), { qos: 0 });
      rememberSent(now);
      S.sent += 1;
      if (S.share) {
        // Every 2nd window, share the strongest of the two (so short shakes still count).
        S.shareMax = Math.max(S.shareMax, S.level);
        if (++S.shareTick % SHARE_EVERY === 0) {
          S.client.publish(S.T.classPhone, JSON.stringify({
            s: Math.round(S.shareMax * 10) / 10, t: now, rtt: S.lastRtt, by: S.decider,
          }), { qos: 0 });
          S.shareMax = 0;
        }
      }
    }
    // Level 1: the phone decides by itself, even with no network at all.
    if (S.decider === 'phone') requestStatus(localDecision(S.level, S.threshold));
  }

  if (S.broadcastLevel === 'alert' && now - S.broadcastAt > BROADCAST_ALERT_MS) hideBroadcast();
  renderInfo(now);
}

// Auto-pause also disconnects: the free broker plan counts connected minutes.
function pause() {
  S.paused = true;
  $('paused').hidden = false;
  if (S.client) {
    if (S.client.connected) S.client.publish(S.T.phoneStatus, JSON.stringify({ state: 'offline', cid: S.cid }), { qos: 1 });
    S.client.end(false);
    S.client = null;
  }
  setConn('Paused (disconnected)');
}

function resume() {
  S.paused = false;
  S.startedAt = Date.now();
  $('paused').hidden = true;
  connect(S.password);
}

function rememberSent(t) {
  S.sentSet.add(t);
  S.sentQueue.push(t);
  if (S.sentQueue.length > 400) S.sentSet.delete(S.sentQueue.shift());
}

// ------------------------------------------------------------------ MQTT

function connect(password) {
  S.cid = 'ece270-ph-' + Math.random().toString(16).slice(2, 10);
  const T = S.T;
  const client = mqtt.connect(BROKER_URL, {
    clientId: S.cid,
    username: USERNAME || undefined,
    password: password || undefined,
    protocolVersion: 4,
    clean: true,
    keepalive: 10,
    reconnectPeriod: 2000,
    connectTimeout: 10000,
    will: { topic: T.phoneStatus, payload: JSON.stringify({ state: 'offline', cid: S.cid }), qos: 1, retain: false },
  });
  S.client = client;
  setConn('Connecting…');

  client.on('connect', () => {
    setConn('Connected');
    client.subscribe([T.cmd, T.laptop, T.phoneStatus], { qos: 1 }, () => {
      client.publish(T.phoneStatus, JSON.stringify({ state: 'hello', cid: S.cid }), { qos: 1 });
    });
    if (S.share) subscribeClass(true);
  });
  client.on('reconnect', () => setConn('Reconnecting…'));
  client.on('offline', () => setConn('Offline, retrying…'));
  client.on('error', (err) => {
    const authFailed = err?.code === 4 || err?.code === 5 || /not authori[sz]ed|bad user/i.test(err?.message || '');
    if (authFailed) {
      stop('The broker did not accept the class password. Check it and try again.');
    } else {
      setConn('Error: ' + (err?.message || 'unknown'));
    }
  });
  client.on('message', onMessage);
}

function subscribeClass(on) {
  const c = S.client;
  if (!c) return;
  const list = [S.T.classDecisions, S.T.classBroadcast];
  if (on) c.subscribe(list, { qos: 1 });
  else c.unsubscribe(list);
}

function onMessage(topic, buf) {
  const text = buf.toString();
  const now = Date.now();
  const T = S.T;

  if (topic === T.cmd) {
    const c = parseCommand(text);
    if (!c) return;
    S.laptopCmd = c.cmd;
    S.laptopCmdAt = now;
    S.laptopSeenAt = now;
    noteRtt(c.t, now);
    if (S.decider === 'laptop') requestStatus(c.cmd);
  } else if (topic === T.laptop) {
    const firstContact = !S.laptopSeenAt;
    S.laptopSeenAt = now;
    // The laptop only sends a command when its decision changes. A phone that just started
    // learns the current decision from the heartbeat instead (no round-trip time for these).
    const beat = safeJson(text);
    const last = beat && typeof beat.last === 'string' ? beat.last.toUpperCase() : null;
    if (!S.laptopCmd && (last === 'ALERT' || last === 'OK')) {
      S.laptopCmd = last;
      S.laptopCmdAt = now;
      if (S.decider === 'laptop') requestStatus(last);
    } else if (firstContact && S.decider === 'laptop' && S.shown === 'WAIT') {
      renderStatus('WAIT');
    }
  } else if (topic === T.classDecisions) {
    const c = classDecisionFor(text, S.pair);
    if (!c) return;
    S.classCmd = c.cmd;
    if (S.decider !== 'class') return;
    if (c.t !== S.lastClassT) { S.lastClassT = c.t; noteRtt(c.t, now); }
    requestStatus(c.cmd);
  } else if (topic === T.classBroadcast) {
    const m = safeJson(text);
    if (!m) return;
    if (m.level === 'clear') hideBroadcast();
    else showBroadcast(String(m.text ?? '').slice(0, 200), m.level === 'alert' ? 'alert' : 'info');
  } else if (topic === T.phoneStatus) {
    const m = safeJson(text);
    if (!m || m.cid === S.cid) return;
    if (m.state === 'hello') {
      // Someone else just started with our pairing name: tell them, and warn here too.
      S.client?.publish(T.phoneStatus, JSON.stringify({ state: 'in-use', cid: S.cid }), { qos: 1 });
      showNameConflict();
    } else if (m.state === 'in-use') {
      showNameConflict();
    }
  }
}

function noteRtt(t, now) {
  const rtt = roundTrip(t, now, S.sentSet);
  if (rtt != null) { S.rtt.add(rtt); S.lastRtt = rtt; }
}

function safeJson(text) { try { return JSON.parse(text); } catch { return null; } }

// ------------------------------------------------------------------ display

function requestStatus(state) {
  const d = S.hold.request(state, Date.now());
  if (d) renderStatus(d);
}

const DECIDER_TEXT = {
  laptop: 'Decided by your laptop',
  phone: 'Decided by this phone',
  class: 'Decided by the class console',
};

function renderStatus(state) {
  S.shown = state;
  S.shownAt = Date.now();
  const card = $('status-card');
  card.className = 'status ' + (state === 'ALERT' ? 'alert' : state === 'OK' ? 'calm' : 'waiting');
  if (state === 'ALERT') {
    $('status-word').textContent = 'Shake detected!';
    $('status-detail').textContent = DECIDER_TEXT[S.decider];
  } else if (state === 'OK') {
    $('status-word').textContent = 'All calm';
    $('status-detail').textContent = DECIDER_TEXT[S.decider];
  } else if (S.decider === 'class') {
    $('status-word').textContent = 'Waiting for the class console…';
    $('status-detail').textContent = 'The console decides once it sees your shake level.';
  } else if (S.laptopSeenAt) {
    $('status-word').textContent = 'Laptop connected';
    $('status-detail').textContent = 'No decision from it yet. Is your flow wired into "send to my phone"?';
  } else {
    $('status-word').textContent = 'Waiting for your laptop…';
    $('status-detail').textContent = `Type "${S.pair}" as the pairing name in Node-RED, then shake.`;
  }
}

function setConn(text) { $('info-conn').textContent = text; }

function ago(ms) {
  const s = Math.round(ms / 1000);
  return s < 2 ? 'just now' : `${s} s ago`;
}

function renderInfo(now) {
  const pct = Math.min(100, (S.level / 20) * 100);
  $('level-bar').style.width = pct + '%';
  $('level-value').textContent = S.level.toFixed(1) + ' m/s²';
  const mark = $('threshold-mark');
  mark.hidden = S.decider !== 'phone';
  mark.style.left = Math.min(100, (S.threshold / 20) * 100) + '%';

  $('info-laptop').textContent = !S.laptopSeenAt ? 'Not seen yet'
    : now - S.laptopSeenAt < LAPTOP_TIMEOUT_MS ? 'Connected' : `Not seen for ${Math.round((now - S.laptopSeenAt) / 1000)} s`;

  $('info-sensor').textContent = {
    ok: `Motion sensor on (${Math.round(S.sensorRate)}/s)`,
    starting: 'Starting…',
    none: 'No motion sensor. Use "Simulate a shake".',
    denied: 'Motion access denied. Use "Simulate a shake".',
  }[S.sensor] || S.sensor;

  $('info-sent').textContent = S.paused ? `${S.sent} (paused)` : String(S.sent);
  $('info-laptop-cmd').textContent = S.laptopCmd ? `${S.laptopCmd} · ${ago(now - S.laptopCmdAt)}` : '—';
  const med = S.rtt.value;
  $('info-rtt').textContent = S.lastRtt == null ? '—' : `${S.lastRtt} ms (median ${Math.round(med)} ms)`;
}

function showBroadcast(text, level) {
  $('broadcast-text').textContent = text; // textContent, never innerHTML: anyone with the password can publish here
  $('broadcast').className = 'broadcast ' + level;
  $('broadcast').hidden = false;
  S.broadcastAt = Date.now();
  S.broadcastLevel = level;
}

function hideBroadcast() {
  $('broadcast').hidden = true;
  S.broadcastLevel = null;
}

function showNameConflict() {
  S.nameConflict = true;
  $('name-warning').hidden = false;
}

// ------------------------------------------------------------------ controls

function initRunControls() {
  $('tap-shake').addEventListener('click', () => { S.burstUntil = Date.now() + 1500; });
  $('stop').addEventListener('click', () => stop());
  $('resume').addEventListener('click', resume);

  $('share').addEventListener('change', (e) => {
    S.share = e.target.checked;
    $('decider-class').disabled = !S.share;
    if (S.client?.connected) subscribeClass(S.share);
    if (!S.share && S.decider === 'class') setDecider('laptop');
  });

  document.querySelectorAll('input[name=decider]').forEach((el) => {
    el.addEventListener('change', (e) => setDecider(e.target.value));
  });

  const slider = $('threshold');
  slider.value = String(S.threshold);
  $('threshold-value').textContent = S.threshold.toFixed(1);
  slider.addEventListener('input', () => {
    S.threshold = Number(slider.value);
    $('threshold-value').textContent = S.threshold.toFixed(1);
  });
}

function setDecider(value) {
  S.decider = value;
  document.querySelectorAll('input[name=decider]').forEach((el) => { el.checked = el.value === value; });
  $('local-threshold').hidden = value !== 'phone';
  S.hold = new StatusHold(1000);
  const laptopAlive = S.laptopSeenAt && Date.now() - S.laptopSeenAt < LAPTOP_TIMEOUT_MS;
  if (value === 'laptop') renderStatus(laptopAlive && S.laptopCmd ? S.laptopCmd : 'WAIT');
  else if (value === 'class') renderStatus(S.classCmd || 'WAIT');
  else renderStatus(localDecision(S.level, S.threshold));
}

// ------------------------------------------------------------------ screen awake

async function keepAwake() {
  try { S.wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* not supported or denied */ }
}
function releaseWake() {
  try { S.wakeLock?.release(); } catch { /* ignore */ }
  S.wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.running) keepAwake();
});

initSetup();
initRunControls();
