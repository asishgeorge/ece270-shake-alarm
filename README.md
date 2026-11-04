# ECE 270 Phone Shake Alarm

A phone web page reads the phone's motion sensor and publishes it over MQTT. The student's Node-RED decides "ALERT" or "OK". The phone shows the decision in words. The instructor's Class Console sees only the phones that opt in. Students need nothing but their own phone and laptop, on any network.

The teaching plan, activities, slide mapping and test results are in [phone-shake-alarm.md](phone-shake-alarm.md).

**Status:**
- **Phase 1 (end-to-end build):** done.
- **Class broker:** EMQX Cloud Serverless, free tier, set up and tested (`npm run broker-check`, plus the browser test and the 30-student simulation against it).
- **Next:** GitHub Pages and real phones.

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
  logic.test.mjs         unit tests for phone/logic.js
  e2e.mjs                browser end-to-end test (headless Chrome)
  sim.mjs                30-student load simulation
local/start-broker.sh    local Mosquitto that requires logins, like the class broker
.github/workflows/pages.yml  publishes phone/ to GitHub Pages
```

Don't edit generated files. Edit `class-broker.json` or `tools/build-flows.mjs`, then run `npm run build-flows` in `tools/`.

## Run it locally (no cloud, no phone)

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
| `npm run e2e` | 16 checks in real headless Chrome: pairing, readings, ALERT/OK in words, round trip, the three decision modes, console privacy and messages, name-clash warning. Screenshots go to `test-output/`. |
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
- They type the class password in the broker settings (double-click "my phone", edit the broker, Security tab). The username is already filled in.
- If port 8883 is blocked on a network, Node-RED can use `wss://<host>:8084/mqtt` instead.

## Design rules

- **No student IDs.** Pairing names are chosen by students.
- **Private by default.** Raw readings go only to `ece270/pair/<name>/…`. Sharing with the class is opt-in and sends only the shake level.
- **No flashing.** The status changes in words with a steady colour, at most once per second.
- **No retained messages.** Nothing stays on the broker.
- **Under 10 publishes/s per client,** and connected only while in use (free-tier limits).
- **No passwords in the repo.** Node-RED doesn't export them, and the phone page asks for the password.
- **Messages are text, never HTML.** Anything arriving over MQTT is displayed as plain text, because anyone with the class password can publish.
