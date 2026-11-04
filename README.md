# ECE 270 Phone Shake Alarm

A phone web page reads the phone's motion sensor and publishes it over MQTT. The student's Node-RED decides "ALERT" or "OK". The phone shows the decision in words. The instructor's Class Console sees only the phones that opt in. Students need nothing but their own phone and laptop, on any network.

The teaching plan, activities, slide mapping and test results are in [phone-shake-alarm.md](phone-shake-alarm.md).

## Status (2026-11-04)

- **Phase 1, the end-to-end build:** done.
- **Class broker:** EMQX Cloud Serverless (free tier), set up and checked with `npm run broker-check`.
- **Phone page:** live at **https://asishgeorge.github.io/ece270-shake-alarm/**.
- **Real phones:** tested on iPhone and Android, over Wi-Fi and mobile data. Real shakes measured 15–27 m/s², so the default threshold of 6 works and the gauges go to 30.
- **Demo setup:** a permanent Node-RED on the TA's Mac with both dashboards (see "The demo setup" below).
- **Next:** professor sign-off, then the lecture add-ons and materials (see the plan).

## Use it

### Phones
Open **https://asishgeorge.github.io/ece270-shake-alarm/** in Safari or Chrome, not in a QR-scanner preview. Then:
1. Keep or choose a pairing name.
2. Type the class password.
3. Tap **Start**. iPhones ask to allow motion access.

Keep the page in front, because phones pause background pages. "Class options" holds "Share my shake level with the class console" and "Who decides the alarm?".

### Node-RED on a laptop (see, run and edit the flows)

The manual way, as students will do it. On a laptop with nvm, `local/setup-node-red.sh` does steps 1–5 in one go; see the demo setup below.

One-time setup:
1. **Install Node.js** (LTS, version 22.9 or newer) from nodejs.org.
2. **Install Node-RED:** in a terminal, run `npm install -g node-red`. If that fails with a permission error on a Mac, use `npx node-red` in step 3 instead.
3. **Start it:** run `node-red`. Leave that terminal open.
4. **Open the editor** at **http://127.0.0.1:1880**.
5. **Add the dashboard:** Menu (☰, top right) → **Manage palette** → **Install** → search `@flowfuse/node-red-dashboard` → Install.

Load a flow:
1. Menu → **Import** → **select a file to import**, then pick a file from `node-red/`:
   - `student-starter.json`: what students start from.
   - `student-solution.json`: the finished activity.
   - `instructor-console.json`: the Class Console.
2. Click **Import**.
3. Double-click the purple **my phone** node (or **shared phones** in the console). Click the pencil next to *Server* and open the **Security** tab. Check the username: `student` for the student flows, `instructor` for the console. Type it if it's empty. Then type that login's password and click **Update**, then **Done**.
4. Click **Deploy**, top right.

Open the dashboards:
- **Student:** http://127.0.0.1:1880/dashboard/shake. Type the phone's pairing name and press Enter.
- **Class Console:** http://127.0.0.1:1880/dashboard/console. It lists **only phones that ticked "Share"** in Class options. That's on purpose: the class sees nothing unless a student opts in.

**Running both flows in one Node-RED:** import one file after the other. Node-RED may say some nodes already exist; those are the shared dashboard settings, and replacing them is fine.

**Editing:**
- Double-click any node to change it, then Deploy. That's how students build the activity.
- Changes made in the editor stay in that copy of Node-RED only. The files in `node-red/` are **generated** by `tools/build-flows.mjs`, so to change what students get, either ask for the change to be made in the generator, or use Menu → **Export** → Download and have it folded into the generator.

### The demo setup on the TA's Mac (permanent)

Set up on 2026-11-04 with two scripts. They work on any Mac or Linux laptop that has nvm, so they can be repeated on the professor's or the next TA's laptop.

| What | Where |
|---|---|
| Node.js 26 LTS | through nvm. The laptop's default Node is **not** changed; Node-RED alone uses 26. |
| Node-RED 5.0.9 + Dashboard 2.0 1.35.0 | the versions everything was tested with |
| Node-RED's data | `~/.node-red`: flows, settings, the dashboard, and the passwords, encrypted, readable only by you |
| Who can open it | **only this computer** (`127.0.0.1`). By default Node-RED would accept anyone on the same Wi-Fi, who could then run code on the laptop. |
| What's loaded | the student solution **and** the Class Console, with both passwords filled in |

```sh
local/setup-node-red.sh          # one time: Node 26, Node-RED, dashboard, localhost-only
local/node-red.sh start          # after every restart of the Mac (also: stop, restart, status, log)
cd tools && npm run deploy-demo  # (re)load both flows with the passwords from .env.local
```

- **Editor:** http://127.0.0.1:1880
- **Student dashboard:** http://127.0.0.1:1880/dashboard/shake
- **Class Console:** http://127.0.0.1:1880/dashboard/console

**When to re-run what:**
- **After changing the flows in the repo,** or after changing a password in `.env.local`: run `npm run deploy-demo`. Any other flows you've added to Node-RED are kept.
- **For a clean slate before a demo:** run `local/node-red.sh restart`. That clears pairings, gauges and the console table.

