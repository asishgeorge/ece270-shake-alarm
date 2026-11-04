// End-to-end test of the "Record" feature in a real browser (headless Chrome), with every real
// component except the phone's physical sensor (the phone page runs with ?sim=1, 50 samples/s):
//   phone page  --readings, each carrying a batch of recorded samples ("rec")-->  broker
//               -->  student Node-RED  -->  "Recording" panel: status, time series, 3D view, CSV
// An independent MQTT subscriber watches the wire. The class broker allows at most 10 publishes/s
// per client and the phone sends 5 readings/s, so recording must NOT add messages.
//
// Needs: local broker (local/start-broker.sh), the phone page served on :8092, and Node-RED with
// the solution flow (Recording panel included) on :1891. Override with PHONE_URL and STUDENT_DASH.
// The recording length is PHONE_URL's recsec parameter (6 s in the default URL).
// E2E_TARGET=class uses the class broker (STUDENT_PASS and INSTRUCTOR_PASS from ../.env.local).
// Usage: npm run e2e-recording   (screenshots go to ../test-output/, the CSV to ../test-output/downloads/)

import puppeteer from 'puppeteer-core';
import mqtt from 'mqtt';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'test-output');
const DOWNLOADS = join(OUT, 'downloads');
mkdirSync(DOWNLOADS, { recursive: true });
const cfg = JSON.parse(readFileSync(join(HERE, '..', 'class-broker.json'), 'utf8'));

const CLASS = process.env.E2E_TARGET === 'class';
const PHONE_URL = process.env.PHONE_URL || (CLASS
  ? 'http://localhost:8092/?sim=1&recsec=6'
  : 'http://localhost:8092/?broker=ws://localhost:9001&sim=1&recsec=6');
const STUDENT_DASH = process.env.STUDENT_DASH || 'http://127.0.0.1:1891/dashboard/shake';
const PASSWORD = CLASS ? process.env.STUDENT_PASS : 'dev-student';
const MQTT_URL = CLASS ? `mqtts://${cfg.host}:${cfg.mqttTlsPort}` : 'mqtt://localhost:1883';
const MQTT_USER = CLASS ? cfg.instructorUser : 'instructor';
const MQTT_PASS = CLASS ? process.env.INSTRUCTOR_PASS : 'dev-instructor';
if (!PASSWORD || !MQTT_PASS) {
  console.error('E2E_TARGET=class needs STUDENT_PASS and INSTRUCTOR_PASS in ../.env.local');
  process.exit(2);
}
const RECSEC = Number(new URL(PHONE_URL).searchParams.get('recsec')) || cfg.recordSeconds || 20;
const SIM_RATE = 50;     // samples per second the phone records in sim mode
const MAX_RATE = 5.5;    // readings per second allowed while recording (the phone sends 5)
const PAIR = 'e2e-rec-' + (10 + Math.floor(Math.random() * 90));
const PREFIX = `ece270/pair/${PAIR}/`;
const HEADER = 'time_s,ax,ay,az,gx,gy,gz,shake';
const REC_STATUS = '.shake-recording .rec-status';
const T0 = Date.now();

