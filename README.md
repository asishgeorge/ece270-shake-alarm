# ECE 270 Phone Shake Alarm

A phone web page reads the phone's motion sensor and publishes it over MQTT. The student's Node-RED decides "ALERT" or "OK". The phone shows the decision in words. The instructor's Class Console sees only the phones that opt in. Students need nothing but their own phone and laptop, on any network.

The teaching plan, activities, slide mapping and test results are in [phone-shake-alarm.md](phone-shake-alarm.md).

**Status:** Phase 1 (end-to-end build) is done and tested against a local broker. Phase 2 (cloud broker, GitHub Pages, real phones) is next.

> **Broker change (2026-11-04):** HiveMQ Cloud's free Serverless plan no longer accepts new clusters and shuts down on 2026-12-31. The class broker will be a different provider (decision pending). Everything broker-specific lives in `class-broker.json`, so switching means editing that file and running `npm run build-flows`.

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

## Going live (Phase 2)

1. **HiveMQ Cloud** (free plan): create a cluster and two credentials.
   - `student` with permission "Publish and Subscribe" on `ece270/#`.
   - `instructor` with the same permission.
   - Keep the passwords out of this repo.
2. Put the cluster host in `class-broker.json`, then run `cd tools && npm run build-flows`.
3. Publish this repo on GitHub. Under Settings → Pages → Source, choose "GitHub Actions". The workflow publishes only `phone/`.
4. Open the Pages URL on one iPhone and one Android phone and run through the activity. Tune `defaultThreshold` if real shakes don't cross 6 m/s².
5. Students import `node-red/student-starter.json`. In the broker settings (Security tab) they type the class password; the username is already filled in.

**If port 8883 is blocked:** Node-RED can use the WebSocket port instead. Set the broker to `wss://<host>:8884/mqtt`.

## Design rules

- **No student IDs.** Pairing names are chosen by students.
- **Private by default.** Raw readings go only to `ece270/pair/<name>/…`. Sharing with the class is opt-in and sends only the shake level.
- **No flashing.** The status changes in words with a steady colour, at most once per second.
- **No retained messages.** Nothing stays on the broker.
- **No passwords in the repo.** Node-RED doesn't export them, and the phone page asks for the password.
- **Messages are text, never HTML.** Anything arriving over MQTT is displayed as plain text, because anyone with the class password can publish.
