# ECE 270 Phone Shake Alarm (instructor copy)

Students turn their own phone into an IoT sensor. A web page reads the phone's motion sensor and sends it over MQTT. The student's Node-RED decides **ALERT** or **OK** and sends the decision back, and the phone shows it in words. The instructor's **Class Console** sees only the phones whose owners opt in. Students need nothing but their own phone and laptop, on any network.

This is the **instructor copy**: the working flows, the Class Console, the broker setup and the test tools. A separate student copy will be made later.

Students are second-years with basic Python at most: no JavaScript, Node-RED or git. So:
- in **lectures** they use only their phone;
- any **hands-on** activity will be a small change to the working flow, so there is no hidden "solution".

**Documents:**
- **[lecture-demos.md](lecture-demos.md):** what the Shake Alarm teaches, as ten 5–15 minute lecture demos that need nothing but students' phones.
- **[phone-shake-alarm.md](phone-shake-alarm.md):** the full plan, with slide-by-slide mapping, test results and risks.

```
 phone (web page)  --readings-->  class broker  -->  student's Node-RED  (gauge, chart, ALERT/OK logic)
 phone  <--"Shake detected!"--   (EMQX Cloud)  <--   student's Node-RED
 phone  --shake level, only if "Share" is on-->  broker  -->  Class Console (instructor)
```

---

## Links and logins

| What | Where |
|---|---|
| Phone page | https://asishgeorge.github.io/ece270-shake-alarm/ |
| Class broker | EMQX Cloud Serverless (free tier), `z912aa6d.ala.us-east-1.emqxsl.com`. Port 8883 is MQTT over TLS (Node-RED); port 8084 is WebSocket over TLS on `/mqtt` (phones). |
| Logins | `student` (shared with the class) and `instructor` |
| Passwords | Only in the EMQX console and in `.env.local` on the instructor's laptop. **Never in this repo.** |
| Student dashboard | http://127.0.0.1:1880/dashboard/shake |
| Class Console | http://127.0.0.1:1880/dashboard/console |
| Node-RED editor | http://127.0.0.1:1880 |

`.env.local` sits next to this README, is ignored by git, and holds two lines:

```
STUDENT_PASS=...
INSTRUCTOR_PASS=...
```

---

## Demo on the instructor's laptop

**One-time setup** (Mac or Linux with nvm). It installs Node.js 26 LTS, Node-RED 5.0.9 and Dashboard 2.0 1.35.0, the versions everything was tested with. Your default Node version is not changed, and Node-RED only accepts connections from the laptop itself.

```sh
local/setup-node-red.sh
local/node-red.sh start
cd tools && npm install && npm run deploy-demo    # loads the student solution + Class Console with the passwords
```

**Each time:**

```sh
local/node-red.sh start      # after the laptop restarts (also: stop, restart, status, log)
local/node-red.sh restart    # clean slate before a demo: clears pairings, gauges, the console table
```

### Demo run-through (about 10 minutes)

1. **Open the dashboards.** Run `local/node-red.sh restart`. Open the student dashboard and the Class Console in two browser tabs.
2. **Phone.** Open the phone page, note the pairing name, type the student password, tap **Start**, and allow motion access.
3. **Pair.** Type the same pairing name into the student dashboard and press Enter. Within 5 s:
   - the phone shows **Laptop: Connected** and "All calm";
   - the dashboard shows "Receiving readings".
4. **Feedback loop.** Shake: the gauge and chart rise, and the phone says **"Shake detected!"** with the round-trip time. Move the threshold slider to show false alarms against missed shakes.
5. **Edge vs cloud.** On the phone: Class options → Who decides → **This phone**. It now reacts with no network, even in airplane mode. That's deployment Level 1 against Level 3.
6. **Class view.** Tick **Share my shake level with the class console**, and the phone appears on the console. Then:
   - Choose **Class console** as the decision maker.
   - Send a message from the console; it shows on the phone.
   - With 2 or more phones sharing, shake them together for the **earthquake alert**.
7. **Privacy and security:**
   - There are no student IDs.
   - The console sees only phones that opt in, and never their raw sensor data.
   - Students can't post console messages: the broker refuses them.

---

## Running it in class

**In lectures,** students only open the phone page; see [lecture-demos.md](lecture-demos.md).