**Checked:** the 18-check browser test ran on exactly this path (live phone page → EMQX → this Node-RED, both dashboards): 18/18 passed.

### Demo run-through for the professor (about 10 minutes)

1. **Start Node-RED.** Run `local/node-red.sh restart`. Open the student dashboard and the Class Console in two browser tabs.
2. **Phone.** Open https://asishgeorge.github.io/ece270-shake-alarm/, note its pairing name, type the student password, tap **Start**, and allow motion.
3. **Pair.** Type the same pairing name into the student dashboard and press Enter. Within 5 s:
   - the phone shows **Laptop: Connected** and "All calm";
   - the dashboard shows "Receiving readings".
4. **The feedback loop.** Shake: the gauge and chart jump, and the phone says **"Shake detected!"** with the round trip in ms. Move the threshold slider to show false alarms against missed shakes.
5. **Edge vs cloud.** On the phone: Class options → Who decides → **This phone**. It reacts without the network, even in airplane mode. That's Level 1 against Level 3.
6. **The class view.** Tick **Share my shake level with the class console**, and the phone appears on the console. Then:
   - Choose **Class console** as the decider.
   - Type a message on the console and it appears on the phone.
   - With 2 or more phones sharing, shake them together for the **earthquake alert**.
7. **Privacy and security talking points:**
   - The console only sees phones that opt in, and never their raw data.
   - Students can't post console messages: the broker denies it.
   - There are no student IDs.
8. **Where it lives:** the editor at http://127.0.0.1:1880 shows the flows students build. Students get `node-red/student-starter.json`, which has only the plumbing.

### Class console in a lecture
1. Run `instructor-console.json` (instructor password) and put http://127.0.0.1:1880/dashboard/console on the projector.
2. Students tick **Share** on their phones.
3. Then:
   - **Earthquake detector:** if at least half the sharing phones keep shaking together for 1 s, every sharing phone shows an alert message.
   - **Who decides → Class console:** the console makes the ALERT/OK decision for those phones, so no Node-RED is needed on student laptops.
   - **Message to phones:** shows a text banner on every sharing phone.

## What's where

```
class-broker.json        the ONLY place the class broker is configured (no passwords: the repo is public)
phone/                   the phone page; published as-is to GitHub Pages
  index.html, style.css, app.js
  logic.js               pure logic (pairing names, topics, sampling, commands, display hold)
  config.js              GENERATED from class-broker.json
  vendor/                MQTT.js 5.16.1 (pinned copy, MIT licence)
node-red/                GENERATED flows to import into Node-RED
  student-starter.json   what students import: pairing + plumbing pre-built, they build the middle
  student-solution.json  the finished activity
  instructor-console.json  the Class Console
tools/
  build-flows.mjs        generates phone/config.js and node-red/*.json from class-broker.json
  broker-check.mjs       checks the class broker: logins, both ports, the deny rules
  deploy-demo.mjs        loads the student solution + Class Console into the running Node-RED, with passwords
  logic.test.mjs         unit tests for phone/logic.js
  e2e.mjs                browser end-to-end test (headless Chrome)
  sim.mjs                30-student load simulation
local/start-broker.sh    local Mosquitto that requires logins, like the class broker (for tests)
local/setup-node-red.sh  one-time install of a permanent Node-RED (Node 26 LTS via nvm, localhost only)
local/node-red.sh        start / stop / restart / status / log for that Node-RED
.github/workflows/pages.yml  publishes phone/ to GitHub Pages
```

Don't edit generated files. Edit `class-broker.json` or `tools/build-flows.mjs`, then run `npm run build-flows` in `tools/`.

## Run it locally (no cloud, no phone)

> This setup uses ports 1880 and 1881 for two test copies of Node-RED. Stop the demo Node-RED first (`local/node-red.sh stop`), then start it again afterwards. To run the browser test against the demo Node-RED instead, use:
> `E2E_TARGET=class PHONE_URL='https://asishgeorge.github.io/ece270-shake-alarm/?sim=1' CONSOLE_DASH=http://127.0.0.1:1880/dashboard/console npm run e2e`

You need:
- Node.js 22.9 or newer (Node-RED 5 requires it)
- Mosquitto (`brew install mosquitto` on a Mac)
- Google Chrome, for the browser test only

```sh
# 1. Broker (logins: student/dev-student, instructor/dev-instructor). Leave running.
local/start-broker.sh

# 2. Tools and local flows (localhost:1883, test passwords filled in), written to .local/
cd tools
npm install
node build-flows.mjs --local ../.local --student-pass dev-student --instructor-pass dev-instructor

# 3. Two Node-RED instances: a student laptop and the instructor. Leave running.
npm install -g node-red    # or use: npx node-red
node-red --userDir ~/.node-red-student --port 1880
node-red --userDir ~/.node-red-console --port 1881
#    In each userDir, once:  npm install @flowfuse/node-red-dashboard   (then restart that Node-RED)

# 4. Load the flows: in the editor use Menu > Import, or:
curl -X POST http://127.0.0.1:1880/flows -H "Content-Type: application/json" \
     -H "Node-RED-Deployment-Type: full" --data-binary @../.local/student-solution.json
curl -X POST http://127.0.0.1:1881/flows -H "Content-Type: application/json" \
     -H "Node-RED-Deployment-Type: full" --data-binary @../.local/instructor-console.json

# 5. Serve the phone page. Leave running.
cd ../phone && python3 -m http.server 8080 --bind 127.0.0.1
```

