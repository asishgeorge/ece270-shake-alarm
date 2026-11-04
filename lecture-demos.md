# Shake Alarm: lecture demos

What the Shake Alarm can teach in ECE 270 lectures, and how to show each idea in 5–15 minutes.

**Who this is for:** the instructor and TAs delivering the lectures.

**Students need only their phone.** No installs, no programming, no git, no Node-RED. The instructor's laptop does everything on the computer side, on the projector. Students open a web page, type a name and the class password, and shake.

How to set up the demo laptop: [README.md](README.md). The full teaching plan, with slide-by-slide mapping and test results: [phone-shake-alarm.md](phone-shake-alarm.md).

---

## The system in one picture

```
 STUDENT'S PHONE                    CLASS BROKER                 INSTRUCTOR'S LAPTOP (projector)
 web page reads the motion  ──►    EMQX Cloud: passes   ──►    Node-RED: computes the shake level,
 sensor, 5 times a second           messages along,             shows a gauge and chart, decides
                                    checks passwords            ALERT or OK
 screen says "All calm" or  ◄──                         ◄──    sends the decision back
 "Shake detected!"
```

**In CPS terms:**

| Part of the course's feedback loop | In the Shake Alarm |
|---|---|
| Sensor | The phone's accelerometer |
| Network | Wi-Fi or mobile data, then the internet, then the broker |
| Controller | Node-RED on the laptop, or the phone itself |
| Actuator | The words on the phone's screen |
| Human in the loop | The person shaking, who stops when the screen says so |

**Words to introduce before the first demo.** Each has a Python comparison students can hold on to:

| Word | Plain meaning | Python comparison |
|---|---|---|
| **MQTT** | A messaging system for IoT devices | Like sending a message to a named channel |
| **Broker** | The server that receives every message and forwards it to whoever asked for it | A post office |
| **Topic** | The address a message is sent to, e.g. `ece270/pair/calm-otter-42/phone` | A key in a dictionary |
| **Publish / subscribe** | Send to a topic / ask to receive a topic | `post(topic, msg)` / "notify me about topic" |
| **JSON** | How a reading is written: `{"ax": 0.1, "ay": 9.8, "az": 0.2}` | A Python dictionary |
| **Node-RED** | A visual tool: boxes (nodes) joined by wires; a message flows along the wires | A program drawn as a flowchart |
| **Function node** | A box containing a few lines of code | A Python function |

---

## Before the lecture (10 minutes)

1. On the laptop, run `local/node-red.sh restart`. This gives a clean dashboard.
2. Open two browser tabs for the projector:
   - **Student dashboard:** http://127.0.0.1:1880/dashboard/shake
   - **Class Console:** http://127.0.0.1:1880/dashboard/console
3. Put a slide up with:
   - the phone page link as text and a QR code: https://asishgeorge.github.io/ece270-shake-alarm/
   - the class password.
4. Pair your own phone with the student dashboard, to check everything works.
5. **First time in a new room:** have a TA open the page on mobile data and on the room's Wi-Fi.

**Telling students how to join (2 minutes):**
1. Open the link in Safari or Chrome.
2. Keep the suggested pairing name. **Don't use your name or student number.**
3. Type the class password and tap **Start**. iPhones ask to allow motion access: tap Allow.
4. Keep the page open and in front.

For most demos, students then open **Class options** on the page and choose one of:
- **Share my shake level with the class console:** puts them on the projector.
- **Who decides the alarm:** *This phone* or *Class console*. Neither needs a laptop.

---

## The demos

Each demo lists the slides it supports, what students do, the steps, what to point out, and questions for the class with expected answers.

### Demo 1. Your phone is a cyber-physical system

**Slides:** 1.1 Foundations s5–7 (the CPS loop); 1.2 CPS Demo (the thermostat); 1.3 Architecture s4–5 (layers, data up and commands down)
**Students:** watch (or follow along with *Who decides → This phone*)
**Time:** 5–10 min

**Steps:**
1. Pair your phone with the student dashboard (type its pairing name, press Enter).
2. Hold the phone still. The gauge is near 0 and the phone says "All calm".
3. Shake it. The gauge and chart jump, and the phone says **"Shake detected!"**
4. Stop. A second later, "All calm".

**Point out:**
- Map it onto slide s6: the sensor is the accelerometer, the computation is Node-RED, the actuator is the screen's words.
- Unlike the thermostat, **a person closes the loop**: they stop shaking because the screen told them to.
- It's a **networked** CPS (1.1 s9): sensor and controller are on different devices, joined by the internet.
- **Monitoring and control** (1.3 s5): readings flow *up* to the dashboard, and the decision flows back *down* to the phone.