**For a hands-on activity** (to be designed), students would:
1. Install Node-RED.
2. Import a working flow.
3. Make one small change.

That keeps it within reach of Python-only second-years. The current `student-starter.json`, which has empty middle parts for students to build, is probably too much for them and may be retired.

**Instructor:**
- Run the Class Console and project http://127.0.0.1:1880/dashboard/console.
- Students who tick **Share** appear on the console. From there:
  - **Earthquake detector:** if at least half the sharing phones keep shaking together for 1 s, every sharing phone shows an alert.
  - **Who decides → Class console:** the console decides ALERT/OK for those phones, so students need no Node-RED for lecture demos.
  - **Message to phones:** a text banner on every sharing phone.

**Phones:** use Safari or Chrome, not a QR-scanner preview, and keep the page in front, because phones pause background pages. Phones with no motion sensor get a **Simulate a shake** button.

### Installing Node-RED by hand (what students do)

1. Install **Node.js LTS** from nodejs.org.
2. In a terminal, run `npm install -g node-red`, then `node-red`. Leave that terminal open.
3. Open http://127.0.0.1:1880. Then Menu (☰) → **Manage palette** → **Install** → `@flowfuse/node-red-dashboard`.
4. Menu → **Import** → choose the flow file → **Import**.
5. Double-click the purple **my phone** node (or **shared phones** in the console). Click the pencil next to *Server* and open the **Security** tab:
   - username `student` (or `instructor` for the console);
   - the password.

   Click **Update**, then **Done**, then **Deploy**.

| Flow file | For | Dashboard |
|---|---|---|
| `node-red/student-starter.json` | students: the pairing and plumbing are pre-built, they build the logic | `/dashboard/shake` |
| `node-red/student-solution.json` | instructor: the finished activity | `/dashboard/shake` |
| `node-red/instructor-console.json` | instructor: the Class Console | `/dashboard/console` |

---

## Making changes

**Generated files:** `phone/config.js` and everything in `node-red/` are produced by `tools/build-flows.mjs` from `class-broker.json`. Don't edit them by hand.

| To change | Edit | Then |
|---|---|---|
| Broker, logins, threshold (6), gauge scale (30), auto-pause (30 min) | `class-broker.json` | `cd tools && npm run build-flows`, then `npm run deploy-demo`, then commit and push |
| Flow logic or dashboard layout | `tools/build-flows.mjs` | same as above |
| Phone page | `phone/*.js`, `index.html`, `style.css` | commit and push |

- **Phone page:** pushing to `main` republishes it through GitHub Pages in about a minute. Phones may need a refresh.
- **Edits made in the Node-RED editor** stay in that one copy of Node-RED. To keep them, export the flow (Menu → Export) and fold the change into `build-flows.mjs`.

---

## Each term

1. **Passwords:** change both logins in the EMQX console, update `.env.local`, then run `npm run deploy-demo`.
2. **Broker:** run `cd tools && npm run broker-check`. It should report both logins, both ports, a refused wrong password and the deny rules working. Also confirm that EMQX's free tier and its limits haven't changed (below).
3. **Phones:** open the phone page on one iPhone and one Android and pair each once.
4. **Tests:** run the browser test (below) against current Node-RED and Dashboard versions.
5. **Lecture room:** check that ports 8883 and 8084 get out from the room's network.

---

## The class broker: EMQX Cloud Serverless, free tier

| Setting | Value |
|---|---|
| Spend limit | 0: free quota only, and the deployment is suspended if the quota runs out |
| Free quota per month | 1 GB of traffic and 1 million session-minutes. A full 30-student, 30-minute session uses roughly 100–150 MB. |
| Deny rules for `student` | Publish on `ece270/class/broadcast` and on `ece270/class/cmd/#` |
| Everything else | Allowed |

**Limits the code is built around:**
- **At most 10 publishes per second per client.** The phone sends 7.5/s; the console sends one combined decisions message at most 4 times per second.
- **Connected minutes count against the quota.** Students' Node-RED connects only after pairing and disconnects after 15 minutes without the phone. Phones disconnect when they auto-pause after 30 minutes.
- **At most 100 new connections per second.**

**Topics,** all under `ece270/`:

