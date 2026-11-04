# Phone Shake Alarm

**Every student already carries an IoT device.** A web page on the phone reads the phone's motion sensors and publishes them over MQTT to a cloud broker. Node-RED on the student's laptop turns the readings into a "shake level," shows it on a dashboard, and when it crosses a threshold sends a decision back. The phone then changes its status in words: **"All calm"** or **"Shake detected!"**

So the phone is the sensor and the actuator, the laptop is the controller, and the internet is the network: a complete networked CPS with no extra hardware.

| | |
|---|---|
| **Format** | The **Node-RED part** is the likely graded activity. The phone page and instructor console stay the same all term and also serve as **lecture demos** (5–15 min each). |
| **Hardware** | Students: their own phone and laptop, on **any network**, e.g. the phone on mobile data and the laptop on campus Wi-Fi. Both connect out to the cloud broker. Instructor: one laptop running the Class Console. Nothing to buy. |
| **Scale** | 20–30 students. Tested with 30 simulated phones + 30 simulated laptops (see [Test results](#test-results-phase-1)). |
| **Privacy** | **No student IDs anywhere.** Students pick a pairing name. A phone's data goes only to the laptop using the same name, unless the student turns on "Share with class". |
| **Covers** | 20 of the 26 decks, strongest on networking, data and security |

---

## Decisions (2026-11-04)

1. **Pairing names instead of IDs.** The phone and laptop use a pairing name the student chooses (the page suggests one like `calm-otter-42`). Readings go only to topics under that name, and only the laptop with that name subscribes.
2. **No flashing.** The phone shows a status change in words with a steady colour. The display changes at most once per second however fast commands arrive.
3. **One git repo per project.** This folder is its own repo.
4. **No student IDs, any network.** The page warns against using a student number or real name as the pairing name.
5. **Build first, decide schedule later.** Phase 1 is the end-to-end system, to present to the professor for sign-off. Deadlines, grading and which parts become the activity come after.
6. **Materials come after Phase 1:** handouts, slides, worksheets, run sheets.

## Phases

| Phase | What | Status |
|---|---|---|
| **1. End-to-end build** | Phone page, student starter + solution flows, Class Console, local broker, unit tests, browser end-to-end test, 30-student simulation | **Done and tested locally (2026-11-04)** |
| **2. Real phones + cloud broker** | Cloud broker, GitHub Pages, test on one iPhone and one Android, tune the default threshold on real phones | **Done (2026-11-04).** EMQX broker checked. Page live at https://asishgeorge.github.io/ece270-shake-alarm/. Worked on iPhone and Android, over Wi-Fi and mobile data. Real shakes measured 15–27 m/s², so the threshold stays at 6 and the gauges now go to 30. One bug found and fixed: clicking Deploy left the laptop disconnected. |
| **3. Professor sign-off** | Demo the end-to-end system | **Demo setup ready (2026-11-04):** a permanent Node-RED on the TA's Mac (Node 26 LTS, localhost only) with the student solution and the Class Console. The README has a 10-minute run-through. |
| **4. Lecture add-ons** | Acknowledge button and state machine (SA-5), labelled recording + CSV logger + Orange workflow (SA-6), latency histogram (SA-4) | After sign-off |
| **5. Materials** | Setup handout (Windows/Mac), step-by-step student guide in the style of the existing demo decks, QR-code slide, worksheets (RTM, state chart, STRIDE), instructor run sheets | After sign-off |

---

## The system

```
 STUDENT PHONE (browser page)              CLOUD BROKER (EMQX, free)                STUDENT LAPTOP (Node-RED + Dashboard 2.0)
  motion sensor, 5 readings/s ─────►  ece270/pair/<name>/phone          ─────►  "phone readings" → student's nodes
  hello / in-use / offline ────────►  ece270/pair/<name>/phone/status   ─────►  (shake level → gauge, chart, switch,
  status in words  ◄────────────────  ece270/pair/<name>/cmd            ◄─────   ALERT/OK, filter) → "send to my phone"
  "Laptop: Connected"  ◄────────────  ece270/pair/<name>/laptop         ◄─────  heartbeat every 5 s (+ last decision)

  ONLY IF "Share with class" IS ON:
  shake level, round trip ─────────►  ece270/class/phones/<name>        ─────►  CLASS CONSOLE (instructor's Node-RED):
  decision (console mode)  ◄────────  ece270/class/cmd/all              ◄─────   table, fleet chart, earthquake detector,
  instructor's message  ◄───────────  ece270/class/broadcast            ◄─────   messages to phones, decides for phones
                                                                                 that pick "Class console"
```

| Topic | From → to | QoS | Content |
|---|---|---|---|
| `ece270/pair/<name>/phone` | phone → laptop | 0 | `{"ax","ay","az","gx","gy","gz","t","seq"}`: the strongest reading of each 200 ms window, so short shakes aren't missed |
| `ece270/pair/<name>/phone/status` | phone ↔ phone, laptop | 1 | `hello` on start, `in-use` reply if another phone has the same name, `offline` (Last Will) |
| `ece270/pair/<name>/cmd` | laptop → phone | 1 | `{"cmd":"ALERT"\|"OK","t":<phone's timestamp>}`. Echoing `t` lets the phone time the round trip with its own clock. |
| `ece270/pair/<name>/laptop` | laptop → phone | 1 | Heartbeat every 5 s with the laptop's last decision, so a phone that just started shows the current state |
| `ece270/class/phones/<name>` | phone → console | 0 | `{"s","t","rtt","by"}` 2.5 times/s: shake level only, never raw readings |
| `ece270/class/cmd/all` | console → phones | 1 | `{"t","d":{"<name>":{"cmd","t"}}}`: one combined message (at most 4/s) for every phone that lets the console decide. **Instructor only.** |
| `ece270/class/broadcast` | console → phones | 1 | `{"level":"info"\|"alert"\|"clear","text"}`. **Instructor only.** |

No message is retained, so nothing stays stored on the broker between classes.

**Who decides the alarm** is chosen on the phone, and the phone listens only to that source, so two controllers can never fight:
- **My laptop** (default): the student's Node-RED flow. This is Level 3.
- **This phone:** a threshold on the phone itself; works even in airplane mode. This is Level 1.
- **Class console:** the instructor's console decides (needs sharing on). Students don't need Node-RED for this one.

### Phone page features

- **Startup:**
  - Pairing name (random suggestion, editable) and the class password, typed in and never built into the page.
  - The Start button also triggers the iOS motion-permission prompt.
  - The page then keeps the screen awake.
- **Status in words:** "Waiting for your laptop…", "Laptop connected", "All calm" or "Shake detected!", each with who decided. At most one change per second, with no animation or blinking.
- **Info panel:**
  - broker connection
  - laptop seen
  - sensor state
  - readings sent
  - the laptop's last decision
  - round trip, latest and median
- **"Simulate a shake" button** for phones with no motion sensor, denied permission, or demos from a laptop browser.
- **Warnings:**
  - when two phones use the same pairing name
  - when the page link points to a non-standard broker (protection against phishing for the class password)
- **Auto-pause after 30 minutes** so a forgotten tab doesn't keep using data.
- **Stays private:** motion data only, never location. Instructor messages are shown as plain text, never as HTML.

---

## Class broker: EMQX Cloud Serverless, free tier (set up 2026-11-04)

The plan was first written for HiveMQ Cloud's free plan. That plan closed to new sign-ups and retires on 2026-12-31, so the class uses **EMQX Cloud Serverless** instead.

| | |
|---|---|
| **Free each month** | 1 GB of traffic and 1 million session-minutes. The spend limit is 0, so the deployment is suspended rather than billed if the quota runs out. |
| **Connections** | Up to 1,000; at most 100 new ones per second |
| **Per client** | At most **10 publishes per second**, and 10 subscriptions |
| **Logins** | `student` (shared with the class) and `instructor` |
| **Deny rules** for `student` | Publish on `ece270/class/broadcast` and on `ece270/class/cmd/#`. Students can't fake the earthquake alert, instructor messages or class-console decisions. **Verified:** EMQX answers "Not authorized". |
| **Still possible with the shared login** | Reading or writing another pair's topics if you know or wildcard its pairing name. That's the SA-8 lesson. The fix is per-pair logins with a `ece270/pair/${username}/#` rule, created through EMQX's API; it's optional and can be decided after sign-off. |

**How the code fits the limits:**
- **Phone:** sends 5 readings/s plus 2.5 class summaries/s = 7.5 publishes/s.
- **Console:** sends one combined decisions message at most 4 times/s instead of one per phone. In an earthquake, 30 separate messages at once would break the 10/s limit.
- **Laptops:** Node-RED connects only after pairing and disconnects after 15 minutes without the phone.
- **Auto-pause:** the phone disconnects when it auto-pauses after 30 minutes.

**Measured on EMQX** (from the TA's Mac to US-East, 2026-11-04):

| Measure | Result |
|---|---|
| Browser end-to-end test | 16/16 checks passed |
| Round trip, one real pair | median about 180 ms |
| 30 phones + 30 laptops + console, 60 s: readings lost | 11 of 8,985 (0.12%, all QoS 0 readings) |
| Shakes detected | 191 of 191, no false alarms |
| Round trip under class load | median 231 ms, 95th percentile 341 ms, max 631 ms |
| Earthquake alert | 30 of 30 phones, 1.55 s after the class started shaking; no false earthquakes |
| Data | about 44 MB published per 30-minute class. With the broker's copies, roughly 100–150 MB of the 1 GB quota per class, so about 7–10 full-class sessions per month. |

Real phones on mobile data will add some latency; this is measured in Phase 2.

---

## Activities

### SA-0 Setup homework (before the hands-on class)
**Slides:** none; this is logistics
**Time:** about 20 min at home, due one week before SA-1

**What to do**
1. Students install Node.js (LTS), Node-RED and Dashboard 2.0 using the one-page Windows/Mac handout (Phase 5). On a Mac, use `npx node-red` if permissions fail.
2. They import the **starter flow**, type the class password into the broker settings, open the phone page, and pair.

**Students see / produce:** "Phone: Receiving readings" on their dashboard and "Laptop: Connected" on their phone. That proves the whole setup works before class. There's no roll call, because there are no IDs. Students who can't get there come to office hours, or pair with a classmate in class.

---

### SA-1 Build the Shake Alarm (the hands-on activity)
**Slides:**
- **1.1 Foundations:** s5–6 (CPS loop), s9 (NCPS)
- **1.3 Architecture:** s4–5
- **3.1 Comm Models:** s8–11 (publish-subscribe)
- **3.2 MQTT:** s14–28
- **3. Data Analytics-II:** s14–17 (feature engineering)

**Time:** 30 min, best placed after the MQTT deck

**Already in the starter flow (students don't change it):**
- the broker settings
- the pairing box on the dashboard
- the dynamic subscription to their pairing name
- the connection status
- the heartbeat
- a **"phone readings (wire from here)"** node
- a **"send to my phone (wire into here)"** node
- a start-up threshold of 6

**What to do**
1. **(3 min)** Open the phone page in Safari or Chrome (not the camera app's preview), and keep or choose a pairing name. Tap Start. Type the same name into the laptop dashboard.
2. **(12 min)** Build 8 nodes between the two pre-built nodes:
   - A **function** "shake level" that turns three axes into one number:
     ```js
     const { ax, ay, az } = msg.payload;              // m/s², gravity included
     const g = Math.sqrt(ax*ax + ay*ay + az*az);      // about 9.8 when still
     msg.payload = +Math.abs(g - 9.81).toFixed(2);    // 0 = still, bigger = shaking
     return msg;
     ```
   - A **gauge** and a **chart** for the shake level.
   - A **switch** with two rules: "> flow.threshold", otherwise.
   - Two **change** nodes that set `msg.payload` to `ALERT` and to `OK`.
   - A **filter** node ("block unless value changes"), so the phone gets one message per change rather than 5 per second.
   - A **slider** wired into "store threshold".
3. **(12 min) Experiments**, about 2 minutes each:
   1. **Threshold too low:** constant false alarms. **Too high:** missed shakes.
   2. **Turn off the phone's Wi-Fi.** It still works over mobile data, because this runs through the internet.
   3. **Airplane mode:** the dashboard says "No readings for 12 s". What should a fall detector do now?
   4. **Read the round trip** on the phone. Why would a real device decide by itself? Switch to "This phone" and compare.
   5. **Class finale:** "everyone turn on sharing and shake now." Every line spikes on the Class Console.
4. **(3 min) Optional watchdog:** add a `trigger` node that shows **SENSOR OFFLINE** if no reading arrives for 3 s.

**Students see / produce**
- Their own dashboard with a live gauge, a chart and a working slider.
- Their phone saying "Shake detected!" when they shake it, and "All calm" after.
- **Optional mark:** ordered screenshots of the flow, the dashboard and the phone, in the same style as the CPS assignment.

**Concepts:**
- the CPS loop with a human in it
- sensor and actuator on one device
- publish-subscribe and topics
- feature creation
- thresholds and false alarms
- event vs telemetry (the filter node)
- a watchdog

---

### SA-2 Class earthquake detector
**Slides:**
- **1.1 Foundations:** s24–25 (hybrid CPS + IoT, "Black Ice" collective intelligence)
- **2.3 Deployment Levels:** s35–40 (Level 4, observers), s47–51 (Level 6, cloud control)
- **3.1 Comm Models:** s26–27 (fanout, broadcast)

**Time:** 10 min (phones only)

**What to do**
1. Everyone turns on **Share my shake level with the class console**. The console only sees phones that opted in.
2. The console counts how many sharing phones are shaking right now.
3. **One phone shaking:** someone dropped a phone. Nothing happens.
4. **At least half the sharing phones keep shaking together for 1 s:** "earthquake." The console publishes to `ece270/class/broadcast` and **every sharing phone shows "Earthquake! 27 of 30 phones shook at the same time."** The percentage is a slider on the console.

   In the 30-phone simulation the alert reached all 30 phones about 1.3 s after the class started shaking, with no false earthquakes. An earlier, looser rule (30% within 2 s) fired falsely from individual shakes overlapping by chance, which is itself a good discussion point.
5. Connect it to the real world: Android phones form an earthquake alert network in roughly this way, and Victoria is in an earthquake zone.
6. **Discussion:** each phone alone can't tell a drop from a quake. Only the cloud, seeing many devices, can. But the cloud is too slow to catch a falling phone. That's s24's reflexes vs collective intelligence.

**Students see / produce**
- The whole room's phones showing the earthquake message together.
- A one-line answer: which decisions belong on the device, and which in the cloud?

**Concepts:** collective intelligence, Level 4 observer, Level 6 central control, broadcast, aggregation, the false-positive trade-off at fleet scale.

---

### SA-3 Decide on the phone or in the cloud? Level 1 vs Level 3
**Slides:**
- **2.3 Deployment Levels:** s10–14 (Level 1), s29–34 (Level 3)
- **2.1 Design Methodology-I:** s10 (NF-02: safety logic runs locally)
- **3.1 Comm Models:** s33–36 (edge, fog, cloud)

**Time:** 10 min (phones only)

**What to do**
1. Half the room switches the page to **Who decides: This phone.** The status changes as soon as they shake.
2. The other half leaves it on **My laptop**, or **Class console** if they have no Node-RED yet. The change comes after a round trip, shown on the phone in ms.
3. Everyone turns on airplane mode and shakes again. Only phone-decided alarms still work.

**Students see / produce**
- The two latencies side by side.
- Answers to "Is a fall detector Level 1 or Level 3? What about a step counter?"

**Concepts:** deployment levels, edge vs cloud decisions, latency, network dependency, availability.

---

### SA-4 A latency requirement, measured live
**Slides:**
- **2.1 Design Methodology-I:** s8–10 (functional and non-functional requirements), s12–16 (RTM)
- **1.1 Foundations:** s16–17 (jitter, "Phantom Lag")

**Time:** 10 min (phones only)

**What to do**
1. Write a requirement in the slides' format: **REQ-NF-01: the alarm must reach the phone within 500 ms of the shake.**
2. Each phone shows its own round-trip time (latest and median). With sharing on, the console table lists every phone's round trip and the summary shows the class median and 90th percentile.
3. *(Phase 4 add-on)* The console plots a histogram of the class's latencies. Most pass, a few on weak Wi-Fi fail, and the spread is **jitter**.
4. Fill in the RTM row: PASS for most, FAIL for some. Is the requirement wrong, or the design?

**Students see / produce**
- Their own latency.
- The class histogram.
- An RTM row with PASS/FAIL and a proposed fix.

**Concepts:** measurable non-functional requirements, test cases, traceability, latency vs jitter, designing for the worst case rather than the average.

---

### SA-5 Alarm state chart with acknowledge
**Slides:** 2.2 Design Methodology-II: s18–26 (states, events, guards, self-transitions), s30 (state chart vs flowchart), s31–32 (fault detection)
**Time:** 10 min

**What to do**
1. Before the demo, students draw the state chart:
   - IDLE —[shake > threshold]→ ALERT —[tap Acknowledge]→ ACKNOWLEDGED —[after 10 s]→ IDLE
   - plus a self-transition on ALERT, and a FAULT state for "no data for 3 s."
2. *(Phase 4 add-on)* Turn on the Acknowledge button and the console's state machine. Students test edge cases:
   - shaking again while acknowledged
   - airplane mode during ALERT.
3. Compare their charts with the behaviour they see.

**Students see / produce**
- A state chart, checked against the real behaviour, with any missing transitions found by testing.

**Concepts:** states, events, guards, timeouts, self-transitions, fault states, why a state chart rather than a flowchart.

---

### SA-6 Motion data → database → Orange classifier
**Slides:**
- **1. Databases:** s6–8 (IoT database characteristics), s15–18 (the two tables), s30–34 (queries), s40–42 (pipeline)
- **2. Data Analytics-I:** s4–7 (descriptive, predictive, prescriptive), s15–17 (ETL)
- **3. Data Analytics-II:** s7 (classification vs clustering), s11 (classification), s14–24 (features, split, training, testing), s27–28 (clustering, anomaly detection)
- **4. Data Analytics Demo:** Orange

**Time:** 15 min in lecture, or a follow-up activity

**What to do**
1. *(Phase 4 add-on)* **Collect.** Students press a label button on the phone (still, walking, shaking, or "drop onto a pillow") and perform it for 20 s. Each student's own Node-RED appends the labelled readings to a CSV file **on their own laptop**, so the data stays within the pair.

   For a class-wide dataset, students can choose to hand in their CSV. 30 phones × 5 readings/s would be 150 rows/s, a real write-heavy time series.
2. **ETL and features.** Compute these over 1-second windows:
   - mean and standard deviation of the shake level
   - peak value
   - gyroscope magnitude
3. **Orange.** Train a Random Forest on the class's data and show the confusion matrix. Which movements get confused, and why?
4. **Anomaly detection.** Isolation Forest trained on "still" and "walking" only flags the drops, with no labels needed.
5. **Descriptive.** Which movement has the highest average shake? How long was each recording? Run the slides' style of SQL queries on the table.

**Students see / produce**
- An Orange workflow trained on **their own class's data** instead of the 15-row CSV.
- A confusion matrix.
- Flagged anomalies.

**Concepts:**
- time-series data and write-heavy workloads
- schema design
- ETL
- feature engineering with windows
- supervised vs unsupervised learning
- the train/test split
- classification metrics
- anomaly detection

---

### SA-7 Follow one message through the network
**Slides:**
- **3.1 Comm Models:** s4–11 (request-response vs publish-subscribe), s28–31 (exclusive pair)
- **3.1 App Layer:** s5–6 (encapsulation), s10 (data formatting)
- **3.2 MQTT:** s14–18 (message flow; s17 keepalive), s19–28 (QoS)
- **3.3 Comm APIs:** s18–24 (WebSocket, REST vs WebSocket)
- **3.4 TCP/UDP:** s13–17 (TCP, handshake), s23–28 (TLS)
- **3.3.1 Network Layer:** s10–13 (addressing), s45 (gateway)

**Time:** 15 min

**What to do**
1. **Topics and wildcards.** The laptop subscribes to `ece270/pair/<name>/phone/#`: one subscription gets both readings and status. The console subscribes to `ece270/class/phones/+`, one level for every sharing phone. Ask: what would `ece270/pair/+/phone` see? Everyone's raw data. The free broker can't forbid it; see SA-8.
2. **QoS.** Readings go at QoS 0, alerts at QoS 1. On weak signal, readings drop but alerts still arrive.
3. **Keepalive and Last Will.**
   - Lock your phone. Within about 15 s the broker notices the missing keepalive (s17) and publishes the phone's **Last Will** ("offline"). The laptop dashboard switches to "Your phone went offline".
   - Last Will isn't in the slides; it's a 2-minute extension.
4. **Why WebSocket?** Browsers can't open raw TCP connections, so the phone runs MQTT *inside* a WebSocket. Compare that with polling a REST endpoint every 200 ms.
5. **TLS in Wireshark.** Point the instructor laptop's Node-RED at the public broker on port 1883 and the JSON is readable. Point it at the class broker (EMQX) on port 8883 and it's encrypted. This also explains why the phone page must be HTTPS.
6. **Addressing and gateways.**
   - The phone on cellular and the laptop on campus Wi-Fi both have private addresses behind NAT, so neither can reach the other directly.
   - Both connect *out* to the broker, which is why IoT uses brokers.

**Students see / produce**
- A labelled path diagram: phone → cellular/Wi-Fi gateway → internet → broker → laptop, with the protocol at each layer.
- A readable vs encrypted Wireshark capture.

**Concepts:**
- publish-subscribe, topics and wildcards
- QoS
- keepalive and Last Will
- WebSocket vs REST
- encapsulation
- TCP and TLS
- NAT and gateways
- why brokers exist

---

### SA-8 Who sent that alarm? Spoofing, fake data and privacy
**Slides:**
- **5.1 Mirai:** s14 (hard-coded credentials)
- **5.2 Security Intro:** s5–15 (CIA, confidentiality), s16–19 (integrity), s20–25 (availability, watchdog), s26–33 (threat modelling, STRIDE)
- **5.3 Edge Security:** s27–29 (false data injection), s34 (sensor fusion)
- **5.4 Comm Security:** s4–5 (the 4 tiers), s21–24 (Tier 4, cloud)
- **3.1 App Layer:** s16–21 (identity, authentication, authorization, integrity and freshness)

**Time:** 15–20 min

> The instructor demonstrates on a volunteer first. Students then try it only in consenting pairs, only on class topics.

**What to do**
1. **Spoofed alert (authorization).** The volunteer tells you their pairing name. From the instructor laptop, publish `{"cmd":"ALERT"}` to `ece270/pair/<name>/cmd`. Their phone says "Shake detected!" although nobody shook it. The round trip shows "—", because the forged message doesn't echo one of the phone's own timestamps: a hint at how to detect forgeries.

   Everyone shares one class password, so anyone who knows (or sniffs) a pairing name can do this. The pairing name works like a weak shared secret. The fix is per-device logins with topic permissions. EMQX supports this (a rule on `ece270/pair/${username}/#`), but each pair would then need its own login. Compare: the console topics *are* protected, because publishing there is denied to the student login. Try it and show the "Not authorized" reply.
2. **False data injection (integrity).** Publish fake readings to the volunteer's data topic. Their dashboard shows an earthquake that never happened.

   The fix is sensor fusion (s34): a real shake moves the gyroscope too, so check that both agree. Signed messages with `seq` defend against replay (s21).
3. **Confidentiality and privacy.** The design keeps data private *by convention*: only your laptop subscribes to your pairing name, and sharing with the console is opt-in and sends only the shake level. But anyone with the class password could subscribe to `ece270/pair/#` and read every phone's motion. Why does iOS ask permission for motion data at all? Research shows motion sensors can leak what you type or how you move.

   That is also why the page never uses location, and why the password isn't built into the page: Mirai spread through hard-coded credentials (s14).
4. **Availability.** Airplane mode, or the broker going down, freezes everything. The SA-1 watchdog node is the "feed the dog" timer from s24.
5. **STRIDE.** As a class, fill in one threat per letter for this system:
   - **Spoofing:** a fake alert.
   - **Tampering:** fake readings.
   - **Repudiation:** no log of who sent the alert, and no student IDs by design.
   - **Information disclosure:** readable motion data.
   - **Denial of service:** flooding the broker.
   - **Elevation of privilege:** the shared password gives everyone write access.

**Students see / produce**
- A completed STRIDE table for the Shake Alarm, with a mitigation per row.
- A first-hand experience of being spoofed.

**Concepts:**
- the CIA triad
- authentication vs authorization
- shared vs per-device credentials
- spoofing and false data injection
- replay and freshness
- sensor fusion
- privacy and sensor side channels
- watchdogs
- STRIDE threat modelling

---

## Coverage by deck

| Deck | Activities | Depth |
|---|---|---|
| 1.1 Foundations of CPS and IoT | SA-1, SA-2, SA-4 | Strong |
| 1.3 CPS-IoT Architecture | SA-1 | Medium |
| 1. Databases | SA-6 | Strong |
| 2. Data Analytics-I | SA-6 | Medium |
| 2.1 Design Methodology-I | SA-3, SA-4 | Strong |
| 2.2 Design Methodology-II | SA-5 | Strong |
| 2.3 Deployment Levels | SA-2, SA-3 | Strong (Levels 1, 3, 4 and 6) |
| 3. Data Analytics-II | SA-1, SA-6 | Strong |
| 4. Data Analytics Demo (Orange) | SA-6 | Strong |
| 3.1 Communication Models | SA-1, SA-2, SA-7 | Strong |
| 3.1 Application Layer | SA-7, SA-8 | Strong |
| 3.2 Protocols | SA-7 | Light |
| 3.2 MQTT | SA-1, SA-7 | Strong |
| 3.3 Communication APIs | SA-7 | Medium |
| 3.3.1 Network Layer | SA-7 | Light |
| 3.4 TCP/UDP | SA-7 | Medium (TCP and TLS) |
| 5.1 Mirai | SA-8 | Light |
| 5.2 Security Introduction | SA-1, SA-8 | Strong |
| 5.3 Edge Security | SA-8 | Medium |
| 5.4 Communication Security | SA-8 | Medium |

**Not covered:** 1.2 CPS Demo, the CPS Assignment, 3.2 Zigbee, 3.3 Bluetooth, the 3.4 Bluetooth demo, and the 2.4 Deployment lab.

**What it doesn't teach well:**
- **Physical actuation:** the only actuator is a screen.
- **Embedded real-time control.**
- **Mesh networks:** Zigbee, Bluetooth, 6LoWPAN, RPL.

The **Freenove car** covers the first two. Together they split the course: **the phone covers IoT, networking, data and security; the car covers the physical CPS side.**

---

## Test results (Phase 1)

Run on 2026-11-04 on the TA's Mac: local Mosquitto 2.1.2 with logins, Node-RED 5.0.9, Dashboard 2.0 v1.35.0, and Chrome 156 headless as the "phone". Everything is real except the motion sensor, which is simulated with the page's "Simulate a shake" path. The round trips are on one machine, so they're near zero; cloud round trips are measured in Phase 2.

**Browser end-to-end test** (`tools/e2e.mjs`): **16/16 checks passed**, including while 29 simulated students loaded the same broker and console. The checks:
- the broker rejects a wrong password and accepts the right one;
- pairing works from both sides, and the laptop shows "Receiving readings";
- the phone shows "Laptop: Connected" and "All calm", then "Shake detected!" after a shake, then "All calm" again;
- round trip is measured;
- "This phone" mode decides locally, and "Class console" mode lets the console decide;
- the console doesn't see a phone until sharing is on;
- instructor messages reach sharing phones;
- two phones with the same pairing name both get warned;
- no errors in the page.

**30-student simulation** (`tools/sim.mjs`: 30 phones over WebSocket + 30 laptops over MQTT + the real console, 90 s, run twice):

| Measure | Result |
|---|---|
| Readings lost | 0 of 13,380 |
| Shakes detected | 290 of 290 |
| False alarms | 0 |
| Earthquake alert | reached 30 of 30 phones, about 1.3 s after the class started shaking |
| False earthquakes | 0 (after tightening the rule; the first version had them) |
| Data published | about 54 MB per 30 minutes, before the broker's copies |

**Bugs the tests caught and fixed:**
- **A phone that started while all was calm showed "Waiting" until the first shake,** because the filter node only sends changes. Fixed: the laptop's heartbeat carries its last decision.
- **The earthquake rule fired from random overlapping shakes.** Fixed: a phone counts only if it shook in the last second, at least half the phones are needed, and the shaking must last a full second.
- **Clicking Deploy left a paired laptop disconnected** (found in the first real-phone test, 2026-11-04). The laptop connects only after pairing, and a deploy drops the connection. Fixed: after every deploy the flow re-pairs with the same name automatically.
- **Node.js's built-in time-zone data is older than macOS's.** This Mac reports BC time as MST (permanent UTC-7) while Node 25 still uses PST, so any clock time Node-RED formats is an hour off. Fixed: the flows don't show server-side clock times; dashboard charts use the browser's clock.

**Not tested yet** (update: real phones, cloud broker, Pages and cloud round trips were tested in Phase 2; see the Phases table):
- real phone sensors (iPhone permission prompt, Android);
- ~~the cloud broker~~ (done: EMQX, see above);
- GitHub Pages hosting;
- real cloud round trips;
- the default threshold on real shakes;
- Windows laptops.

---

## Build plan

| Item | Who | Status |
|---|---|---|
| Phone page (pairing, password, permission, wake lock, status in words, simulate-a-shake, round trip, Last Will, name-clash warning, share toggle, three decision modes, auto-pause) | Claude | Done |
| Student starter flow + solution flow, generated from one script | Claude | Done |
| Class Console (table, fleet chart, earthquake detector, decides for "Class console" phones, messages to phones) | Claude | Done |
| Local broker script, unit tests, browser end-to-end test, 30-student simulation | Claude | Done |
| EMQX deployment, two logins, two deny rules | TA | Done 2026-11-04 (checked with `npm run broker-check`) |
| Publish the repo on GitHub and turn on Pages | TA, with Claude | Phase 2 |
| Test on one iPhone and one Android; tune the default threshold; fix-up round | TA, with Claude | Phase 2 |
| Lecture add-ons: Acknowledge (SA-5), labelled recording to CSV (SA-6), latency histogram (SA-4) | Claude | Phase 4 |
| Setup handout, student guide, QR slide, worksheets, run sheets | Claude, reviewed by TA | Phase 5 |
| Lecture-room network test and rehearsal | TA | Before first use |

**Per-term maintenance (about 1–2 h):**
- Change both passwords.
- Confirm the EMQX free tier and its limits haven't changed, and run `npm run broker-check`.
- Test the page on current iOS and Android.
- Run the end-to-end test and simulation against current Node-RED and Dashboard 2.0.
- Repeat the room test.

---

## Risks and fallbacks

| Risk | Fallback |
|---|---|
| Cloud broker down or quota used up in class | Change `host` in `class-broker.json` to a public broker, rebuild, re-import. Data is then public, so say so. A second free EMQX deployment is allowed per account as a standby. |
| A phone's sensors don't work (old phone, wrong browser, permission denied) | The page switches to "Simulate a shake" automatically; or pair with a neighbour |
| Student's Node-RED won't start | Pair with a classmate; SA-0 should catch most of these a week earlier |
| Lecture-room Wi-Fi blocks port 8883 | Phones use mobile data. Node-RED can connect through the WebSocket port 8884 instead (`wss://<host>:8884/mqtt`). |
| Phone locks or the student switches apps | The page keeps the screen awake but browsers pause background tabs. Keep the page in the foreground. |
| Two students pick the same pairing name | Both phones show a warning; one picks a new name |
| Students' Node-RED is reachable from the campus Wi-Fi (Node-RED's default), so anyone nearby could open the editor and run code on their laptop | The setup handout (Phase 5) tells students to set `uiHost: "127.0.0.1"` in settings.js, as the demo setup does. It's also a good SA-8 talking point: an exposed admin page is how Mirai-style attacks start. |
| Someone misuses the class password (spoofing pairs, flooding, using up the 1 GB) | Change the password; check usage in the EMQX console. Console topics are already protected by deny rules. |
| Free plan limits change | Check each term. A paid plan or a self-hosted broker are the alternatives. |
| Privacy concerns | No student IDs, motion data only, never location, private by default, sharing is opt-in and sends only the shake level, and nothing is retained on the broker |