**Ask the class:**
- *"Where is the physical process here?"* The motion of the phone in your hand.
- *"What would happen if the network were slow?"* The warning would arrive late; that's Demo 4.

### Demo 2. From raw sensor numbers to a decision

**Slides:** 3. Data Analytics-II s14–17 (feature engineering), s28 (anomaly detection); 2.1 s8–10 (requirements)
**Students:** watch
**Time:** 10 min

**Steps:**
1. In the Node-RED editor (http://127.0.0.1:1880), double-click the **shake level** node. It holds four lines, compared here with Python:
   ```js
   const { ax, ay, az } = msg.payload;              // Python: ax, ay, az = msg["ax"], msg["ay"], msg["az"]
   const g = Math.sqrt(ax*ax + ay*ay + az*az);      // Python: g = math.sqrt(ax**2 + ay**2 + az**2)
   msg.payload = +Math.abs(g - 9.81).toFixed(2);    // Python: shake = round(abs(g - 9.81), 2)
   return msg;                                      // Python: return shake
   ```
2. Explain:
   - The phone measures acceleration on 3 axes, gravity included, so a still phone reads 9.81 m/s² in total.
   - Subtracting gravity leaves the **shake level**. That one number is a **feature** made from three raw values.
3. On the dashboard, move the **Alarm threshold** slider:
   - **To 1:** walking or even breathing triggers it, so constant **false alarms**.
   - **To 20:** gentle shakes are **missed**.

**Point out:**
- **A threshold is the simplest anomaly detector.** Choosing it is a trade-off between false alarms and misses, the same trade-off as in the Orange anomaly-detection demo.
- **Real phones measured** about 0 when still, 15–27 when shaken, and over 90 for a hard knock. The default threshold of 6 sits well between still and shaking. Walking hasn't been measured yet; try it live.

**Ask the class:**
- *"Why not just use `az`, the vertical axis?"* Because then it depends on how you hold the phone. The total size of the acceleration doesn't.
- *"Write the requirement for the threshold in the slides' format."* For example: REQ-F: alert when the shake level exceeds 6 m/s².

### Demo 3. Publish and subscribe: how messages find the right laptop

**Slides:** 3.1 Communication Models s8–11 (publish-subscribe), s4–7 (request-response); 3.2 MQTT s14–18; 3.1 Application Layer s10 (data formatting)
**Students:** join with their phones and tick **Share**
**Time:** 10 min

**Steps:**
1. Show the topic names on the projector:
   - The phone sends to `ece270/pair/<its name>/phone`.
   - The laptop subscribes to that topic and answers on `ece270/pair/<name>/cmd`.
2. Ask everyone to tick **Share**. The **Class Console** fills up with pairing names, each a line on the chart.
3. Explain that each phone now publishes a second, smaller message to `ece270/class/phones/<name>`. The console subscribes to `ece270/class/phones/+`, where `+` means "any name here".
4. *Optional, with a free MQTT app such as MQTTX:* connect with the instructor login and subscribe to `ece270/class/phones/+`. The raw JSON messages scroll past live.

**Point out:**
- **Nobody connects to anybody directly.** Phones and laptops only talk to the broker, so 30 phones and the console can all run at once.
- **The pairing name is part of the topic.** That's how your readings reach your laptop and nobody else's.
- **Messages are JSON**, which is just a Python dictionary written as text.

**Ask the class:**
- *"The console didn't see your phone until you ticked Share. Why?"* It isn't subscribed to your private topic, only to the shared one.
- *"Request-response or publish-subscribe for this? Why?"* Publish-subscribe: the phone doesn't know who is listening, or how many.

### Demo 4. Edge vs cloud: where should the decision be made?

**Slides:** 2.3 Deployment Levels s10–22 (Level 1), s29–34 (Level 3); 2.1 s10 (NF-02: safety logic runs locally); 1.1 s24–25 (reflexes vs cloud, "Black Ice"); 3.1 Communication Models s33–36 (edge, fog, cloud)
**Students:** all, phones only
**Time:** 10 min

**Steps:**
1. Half the room sets **Who decides → This phone**. The other half sets **Class console**, which needs Share on.
2. Everyone shakes. "This phone" reacts at once. "Class console" reacts after a short delay, and the phone shows the **round trip** in ms (typically about 200–400 ms).
3. Everyone turns on **airplane mode** and shakes again. Only "This phone" still works.

**Point out:**
- "This phone" is **Level 1**: everything happens on the device.
- "Class console" is **Level 3** (cloud analysis). It's slower and depends on the network.
- This is exactly why slide 2.1's NF-02 says safety logic must run locally.

**Ask the class:**
- *"A fall detector for an elderly person: Level 1 or Level 3?"* Level 1 for the alarm itself; send the event to the cloud afterwards.
- *"A step counter's monthly report?"* The cloud is fine; nothing is urgent.

### Demo 5. Latency, jitter and a measurable requirement

**Slides:** 2.1 Design Methodology-I s8–10 (non-functional requirements), s12–16 (traceability matrix); 1.1 s16–17 (jitter, "Phantom Lag")
**Students:** all, with Share on and *Who decides → Class console*
**Time:** 10 min

**Steps:**
1. Write a requirement on the board: **REQ-NF-01: the alert must reach the phone within 500 ms.**
2. Everyone shakes and reads their **Round trip** value on the phone.
3. The console's **Now** line shows the class **median** and **90th percentile**.
4. Fill in a traceability-matrix row on the board: test, measured value, PASS or FAIL.

**Point out:**
- The values differ from phone to phone and from shake to shake. That variation is **jitter**.
- Phones on weak Wi-Fi or mobile data are slower.
- A requirement has to hold in the **worst** case, not on average.

**Ask the class:**
- *"Most phones pass, a few fail. Is the requirement wrong or the design?"* Discuss: either relax it, or move the decision to the edge (Demo 4).

### Demo 6. The class earthquake detector

**Slides:** 2.3 s35–40 (Level 4, observers), s47–51 (Level 6, cloud control); 1.1 s25 ("Black Ice": collective intelligence); 3.1 Communication Models s26–27 (broadcast)
**Students:** all, with Share on
**Time:** 5–10 min

**Steps:**
1. **One student shakes:** nothing happens. "Someone dropped their phone."
2. **Everyone shakes together** for about 2 seconds. Every sharing phone shows **"Earthquake! 27 of 30 phones shook at the same time."**, and the console shows a pop-up.

**Point out:**
- **No single phone can tell a dropped phone from an earthquake. Only the cloud, seeing many devices, can.** That's the "Black Ice" slide: the cloud spots a pattern across vehicles and warns the others.
- **Android phones do this for real** with their earthquake alerts, and Victoria is in an earthquake zone.
- The detector needs **at least half the sharing phones shaking together for a full second**. An earlier, looser rule fired from random overlapping shakes, which is a real false-positive problem.

**Ask the class:**
- *"What deployment level is this?"* Level 6: independent devices, central cloud analysis.
- *"Why not let each phone decide 'earthquake' by itself?"* It can't see the others.

### Demo 7. Availability: what happens when a device goes quiet?

**Slides:** 5.2 Security Introduction s20–25 (availability, watchdog "feed the dog"); 3.2 MQTT s17 (keepalive)
**Students:** watch (one volunteer)
**Time:** 5 min

**Steps:**
1. With your paired phone, lock the screen or switch apps.
   - Within 3 seconds the dashboard's **Phone** line changes to "No readings for N s".
   - About 15 seconds later it changes to "Your phone went offline".
2. Turn on airplane mode: the same happens.

**Point out:**
- **The laptop notices silence.** That's a **watchdog**: if the device stops "feeding" it, the system assumes a fault.
- **"Went offline" comes from the broker, not the phone.** The broker noticed the phone's keepalive messages had stopped and delivered the phone's pre-arranged "last will" message.

**Ask the class:**
- *"A fall detector loses its connection. What should it do?"* Alarm locally, and keep retrying.

### Demo 8. Security: who is allowed to send what?

**Slides:**
- 3.1 Application Layer s16–21 (identity, authentication, authorisation, integrity)
- 5.2 s26–33 (threat modelling, STRIDE)
- 5.4 Communication Security s21–24 (Tier 4: cloud)
- 5.1 Mirai s14 (hard-coded passwords)
- 5.3 s27–29 (false data injection)

**Students:** watch
**Time:** 10–15 min
**Needs:** a free MQTT app such as MQTTX on the laptop

**Steps:**
1. **Authentication.** Connect MQTTX with a wrong password: refused. With the student password: connected.
2. **Authorisation.** While logged in as `student`, try to publish `{"level":"info","text":"Hello class"}` to `ece270/class/broadcast`.
   - The broker refuses it, and no phone shows it. Set MQTTX to MQTT 5 so it displays the broker's **"Not authorized"** reply.
   - Then log in as `instructor` and publish the same message: it appears on every sharing phone.
3. **Spoofing.**
   - Pair your demo phone with the dashboard.
   - From MQTTX, logged in as `student`, publish `{"cmd":"ALERT"}` to `ece270/pair/<your phone's name>/cmd`.
   - The phone says **"Shake detected!"** though nobody shook it.
   - It stays that way until the next real shake, because the laptop only sends changes.
   - Its round-trip time doesn't update, because the fake message doesn't carry one of the phone's own timestamps. That's a clue for detecting forgeries.
   - **False data injection** (5.3 s27–29): publish `{"ax":0,"ay":30,"az":0,"t":0}` to `ece270/pair/<name>/phone`. The dashboard gauge jumps and the laptop raises an alarm for a shake that never happened.
4. **Discussion:**
   - Everyone shares one student password, so anyone who knows (or guesses) your pairing name could do step 3.
   - The fix is a separate login per device, as the Mirai story shows.

**Point out:**
- **The design choices:**
  - no student IDs anywhere;
  - sharing with the class is **opt-in**, and sends only the shake level, never the raw readings;
  - the password is typed in, never built into the page;
  - nothing is stored on the broker.
- **Privacy.** Phones ask permission for motion sensors because motion data can reveal surprising things, like what you are typing.

**Ask the class:** fill in one **STRIDE** threat per letter for this system:
- **Spoofing:** a fake ALERT.
- **Tampering:** fake readings.
- **Repudiation:** no log of who sent what.
- **Information disclosure:** readable motion data.
- **Denial of service:** flooding the broker or using up its free quota.
- **Elevation of privilege:** the shared password.

### Demo 9. Why the web page needs HTTPS, WebSockets and TLS

**Slides:** 3.3 Communication APIs s18–24 (WebSocket vs REST); 3.4 TCP/UDP s13–17 (TCP), s23–28 (TLS); 3.3.1 Network Layer s45 (gateway)
**Students:** watch
**Time:** 5–10 min

**Points to make, using the page they already have open:**
- **HTTPS:** the address starts with **https://**. Phones only share motion sensors with secure pages.
- **WebSockets:** a web page can't open a plain MQTT connection, so the phone runs MQTT inside a **WebSocket** (port 8084). It's one long-lived connection rather than a new request 5 times a second, which is the REST vs WebSocket slide.
- **TLS:** every connection to the broker is encrypted (ports 8883 and 8084).
- **Gateways:** the phone on mobile data and the laptop on campus Wi-Fi can't reach each other directly, because each sits behind its own gateway. Both connect **out** to the broker. That's why IoT systems use brokers.

**Ask the class:**
- *"Why can a phone on mobile data talk to a laptop on campus Wi-Fi at all?"* Both connect outwards to the same broker on the internet.

### Demo 10. A small change, big effect (optional live edit)

**Slides:** any of the above
**Students:** watch, or one volunteer edits on the projector
**Time:** 5 min each

Each of these is **one small change** to the working flow in the editor, followed by Deploy. No new nodes, no programming beyond changing a number or a word.

| Change | Where | What students see | Concept |
|---|---|---|---|
| Set the start-up threshold to 15 instead of 6 | The **start-up threshold** node: change the number | Only hard shakes alert | Requirements, tuning |
| Use only the vertical axis: change `ax*ax + ay*ay + az*az` to `az*az` | **shake level** function | Result depends on how you hold the phone | Feature choice |
| Switch off the **only send changes** filter (disconnect its wire and connect around it) | the wires | The laptop sends 5 messages a second instead of one per change | Events vs telemetry; network load |
| Change the gauge's maximum from 30 to 100 | the **gauge** node | Normal shakes look tiny | Choosing a display range |

---

## What students need to know

**Before:** nothing beyond lecture content. Python basics help for Demo 2 and Demo 10, where the code is compared line by line with Python.

**After:** they should be able to answer:
1. What are the sensor, controller, actuator and network in the Shake Alarm?
2. What is a topic, and why does every phone use a different one?
3. Why does "This phone" react faster and keep working in airplane mode?
4. What is jitter, and why must a requirement hold in the worst case?
5. Why can only the cloud detect the "earthquake"?
6. What could someone with the class password do, and what stops them posting console messages?

## Coverage

| Deck | Demos |
|---|---|
| 1.1 Foundations of CPS and IoT | 1, 4, 5, 6 |
| 1.2 CPS Demo | 1 |
| 1.3 CPS-IoT Architecture | 1 |
| 2.1 Design Methodology-I | 2, 4, 5 |
| 2.3 Deployment Levels | 4, 6 |
| 3. Data Analytics-II | 2 |
| 3.1 Communication Models | 3, 4, 6 |
| 3.1 Application Layer | 3, 8 |
| 3.2 MQTT | 3, 7 |
| 3.3 Communication APIs | 9 |
| 3.3.1 Network Layer | 9 |
| 3.4 TCP/UDP | 9 |
| 5.1 Mirai | 8 |
| 5.2 Security Introduction | 7, 8 |
| 5.3 Edge Security | 8 |
| 5.4 Communication Security | 8 |

**Not built yet, planned as add-ons:**
- recording labelled movements for the Databases and Orange decks;
- an Acknowledge button for the state-chart deck (2.2).