| Topic | Purpose |
|---|---|
| `pair/<name>/phone` | readings and status |
| `pair/<name>/cmd` | ALERT/OK |
| `pair/<name>/laptop` | heartbeat |
| `class/phones/<name>` | shared shake level |
| `class/cmd/all` | console decisions; instructor only |
| `class/broadcast` | console messages; instructor only |

The full table is in the plan.

**To switch brokers:**
1. Edit `class-broker.json`, then run `npm run build-flows`.
2. Commit and push.
3. Re-run `npm run deploy-demo`.
4. Students re-import the starter.

---

## Tests

Run these in `tools/` after `npm install`. Tests against the class broker read `../.env.local`.

| Command | Checks |
|---|---|
| `npm test` | Unit tests for the phone logic |
| `npm run broker-check` | The class broker: logins, ports, deny rules |
| `E2E_TARGET=class PHONE_URL='https://asishgeorge.github.io/ece270-shake-alarm/?sim=1' CONSOLE_DASH=http://127.0.0.1:1880/dashboard/console npm run e2e` | 18 checks in headless Chrome, on the real path: live phone page → EMQX → the demo Node-RED. Needs the demo setup running. |
| `npm run sim -- --class --phones 30 --seconds 60 --share` | 30 simulated phones + 30 laptops + the real console against EMQX. It uses some of the free quota, so keep it short. |

**Offline tests with no cloud:** `local/start-broker.sh` runs a local Mosquitto with test logins (`student`/`dev-student`, `instructor`/`dev-instructor`). Then:
1. Run `node build-flows.mjs --local ../.local --student-pass dev-student --instructor-pass dev-instructor`.
2. Load those flows into two test copies of Node-RED, on ports 1880 (student) and 1881 (console). Stop the demo Node-RED first.
3. Serve `phone/` on port 8080.
4. Then `npm run e2e` and `npm run sim -- --share` run against that setup.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Phone says **Laptop: Not seen yet** | Type the phone's pairing name into the dashboard and press Enter. The names must match exactly. |
| Dashboard says **Not connected to the class broker** | Wrong or missing password in the broker's Security tab. |
| Phone says **The broker did not accept the class password** | Password typo. On the phone, Stop, then Start again. |
| Phone stops sending | The screen locked or the browser went to the background. Bring the page to the front. |
| Gauge shows an old value | The dashboard remembers the last value until new readings arrive. `local/node-red.sh restart` clears it. |
| Port 8883 blocked on a network | Set the Node-RED broker to `wss://<host>:8084/mqtt`. |
| Phone page didn't update after a push | Check the "Publish phone page" workflow on GitHub. It sometimes times out on GitHub's side; re-run it. Settings → Environments → github-pages must allow the `main` branch. |
| Everyone suddenly disconnected | The monthly free quota may be used up. Check usage in the EMQX console. |

---

## What's where

```
class-broker.json          broker, logins, threshold, gauge scale, auto-pause (no passwords)
phone/                     the phone page, published to GitHub Pages
  app.js, logic.js         page code; logic.js is the testable part
  config.js                generated from class-broker.json
  vendor/                  MQTT.js 5.16.1 (pinned, MIT licence)
node-red/                  generated flows: student-starter, student-solution, instructor-console
tools/
  build-flows.mjs          generates node-red/*.json and phone/config.js
  deploy-demo.mjs          loads solution + console into the local Node-RED with passwords
  broker-check.mjs         checks the class broker
  e2e.mjs, sim.mjs, logic.test.mjs   tests
local/
  setup-node-red.sh        one-time Node-RED install for the instructor's laptop
  node-red.sh              start / stop / restart / status / log
  start-broker.sh          local test broker (offline tests only)
lecture-demos.md           what it teaches: 10 lecture demos (phones only)
phone-shake-alarm.md       teaching plan, slide mapping, test results, risks
```

## Design rules

- **No student IDs.** Students choose pairing names.
- **Private by default.** Raw readings go only to the paired laptop. Sharing with the class is opt-in and sends only the shake level.
- **No flashing.** Status changes are words with a steady colour, at most once per second.
- **Nothing retained on the broker, and no passwords in the repo.**
- **Messages are text, never HTML.** Anyone with the class password can publish.