Then open:
- **Phone page:** http://localhost:8080/?broker=ws://localhost:9001&sim=1. Use any pairing name, password `dev-student`, and "Simulate a shake".
- **Student dashboard:** http://127.0.0.1:1880/dashboard/shake. Type the same pairing name.
- **Class Console:** http://127.0.0.1:1881/dashboard/console. On the phone page, open "Class options" and tick "Share".

## Tests

Run these in `tools/`, with steps 1–5 above running:

| Command | What it checks |
|---|---|
| `npm test` | Unit tests for the phone logic |
| `npm run e2e` | 18 checks in real headless Chrome: pairing, readings, ALERT/OK in words, round trip, still working after clicking Deploy, the three decision modes, console privacy and messages, name-clash warning. Screenshots go to `test-output/`. |
| `npm run sim -- --phones 30 --seconds 90 --quake-at 45 --share` | 30 phones + 30 laptops + the real console: lost readings, missed shakes, false alarms, round trips, earthquake detection, false earthquakes, data volume |
| `npm run broker-check` | The **class broker**: student and instructor logins on both ports, wrong password refused, deny rules work |
| `E2E_TARGET=class npm run e2e` | The browser test against the class broker. Node-RED must run flows built with `--class-test` (below). |
| `npm run sim -- --class --phones 30 --seconds 60 --share` | The simulation against the class broker. Keep it short: it uses the free quota. |

Tests against the class broker read the passwords from `../.env.local`, which git ignores:

```
STUDENT_PASS=...
INSTRUCTOR_PASS=...
```

To give the local Node-RED instances the real passwords for `E2E_TARGET=class`:

```sh
node --env-file=../.env.local build-flows.mjs --class-test ../.local/flows-class
# deploy those files as in step 4, run the test, then:
rm -rf ../.local/flows-class        # it contains the real passwords in plain text
```

## The class broker (EMQX Cloud Serverless, free tier)

Set up on 2026-11-04. Deployment: `z912aa6d.ala.us-east-1.emqxsl.com`.
- **8883:** MQTT over TLS, used by Node-RED.
- **8084:** WebSocket over TLS on `/mqtt`, used by the phone.

| Setting | Value |
|---|---|
| Spend limit | 0 (free quota only: 1 GB of traffic and 1 million session-minutes per month; the deployment is suspended if the quota runs out) |
| Logins | `student` (shared with the class), `instructor` |
| Deny rules for `student` | Publish on `ece270/class/broadcast`; Publish on `ece270/class/cmd/#` |
| Everything else | Allowed (EMQX allows anything not denied) |

**Free-tier limits the code is built around:**
- **Each client may publish at most 10 messages/s.** The phone sends 5 readings/s plus 2.5 class summaries/s, and the console sends one combined decisions message at most 4 times/s.
- **Session-minutes are metered.** Students' Node-RED connects only after pairing and disconnects after 15 minutes without the phone. The phone disconnects when it auto-pauses after 30 minutes.
- **At most 100 new connections per second** across the deployment.

**If the broker ever changes:**
1. Edit `class-broker.json` and run `npm run build-flows`.
2. Commit the change. The phone page republishes by itself.
3. Students re-import the starter flow.

**For students:**
- They import `node-red/student-starter.json`.
- They type the class password in the broker settings (double-click "my phone", edit the broker, Security tab), and the username `student` if it's empty.
- If port 8883 is blocked on a network, Node-RED can use `wss://<host>:8084/mqtt` instead.

## Publishing the phone page

Pushing to `main` with changes in `phone/` runs `.github/workflows/pages.yml`, which publishes only `phone/` (about a minute).

Two one-time settings were needed on GitHub:
- **Settings → Pages → Source:** "GitHub Actions".
- **Settings → Environments → github-pages → deployment branches:** must allow `main`. It was created allowing only `master`, which made the first deploy fail.

The first few deploys also timed out on GitHub's side ("updating_pages") before one went through. If that happens, re-run the workflow.

## Design rules

- **No student IDs.** Pairing names are chosen by students.
- **Private by default.** Raw readings go only to `ece270/pair/<name>/…`. Sharing with the class is opt-in and sends only the shake level.
- **No flashing.** The status changes in words with a steady colour, at most once per second.
- **No retained messages.** Nothing stays on the broker.
- **Under 10 publishes/s per client,** and connected only while in use (free-tier limits).
- **No passwords in the repo.** Node-RED doesn't export them, and the phone page asks for the password.
- **Messages are text, never HTML.** Anything arriving over MQTT is displayed as plain text, because anyone with the class password can publish.