const CHROME = process.env.CHROME_PATH || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].find((p) => existsSync(p));

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
}
function summary() {
  const failed = results.filter((x) => !x.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed. Screenshots: ${OUT}`);
  return failed;
}

let browser = null;
let sub = null;
const LIMIT_S = 150 + 2 * RECSEC;
setTimeout(() => {
  check(`whole test finished within ${LIMIT_S} s`, false);
  summary();
  try { browser?.process()?.kill('SIGKILL'); } catch { /* already gone */ }
  process.exit(2);
}, LIMIT_S * 1000).unref();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Calls fn() until it returns something truthy (returned) or the timeout passes (null).
async function poll(fn, timeout, every = 200) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const v = await fn();
    if (v) return v;
    await sleep(every);
  }
  return null;
}

async function waitText(page, selector, re, timeout = 8000) {
  const start = Date.now();
  let last = '';
  while (Date.now() - start < timeout) {
    last = await page.$eval(selector, (el) => el.textContent.trim()).catch(() => '');
    if (re.test(last)) return { ok: true, text: last, ms: Date.now() - start };
    await new Promise((r) => setTimeout(r, 100));
  }
  return { ok: false, text: last, ms: Date.now() - start };
}

// Dashboard 2.0 text inputs: find by label text, replace the whole value (the dashboard
// remembers the previous value), then press Enter.
async function typeInto(page, labelText, text) {
  const start = Date.now();
  let found = false;
  while (!found && Date.now() - start < 15000) {
    found = await page.evaluate((label) => {
      for (const field of document.querySelectorAll('.v-input')) {
        if (field.textContent.includes(label)) {
          const input = field.querySelector('input');
          if (input) { input.setAttribute('data-e2e', 'target'); return true; }
        }
      }
      return false;
    }, labelText);
    if (!found) await new Promise((r) => setTimeout(r, 200));
  }
  if (!found) throw new Error(`no dashboard input labelled "${labelText}"`);
  const sel = 'input[data-e2e=target]';
  await page.click(sel);
  await page.$eval(sel, (el) => el.select());
  await page.type(sel, text);
  await page.keyboard.press('Enter');
  await page.$eval(sel, (el) => el.removeAttribute('data-e2e'));
}

// Polls the phone's #rec-status until it matches `until`. Keeps every distinct text seen, and
// notes any moment #record was clickable while the phone was counting down or recording.
const busyPolls = { count: 0, enabled: [] };
async function watchRecStatus(page, until, timeout) {
  const start = Date.now();
  const seen = [];
  let text = '';
  while (Date.now() - start < timeout) {
    const s = await page.evaluate(() => ({
      text: document.querySelector('#rec-status')?.textContent.trim() ?? '',
      disabled: document.querySelector('#record')?.disabled,
    })).catch(() => ({ text: '', disabled: null }));
    text = s.text;
    if (text && seen.at(-1) !== text) seen.push(text);
    if (/Get ready|Recording(…|\.\.\.)/.test(text)) {
      busyPolls.count++;
      if (s.disabled !== true) busyPolls.enabled.push(text);
    }
    if (until.test(text)) return { ok: true, seen, text, at: Date.now() };
    await sleep(50);
  }
  return { ok: false, seen, text, at: Date.now() };
}

// The Plotly plots in the Recording panel: each trace's type, name, point count and (for
// scatter3d) its x data as a string, so two snapshots can be compared.
function plots(page) {
  return page.evaluate(() => {
    const gdIn = (sel) => {
      const host = document.querySelector(sel);
      if (!host) return null;
      return host.classList.contains('js-plotly-plot') ? host : host.querySelector('.js-plotly-plot');
    };
    const describe = (gd) => (gd && Array.isArray(gd.data) ? gd.data.map((t) => ({
      type: t.type || 'scatter',
      name: String(t.name ?? ''),
      n: t.x?.length ?? 0,
      x: t.type === 'scatter3d' && t.x ? Array.from(t.x, Number).join(',') : '',
    })) : null);
    return { ts: describe(gdIn('.rec-timeseries')), d3: describe(gdIn('.rec-3d')) };
  }).catch(() => ({ ts: null, d3: null }));
}

async function shot(page, file, fullPage = false) {
  await page.bringToFront();
  await page.screenshot({ path: join(OUT, file), fullPage });
}
async function shotElement(page, selector, file) {
  await page.bringToFront();
  const el = await page.$(selector);
  if (el) await el.screenshot({ path: join(OUT, file) });
}

// ------------------------------------------------------------------ independent MQTT subscriber
const msgs = [];   // everything on ece270/pair/<PAIR>/#: { at, sub: 'phone' | 'phone/status' | 'cmd' | ..., bytes, json }
function subscribe() {
  return new Promise((resolve) => {
    const c = mqtt.connect(MQTT_URL, {
      clientId: `e2e-rec-sub-${Math.random().toString(16).slice(2, 8)}`,
      username: MQTT_USER, password: MQTT_PASS, protocolVersion: 4, reconnectPeriod: 0, connectTimeout: 10000,
    });
    const timer = setTimeout(() => resolve({ c, ok: false, detail: 'no answer in 12 s' }), 12000);
    const done = (ok, detail) => { clearTimeout(timer); resolve({ c, ok, detail }); };
    c.on('error', (e) => done(false, e.message));
    c.on('message', (topic, buf) => {
      let json = null;
      try { json = JSON.parse(buf.toString()); } catch { /* not JSON: shows up as a bad reading */ }
      msgs.push({ at: Date.now(), sub: topic.slice(PREFIX.length), bytes: buf.length, json });
    });
    c.once('connect', () => c.subscribe(PREFIX + '#', { qos: 0 }, (err, granted) =>
      done(!err && granted?.[0]?.qos !== 128, err ? err.message : `${MQTT_URL} as ${MQTT_USER}`)));
  });
}

let step = 'connecting the MQTT subscriber';
try {
  sub = await subscribe();
  check('independent MQTT subscriber listens on ' + PREFIX + '#', sub.ok, sub.detail);

  // Several tabs act as separate devices, so stop Chrome from slowing down the tabs that aren't in
  // front. SwiftShader gives the 3D plot a software WebGL in headless Chrome.
  step = 'launching Chrome';
  browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-first-run', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });

  // ---------------------------------------------------------------- 1. pair phone and dashboard
  step = 'opening the phone page';
  const phone = await browser.newPage();
  const phoneErrors = [];
  phone.on('pageerror', (e) => phoneErrors.push(e.message));
  phone.on('console', (m) => { if (m.type() === 'error') phoneErrors.push(m.text()); });
  await phone.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await phone.goto(PHONE_URL, { waitUntil: 'networkidle0' });

  step = 'starting the phone';
  await phone.$eval('#pair', (el) => { el.value = ''; });
  await phone.type('#pair', PAIR);
  await phone.$eval('#password', (el) => { el.value = ''; });
  await phone.type('#password', PASSWORD);
  await phone.click('#start');
  let r = await waitText(phone, '#info-conn', /^Connected$/);
  check('phone connects to the broker', r.ok, r.text);

  step = 'opening the student dashboard';
  const dash = await browser.newPage();
  const dashErrors = [];
  dash.on('pageerror', (e) => dashErrors.push(e.message));
  dash.on('console', (m) => { if (m.type() === 'error') dashErrors.push(m.text()); });
  await dash.setViewport({ width: 1280, height: 900 });
  await dash.goto(STUDENT_DASH, { waitUntil: 'networkidle2' });
  await dash.bringToFront();
  step = 'typing the pairing name into the dashboard';
  await typeInto(dash, 'Pairing name', PAIR);
  r = await waitText(phone, '#info-laptop', /^Connected$/, 8000);
  check('phone and dashboard pair (phone sees the laptop)', r.ok, r.text);

  // Also gives Plotly time to arrive from the CDN before the recording.
  step = 'looking at the dashboard Recording panel';
  r = await waitText(dash, REC_STATUS, /No recording yet/, 20000);
  check('dashboard Recording panel is idle: "No recording yet…"', r.ok, r.text || `no ${REC_STATUS}`);
  const webglHere = await dash.evaluate(() => {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  }).catch(() => false);

  step = 'waiting for the Record button';
  await phone.bringToFront();
  const recordReady = await phone.waitForFunction(() => {
    const b = document.querySelector('#record');
    return b && !b.disabled;
  }, { timeout: 8000, polling: 100 }).then(() => true, () => false);
  check('#record is enabled once connected', recordReady);

  // ---------------------------------------------------------------- 2. countdown, then recording
  step = 'clicking Record';
  const tClick = Date.now();
  await phone.click('#record');
  const cd = await watchRecStatus(phone, /Recording(…|\.\.\.)\s*\d+\s*s left/, 6000);
  const sawReady = cd.seen.some((t) => /Get ready(…|\.\.\.)\s*[1-3]/.test(t));
  check('#rec-status shows "Get ready… 3/2/1", then "Recording… N s left"', sawReady && cd.ok,
    `${cd.seen.join(' → ') || 'empty'}; recording ${((cd.at - tClick) / 1000).toFixed(1)} s after the click`);
  const tRec = cd.at;

  step = 'recording';
  await shot(phone, 'rec-01-phone-recording.png');
  r = await waitText(dash, REC_STATUS, /Recording from your phone/, 2500);
  check('dashboard shows "Recording from your phone…" while recording', r.ok, r.text);

  // ---------------------------------------------------------------- 4. shake while recording
  // A third of the way in, so the 1.5 s burst ends well before the recording does.
  step = 'simulating a shake while recording';
  await sleep(Math.max(0, tRec + Math.max(1000, Math.round(RECSEC * 1000 / 3)) - Date.now()));
  await phone.bringToFront();
  const tTap = Date.now();
  await phone.click('#tap-shake');
  r = await waitText(phone, '#status-word', /Shake detected/, 5000);
  check('the alarm still works while recording: "Shake detected!"', r.ok, `${r.text}, ${r.ms} ms after tap`);
  await shot(phone, 'rec-02-phone-shake-while-recording.png');

  // ---------------------------------------------------------------- 5. phone reports the send
  step = 'waiting for "Recording sent"';
  const sent = await watchRecStatus(phone, /Recording sent:\s*\d+\s+readings/,
    Math.max(3000, tRec + RECSEC * 1000 + 8000 - Date.now()));
  const phoneN = Number(sent.text.match(/Recording sent:\s*(\d+)/)?.[1]);
  check('phone ends with "Recording sent: N readings"', sent.ok, sent.text);
  await shot(phone, 'rec-03-phone-sent.png');
  await poll(() => msgs.some((m) => m.sub === 'phone' && m.json?.rec?.end === true), 3000);
  const reEnabled = await phone.waitForFunction(() => {
    const b = document.querySelector('#record');
    return b && !b.disabled;
  }, { timeout: 3000, polling: 100 }).then(() => true, () => false);
  check('#record is disabled during the countdown and recording, enabled again after',
    busyPolls.count > 0 && !busyPolls.enabled.length && reEnabled,
    `${busyPolls.count} polls while busy, enabled during: ${busyPolls.enabled[0] ?? 'never'}, enabled after: ${reEnabled}`);

  // ---------------------------------------------------------------- 3. the wire, seen by the subscriber
  step = 'checking the MQTT messages';
  const fromPhone = (m) => m.sub === 'phone' || m.sub.startsWith('phone/');
  const readings = msgs.filter((m) => m.sub === 'phone');
  const batches = readings.filter((m) => m.json?.rec && typeof m.json.rec === 'object');
  const recs = batches.map((m) => m.json.rec);
  const firstAt = batches[0]?.at;
  const lastAt = batches.at(-1)?.at;

  if (batches.length >= 2) {
    const during = msgs.filter((m) => fromPhone(m) && m.at >= firstAt && m.at <= lastAt);
    const rate = (during.length - 1) / ((lastAt - firstAt) / 1000);
    let peak = 0;
    for (const m of during) peak = Math.max(peak, during.filter((x) => x.at >= m.at && x.at < m.at + 1000).length);
    const byTopic = {};
    for (const m of during) byTopic[m.sub] = (byTopic[m.sub] || 0) + 1;
    check(`phone publishes ≤ ${MAX_RATE} messages/s while recording (broker allows 10)`, rate <= MAX_RATE,
      `${during.length} in ${((lastAt - firstAt) / 1000).toFixed(2)} s = ${rate.toFixed(2)}/s, peak ${peak} in 1 s, `
      + `${Object.entries(byTopic).map(([t, n]) => `${t}×${n}`).join(' ')}, largest ${Math.max(...during.map((m) => m.bytes))} bytes`);
  } else {
    check(`phone publishes ≤ ${MAX_RATE} messages/s while recording (broker allows 10)`, false,
      `only ${batches.length} readings carried "rec"`);
  }

  const known = new Set(['phone', 'phone/status', 'cmd', 'laptop']);
  const extra = {};
  for (const m of msgs) if (!known.has(m.sub)) extra[m.sub] = (extra[m.sub] || 0) + 1;
  check('recording rides on the readings: no new MQTT topics', !Object.keys(extra).length,
    Object.entries(extra).map(([t, n]) => `${PREFIX}${t}×${n}`).join(', '));

  const badFields = readings.filter((m) => !['ax', 'ay', 'az', 't'].every((k) => Number.isFinite(m.json?.[k])));
  check('every reading still has numeric ax, ay, az and t', readings.length > 0 && !badFields.length,
    `${readings.length} readings, ${batches.length} with "rec", ${badFields.length} bad`);

  const early = batches.filter((m) => m.at < tClick + 2500).length;
  check('no recorded data during the 3 s countdown', batches.length > 0 && !early,
    batches.length ? `first batch ${firstAt - tClick} ms after the click` : 'no batches');

  const problems = [];
  const ids = [...new Set(recs.map((x) => x.id))];
  if (!recs.length) problems.push('no batches');
  if (recs.length && (ids.length !== 1 || typeof ids[0] !== 'string' || !ids[0])) problems.push(`ids ${JSON.stringify(ids)}`);
  const badI = recs.findIndex((x, k) => x.i !== k);
  if (badI >= 0) problems.push(`batch ${badI} has i=${JSON.stringify(recs[badI].i)}`);
  const ends = recs.filter((x) => x.end === true).length;
  if (recs.length && (ends !== 1 || recs.at(-1).end !== true)) problems.push(`end:true ${ends} times${recs.at(-1)?.end === true ? '' : ', not on the last'}`);
  if (!recs.every((x) => x.dur === RECSEC)) problems.push(`dur ${[...new Set(recs.map((x) => x.dur))].join('/')}, expected ${RECSEC}`);
  if (!recs.every((x) => Number.isFinite(x.start) && x.start === recs[0].start)) problems.push('start missing or not the same in every batch');
  const gapsNoRec = readings.filter((m) => m.at > firstAt && m.at < lastAt && !m.json?.rec).length;
  if (gapsNoRec) problems.push(`${gapsNoRec} readings during the recording without "rec"`);
  check('rec batches: one id, i = 0, 1, 2… without gaps, end:true once, on the last', !problems.length,
    problems.join('; ') || `${recs.length} batches, id ${ids[0]}, dur ${RECSEC}`);

  const samples = recs.flatMap((x) => (Array.isArray(x.s) ? x.s : []));
  const maxMs = RECSEC * 1000 + 300;
  const badShape = recs.filter((x) => !Array.isArray(x.s)).length
    + samples.filter((s) => !(Array.isArray(s) && s.length === 7 && s.every(Number.isFinite))).length;
  let prev = -Infinity, backwards = 0, outside = 0, notInt = 0;
  for (const s of samples) {
    const ms = s?.[0];
    if (!Number.isInteger(ms)) notInt++;
    if (ms < prev) backwards++;
    if (!(ms >= 0 && ms <= maxMs)) outside++;
    prev = ms;
  }
  check(`samples are [ms, ax, ay, az, gx, gy, gz] with whole ms, in order, within 0–${maxMs}`,
    samples.length > 0 && !badShape && !backwards && !outside && !notInt,
    `${samples.length} samples, ms ${samples[0]?.[0]}…${samples.at(-1)?.[0]}; bad shape ${badShape}, `
    + `out of order ${backwards}, out of range ${outside}, not whole ${notInt}`);

  const expected = SIM_RATE * RECSEC;
  check(`about ${expected} samples (${SIM_RATE}/s × ${RECSEC} s, ±20%)`,
    Math.abs(samples.length - expected) <= 0.2 * expected, `${samples.length}`);

  // If "start" is a wall-clock time (same machine), the big samples must also be near the tap,
  // not only in the sim profile's own shaking part.
  const big = samples.filter((s) => Math.hypot(s[1], s[2], s[3]) > 15);
  let nearTap = null;
  const tapRel = tTap - recs[0]?.start;
  if (recs[0]?.start > 1e12) nearTap = big.filter((s) => s[0] >= tapRel - 300 && s[0] <= tapRel + 1200).length;
  check('the simulated shake is in the recording: samples with |a| > 15 m/s²', big.length > 0 && nearTap !== 0,
    `${big.length} samples > 15` + (nearTap === null ? '' : `, ${nearTap} within 1.2 s of the tap at ${tapRel} ms`));

  check('phone\'s "Recording sent" N equals the samples on the wire', Number.isFinite(phoneN) && phoneN === samples.length,
    `phone ${phoneN}, MQTT ${samples.length}`);
  const N = Number.isFinite(phoneN) ? phoneN : samples.length;

  // ---------------------------------------------------------------- 6. dashboard status
  step = 'checking the dashboard status';
  await dash.bringToFront();
  r = await waitText(dash, REC_STATUS, new RegExp(`\\b${N} readings\\b`), 25000);
  check(`dashboard .rec-status reaches "${N} readings", complete`, r.ok && !/incomplete/i.test(r.text),
    `${r.text || 'empty'}, after ${(r.ms / 1000).toFixed(1)} s`);

  // ---------------------------------------------------------------- 7. plots
  step = 'checking the plots';
  const p = (await poll(async () => {
    const x = await plots(dash);
    return x.ts && x.d3?.some((t) => t.type === 'scatter3d' && t.n === N) ? x : null;
  }, 10000)) || (await plots(dash));
  const ts = p.ts || [];
  const names = ts.map((t) => t.name.toLowerCase());
  check('.rec-timeseries has a Plotly plot with 4 traces: ax, ay, az, shake',
    ts.length === 4 && ['ax', 'ay', 'az', 'shake'].every((nm) => names.some((n) => n.includes(nm))) && ts.every((t) => t.n > 0),
    p.ts ? ts.map((t) => `${t.name || t.type}:${t.n}`).join(', ') : 'no Plotly plot');
  const d3 = p.d3 || [];
  const scatters = d3.filter((t) => t.type === 'scatter3d');
  check('.rec-3d has ≥ 2 scatter3d traces (one with all N points) and a mesh3d/surface sphere',
    scatters.length >= 2 && scatters.some((t) => t.n === N) && d3.some((t) => t.type === 'mesh3d' || t.type === 'surface'),
    p.d3 ? d3.map((t) => `${t.type}${t.name ? ' "' + t.name + '"' : ''}:${t.n}`).join(', ') : 'no Plotly plot');

  // ---------------------------------------------------------------- 8. WebGL
  step = 'checking WebGL';
  const canvases = (await poll(() => dash.evaluate(() => document.querySelectorAll('.rec-3d canvas').length), 5000)) || 0;
  const glError = await dash.evaluate(() => document.body.innerText.split('\n').find((l) => /webgl/i.test(l)) || '');
  check('3D view draws with WebGL: a canvas and no visible WebGL error', canvases > 0 && !glError,
    glError || `${canvases} canvas, WebGL ${webglHere ? 'available' : 'NOT available'} in this Chrome`);

  await sleep(1000);   // let the 3D scene finish drawing
  await shotElement(dash, '.shake-recording', 'rec-04-dashboard-recording-panel.png');
  await shot(dash, 'rec-05-dashboard-full.png', true);

  // ---------------------------------------------------------------- 9. window slider and width
  step = 'moving the window slider';
  const before = await plots(dash);
  const moved = await dash.evaluate(() => {
    const el = document.querySelector('input.rec-slider');
    if (!el) return null;
    const min = Number(el.min || 0), max = Number(el.max || 100), from = Number(el.value);
    el.value = String(max - from >= from - min ? max : min);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return { min, max, from, to: Number(el.value) };
  });
  const changed = moved && await poll(async () => {
    const now = await plots(dash);
    const idx = (now.d3 || []).map((t, k) => (t.type === 'scatter3d' && before.d3?.[k] && t.x !== before.d3[k].x ? k : -1))
      .filter((k) => k >= 0);
    return idx.length ? idx : null;
  }, 3000);
  check('moving .rec-slider changes the selected-window trace', !!changed,
    moved ? `slider ${moved.from} → ${moved.to} (range ${moved.min}–${moved.max}), `
      + (changed ? `scatter3d trace ${changed.join('/')} changed` : 'no scatter3d trace changed') : 'no input.rec-slider');

  step = 'setting the window width to "all"';
  const opts = await dash.evaluate(() => {
    const s = document.querySelector('select.rec-width');
    return s ? Array.from(s.options, (o) => ({ value: o.value, text: o.text.trim() })) : null;
  });
  const isOpt = (o, v) => new RegExp(`^${v}\\b`, 'i').test(o.value.trim()) || new RegExp(`^${v}\\b`, 'i').test(o.text);
  const hasAll4 = ['1', '2', '5', 'all'].every((v) => (opts || []).some((o) => isOpt(o, v)));
  const allOpt = (opts || []).find((o) => isOpt(o, 'all'));
  let full = null;
  if (allOpt) {
    await dash.select('select.rec-width', allOpt.value);
    // The window trace is the one the slider changed; without that, ask for two full scatter3d traces.
    full = await poll(async () => {
      const now = await plots(dash);
      const idx = changed || (now.d3 || []).map((t, k) => (t.type === 'scatter3d' ? k : -1)).filter((k) => k >= 0);
      const n = idx.filter((k) => now.d3?.[k]?.n === N);
      return (changed ? n.length > 0 : n.length >= 2) ? n : null;
    }, 3000);
  }
  check('.rec-width offers 1, 2, 5, all; "all" puts all N points in the window trace', hasAll4 && !!full,
    opts ? `options ${opts.map((o) => o.text || o.value).join('/')}, ${full ? `trace ${full.join('/')} has ${N} points` : `no window trace with ${N} points`}`
      : 'no select.rec-width');

  // ---------------------------------------------------------------- 10. CSV download
  step = 'downloading the CSV';
  for (const f of readdirSync(DOWNLOADS)) if (/\.(csv|crdownload)$/i.test(f)) unlinkSync(join(DOWNLOADS, f));
  const cdp = await browser.target().createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS });
  await dash.click('button.rec-download');
  let lastSize = -1;
  const file = await poll(() => {
    const f = readdirSync(DOWNLOADS).find((n) => n.toLowerCase().endsWith('.csv'));
    if (!f) return null;
    const size = statSync(join(DOWNLOADS, f)).size;
    const stable = size > 0 && size === lastSize;
    lastSize = size;
    return stable ? f : null;
  }, 10000);
  check('button.rec-download saves shake-recording-<pair>-<YYYYMMDD-HHMMSS>.csv',
    !!file && new RegExp(`^shake-recording-${PAIR}-\\d{8}-\\d{6}\\.csv$`).test(file), file || `nothing in ${DOWNLOADS}`);

  if (file) {
    const lines = readFileSync(join(DOWNLOADS, file), 'utf8').split(/\r?\n/);
    while (lines.length && lines.at(-1) === '') lines.pop();
    const rows = lines.slice(1).map((l) => l.split(','));
    const numeric = rows.every((c) => c.length === 8 && c.every((v) => v.trim() !== '' && Number.isFinite(Number(v))));
    const t = rows.map((c) => Number(c[0]));
    const ascending = t.every((v, k) => k === 0 || v >= t[k - 1]);
    const firstOk = t[0] >= 0 && t[0] <= 0.5;
    const lastOk = Math.abs(t.at(-1) - RECSEC) <= 0.5;
    check(`CSV: exact header, ${N} rows, time_s ascending from ~0 to ~${RECSEC} s`,
      lines[0] === HEADER && rows.length === N && numeric && ascending && firstOk && lastOk,
      `header ${lines[0] === HEADER ? 'ok' : JSON.stringify(lines[0])}, ${rows.length} rows, `
      + `${numeric ? '' : 'non-numeric cells, '}`
      + (rows.length ? `time ${t[0]}…${t.at(-1)} s${ascending ? '' : ', NOT ascending'}` : 'no data rows'));

    // Same samples as on the wire, in the same order (allowing for rounding, and for time_s
    // being counted from the first sample rather than from the start).
    const offset = samples.length ? t[0] - samples[0][0] / 1000 : 0;
    let mismatch = 0;
    rows.forEach((c, k) => {
      const s = samples[k];
      if (!s || Math.abs(Number(c[0]) - offset - s[0] / 1000) > 0.0051
        || [1, 2, 3, 4, 5, 6].some((j) => Math.abs(Number(c[j]) - s[j]) > 0.051)) mismatch++;
    });
    check('CSV rows match the samples the phone sent', rows.length === samples.length && !mismatch,
      `${mismatch} of ${rows.length} rows differ, ${samples.length} samples on the wire`);
  }

  // ---------------------------------------------------------------- 11. errors, 12. screenshots
  check('no errors on the phone page', phoneErrors.length === 0, phoneErrors.slice(0, 3).join(' | '));
  check('no errors on the dashboard page', dashErrors.length === 0, dashErrors.slice(0, 3).join(' | '));
} catch (e) {
  check(`test stopped early while ${step}`, false, String(e?.message || e).split('\n')[0]);
} finally {
  await browser?.close().catch(() => {});
  sub?.c.end(true);
}

const shots = ['rec-01-phone-recording.png', 'rec-04-dashboard-recording-panel.png'];
const fresh = (f) => existsSync(join(OUT, f)) && statSync(join(OUT, f)).mtimeMs >= T0 && statSync(join(OUT, f)).size > 0;
check('screenshots of the phone while recording and the dashboard panel after', shots.every(fresh),
  shots.map((f) => `${f}${fresh(f) ? '' : ' MISSING'}`).join(', '));

const failed = summary();
process.exit(failed ? 1 : 0);
