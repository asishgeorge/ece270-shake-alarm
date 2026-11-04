// End-to-end test in a real browser (headless Chrome), with every real component except
// the phone's physical sensor:
//   phone page  ->  broker  ->  student Node-RED (solution flow)  ->  broker  ->  phone page
//   phone page  ->  broker  ->  instructor console               ->  broker  ->  phone page
//
// Needs: local broker (local/start-broker.sh), the phone page served on :8080,
// Node-RED with the --local solution flow on :1880 and the console flow on :1881.
// Usage: node e2e.mjs   (screenshots go to ../test-output/)

import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'test-output');
mkdirSync(OUT, { recursive: true });

const PHONE_URL = process.env.PHONE_URL || 'http://localhost:8080/?broker=ws://localhost:9001&sim=1';
const STUDENT_DASH = process.env.STUDENT_DASH || 'http://127.0.0.1:1880/dashboard/shake';
const CONSOLE_DASH = process.env.CONSOLE_DASH || 'http://127.0.0.1:1881/dashboard/console';
const PASSWORD = process.env.STUDENT_PASS || 'dev-student';
const PAIR = 'e2e-otter-' + (10 + Math.floor(Math.random() * 90));

const CHROME = process.env.CHROME_PATH || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].find((p) => existsSync(p));

setTimeout(() => { console.log('FAIL  whole test took longer than 150 s'); process.exit(2); }, 150000).unref();

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`);
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

async function bodyHas(page, re, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const text = await page.evaluate(() => document.body.innerText).catch(() => '');
    if (re.test(text)) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
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

// Several tabs act as separate devices, so stop Chrome from slowing down the tabs that aren't in front.
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-first-run', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows'],
});
async function shot(page, file, fullPage = false) {
  await page.bringToFront();
  await page.screenshot({ path: join(OUT, file), fullPage });
}
try {
  // ---------------------------------------------------------------- phone
  const phone = await browser.newPage();
  const phoneErrors = [];
  phone.on('pageerror', (e) => phoneErrors.push(e.message));
  phone.on('console', (m) => { if (m.type() === 'error') phoneErrors.push(m.text()); });
  await phone.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await phone.goto(PHONE_URL, { waitUntil: 'networkidle0' });
  await shot(phone, '01-phone-setup.png');

  await phone.$eval('#pair', (el) => { el.value = ''; });
  await phone.type('#pair', PAIR);
  await phone.$eval('#password', (el) => { el.value = ''; });
  await phone.type('#password', PASSWORD);
  await phone.click('#start');
  let r = await waitText(phone, '#info-conn', /^Connected$/);
  check('phone connects to the broker with the class password', r.ok, r.text);
  r = await waitText(phone, '#status-word', /Waiting for your laptop/);
  check('phone waits for the laptop before any decision', r.ok, r.text);

  // ---------------------------------------------------------------- student laptop dashboard
  const dash = await browser.newPage();
  await dash.setViewport({ width: 1280, height: 900 });
  await dash.goto(STUDENT_DASH, { waitUntil: 'networkidle2' });
  await dash.bringToFront();
  await typeInto(dash, 'Pairing name', PAIR);
  check('laptop dashboard shows the pairing', await bodyHas(dash, new RegExp(`Paired with "${PAIR}"`)));
  check('laptop dashboard receives readings', await bodyHas(dash, /Receiving readings \(\d+ per second\)/));

  r = await waitText(phone, '#info-laptop', /^Connected$/, 8000);
  check('phone sees the laptop heartbeat', r.ok, r.text);
  r = await waitText(phone, '#status-word', /All calm/, 8000);
  check('laptop flow sends OK while still', r.ok, r.text);
  await shot(phone, '02-phone-calm.png');

  // Shake (simulated burst of 1.5 s)
  await phone.bringToFront();
  await phone.click('#tap-shake');
  r = await waitText(phone, '#status-word', /Shake detected/, 5000);
  check('shake -> laptop decides ALERT -> phone shows it in words', r.ok, `${r.text}, ${r.ms} ms after tap`);
  const rtt = await phone.$eval('#info-rtt', (el) => el.textContent);
  check('round trip measured from the echoed timestamp', /\d+ ms/.test(rtt), rtt);
  await shot(phone, '03-phone-alert.png');
  await shot(dash, '04-laptop-dashboard.png', true);
  r = await waitText(phone, '#status-word', /All calm/, 6000);
  check('returns to calm after the shake', r.ok, r.text);

  // ---------------------------------------------------------------- level 1: decide on the phone
  await phone.bringToFront();
  await phone.click('#advanced summary');
  await phone.click('input[name=decider][value=phone]');
  await phone.click('#tap-shake');
  r = await waitText(phone, '#status-word', /Shake detected/, 3000);
  const by = await phone.$eval('#status-detail', (el) => el.textContent);
  check('"This phone" mode decides locally', r.ok && /this phone/.test(by), `${r.ms} ms, ${by}`);
  await waitText(phone, '#status-word', /All calm/, 6000);

  // ---------------------------------------------------------------- class console
  const cons = await browser.newPage();
  await cons.setViewport({ width: 1400, height: 1000 });
  await cons.goto(CONSOLE_DASH, { waitUntil: 'networkidle2' });
  check('console does NOT see a phone that is not sharing', !(await bodyHas(cons, new RegExp(PAIR), 3000)));

  await phone.bringToFront();
  await phone.click('#share');
  check('console sees the phone once sharing is on', await bodyHas(cons, new RegExp(PAIR), 8000));

  await phone.bringToFront();
  await phone.click('input[name=decider][value=class]');
  await phone.click('#tap-shake');
  r = await waitText(phone, '#status-word', /Shake detected/, 5000);
  const by2 = await phone.$eval('#status-detail', (el) => el.textContent);
  check('"Class console" mode: console decides', r.ok && /class console/.test(by2), `${r.ms} ms, ${by2}`);
  await waitText(phone, '#status-word', /All calm/, 6000);

  await cons.bringToFront();
  await typeInto(cons, 'Message to all sharing phones', 'Hello from the console');
  r = await waitText(phone, '#broadcast-text', /Hello from the console/, 5000);
  check('console message appears on the sharing phone', r.ok, r.text);
  await shot(phone, '05-phone-broadcast.png', true);
  await shot(cons, '06-console.png', true);

  // ---------------------------------------------------------------- name clash
  const phone2 = await browser.newPage();
  await phone2.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await phone2.goto(PHONE_URL, { waitUntil: 'networkidle0' });
  await phone2.$eval('#pair', (el) => { el.value = ''; });
  await phone2.type('#pair', PAIR);
  await phone2.click('#start');
  const clash2 = await phone2.waitForSelector('#name-warning:not([hidden])', { timeout: 6000 }).then(() => true).catch(() => false);
  const clash1 = await phone.waitForSelector('#name-warning:not([hidden])', { timeout: 3000 }).then(() => true).catch(() => false);
  check('two phones with the same pairing name both get a warning', clash1 && clash2);
  await phone2.bringToFront();
  await phone2.click('#stop');

  check('no errors in the phone page console', phoneErrors.length === 0, phoneErrors.join(' | '));
} finally {
  await browser.close();
}

const failed = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed. Screenshots: ${OUT}`);
process.exit(failed ? 1 : 0);
