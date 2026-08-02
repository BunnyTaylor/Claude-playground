# Build Brief: Bulk-Bin Auto Pill Dispenser

**Audience:** Claude Code (agentic build assistant)
**Author:** Prepared for a maker with 3D-printing + soldering ability, targeting 4–6 medications.
**Deliverable:** A working automatic pill dispenser that stores each medication in bulk (loose, in a hopper) and singulates (drops exactly one pill at a time) on a schedule, into a shared cup. No pre-filled pods.

---

## 0. Read this first — the one design decision that defines the project

The hard part of this device is **singulation**: reliably releasing *exactly one* pill from a pile of loose pills. Everything else (scheduling, UI, WiFi, alerts) is comparatively trivial and mostly already solved by the base project below.

We are deliberately choosing an architecture that **sidesteps mixed-pill singulation**: one bin per medication, each with its own dedicated singulation mechanism and its own actuator. To dispense a dose, we trigger the relevant bins N times each and let all pills fall into one shared cup. This turns one very hard problem into 4–6 copies of a much easier, individually-tunable problem.

**Do not** attempt a single shared mechanism that sorts multiple pill types. That is the pharmacy-robot problem and is out of scope.

---

## 1. Base projects to build on

### Primary base (fork this): `Shaztech/Pilldispenser`
- URL: https://github.com/Shaztech/Pilldispenser
- License: check the repo before redistributing; for personal use this is fine.
- Why: it already provides, in a mature form (182★, 9 releases, actively maintained into 2026), **exactly the electronics + firmware stack we want**, and only its *mechanical dispensing method* is wrong for us.

**What the base already gives us (KEEP / REUSE):**
- ESP32 "CYD" (Cheap Yellow Display, model `ESP32-2432S028`): 320×240 resistive touchscreen dev board. ~$14. This is the brain + UI.
- **PCA9685 16-channel PWM servo driver** on the base PCB — this is the key reuse. It can drive up to 16 servos from the ESP32 over I²C. Our 4–6 bins each need one actuator → trivially within 16 channels.
- Firmware written in C/C++ (ESP-IDF / Arduino) with:
  - WiFi config on-screen
  - NTP time sync, UTC/DST handling
  - Touchscreen UI (LVGL, designed in SquareLine Studio — project files included)
  - Web portal for configuration (browser-based)
  - Audio alarms via DFPlayer Mini + speaker (MP3 on SD card)
  - WS2812B addressable LED status indication
  - Telegram integration + Home Assistant integration (community add-on)
  - OTA firmware update via the web portal
- PCB Gerbers (base, LED, tray) ready for JLCPCB/PCBWay.
- Firmware flashing procedure via `esptool` documented in the README.

**What we REPLACE:**
- The `A7–A16` "Tray" mechanism — a 30-section **rotating carousel you fill by hand**. This is a pod system and is the exact thing the user wants to avoid. We rip out the tray and substitute a **bulk hopper + singulation disc** per bin (see §4).
- The firmware's notion of a "tray with 30 sections and a remaining-count label" changes to "a bin with a bulk pill count and a per-pill dispense action." The scheduler, clock, UI, web portal, and alerting logic stay largely intact — we're changing what happens when a scheduled dose fires, not how scheduling works.

### Secondary reference (read, don't fork): `WissamAntoun/SMD`
- URL: https://github.com/WissamAntoun/SMD
- Why: its architecture is the one we're adopting — **separate container per pill type, a servo/stepper rotates a cylinder to release pills**. Use it as a reference implementation for the "rotating-pocket singulator driven by one motor per bin" concept. Do not adopt its app/Bluetooth stack; the Shaztech ESP32 web/touch stack is better.

### Optional reference for mechanism ideas
- `vtlanglois/MedicineDispenser` (servo + IR/ultrasonic drop detection) — useful only for the **drop-detection sensor** pattern, which we need for verification (see §5).

---

## 2. Success criteria (definition of done)

1. User can define 4–6 medications in the UI/web portal, each mapped to a physical bin.
2. For each medication, user sets a schedule (times per day, days of week, pills per dose).
3. At each scheduled time, the device singulates the correct number of pills from each relevant bin into the shared cup, and signals the user (light + sound).
4. **Every pill drop is verified by a sensor.** If the expected count doesn't drop (jam) or too many drop (double-drop), the device halts that bin, does NOT silently continue, and raises a clearly-distinguishable alert.
5. Low-pill and empty-bin warnings.
6. Missed-dose alerting (reuse base project's mechanism).
7. All of the above survives a power cycle (schedule + pill counts persisted to flash/SD).

---

## 3. Build in phases (recommended execution order for Claude Code)

Work in this order. Do **not** design the PCB until the breadboard + firmware behavior is proven, and do **not** finalize 3D mechanical parts until singulation is tuned on a test rig.

### Phase A — Firmware skeleton on breadboard, no mechanics
- Fork Shaztech base. Get it compiling and flashing to a bare ESP32-CYD.
- Strip/stub the carousel-tray logic. Introduce a clean abstraction:
  - `Bin` = { id, medication name, pills_remaining, pills_per_pocket (usually 1), servo_channel, sensor_pin }
  - `dispense(bin, count)` = repeat `singulate_one(bin)` `count` times, each confirmed by sensor.
- Wire ONE servo via the PCA9685 breakout (Adafruit-style, I²C) + ONE IR break-beam sensor on a breadboard. Prove: UI button → servo does one "singulation stroke" → sensor confirms a (dummy bead/pill) drop → count decrements.

### Phase B — Scheduling + multi-bin
- Restore/adapt the scheduler, NTP, persistence, alarms, web portal from the base for the new `Bin` model.
- Scale to 4–6 servos + 4–6 sensors on the breadboard.
- Implement jam/double-drop handling and all alerts from §2.

### Phase C — Mechanical singulation test rig
- 3D-print ONE singulation module (see §4). Tune pocket geometry against real pills. Iterate STL.
- Validate reliability target: **≥ 200 consecutive correct single-drops** per pill type before trusting it.

### Phase D — Full mechanical assembly
- Replicate the proven module ×(number of bins). Modify/design the base structure to hold N hoppers over a shared chute → cup.

### Phase E — PCB
- Only now, design a custom PCB (or adapt Shaztech's base PCB) to replace the breadboard: ESP32-CYD headers, PCA9685, sensor inputs, servo/stepper headers, power. Export Gerbers for JLCPCB/PCBWay.

---

## 4. The singulation mechanism (mechanical spec)

**Chosen mechanism: rotating pocket disc (a.k.a. "star wheel" / indexing disc).**

Concept: at the bottom of each bulk hopper sits a horizontal (or slightly inclined) disc with one or more pockets cut into its edge/face, each pocket sized to hold **exactly one pill** of that medication. A servo (or small stepper) rotates the disc; as a pocket passes under the hopper it scoops one pill, and as it continues, the pocket aligns with a drop-hole and the pill falls into the chute. One "stroke" = one pill.

Design requirements for Claude Code to encode in the CAD (parametric — this is essential):
- **Parametric pocket dimensions** (diameter/length/depth) exposed as top-level variables, because they must be re-tuned per pill. Use OpenSCAD or parametric Fusion/FreeCAD so a pill's dimensions regenerate the disc.
- Pocket depth ≈ one pill thickness, so a second pill can't stack on top and ride along. A fixed **wiper/scraper** lip over the disc knocks back any pill not seated in a pocket.
- Anti-jam: chamfered pocket edges; the hopper floor funnels pills toward the disc; avoid sharp corners where capsules wedge.
- Because pill shapes vary wildly, generate a **starter set** of disc variants per bin (e.g., round-tablet, oblong-capsule, small-tablet) and let the builder pick/tune.
- **Split (half) pills are explicitly unsupported** — even commercial units (MedaCube) refuse them. If the user needs a half-dose, document that they must buy the correct strength or pre-split into a bin knowing reliability drops. Flag this in the UI.

Actuator choice:
- Start with the base project's **SG90 servo** (already supported by PCA9685 + existing cam code) for drop-in compatibility. A servo sweeping a fixed arc gives one pocket-index per stroke.
- If single-pill indexing proves unreliable with a servo, switch that bin to a **28BYJ-48 stepper + ULN2003 driver** for precise, repeatable indexing. Design the firmware `Actuator` interface to allow either per-bin (servo vs stepper) so mixing is possible.

Hopper:
- Simple printed funnel-hopper per bin, removable for refilling ("fill the bin" UX the user wants), with a lid to keep pills clean/dry.
- Clear or windowed wall so remaining pills are visible; pair with the firmware count for low-pill alerts.

---

## 5. Drop verification (do not skip — safety critical)

Each bin needs a sensor at the drop chute to confirm a pill actually fell:
- **Primary option:** IR break-beam (emitter + phototransistor) across the chute. Cheap, reliable for opaque pills. One pill = one beam-break pulse; count pulses to detect 0 (jam) or ≥2 (double-drop).
- **Alt option:** a small load cell (HX711) under the cup to confirm mass increase per dose — good as a whole-dose cross-check.
- Firmware must: expect exactly `count` pulses within a timeout window; on mismatch, stop that bin, mark the dose incomplete, and raise a distinct alert (different sound/LED from a normal reminder). Never advance the pill-remaining count for pills that weren't sensed.

---

## 6. Electronics — breadboard BOM (Phase A/B)

| Qty | Part | Notes |
|----:|------|-------|
| 1 | ESP32-2432S028 "CYD" | Brain + 2.8" touchscreen UI (from base project) |
| 1 | PCA9685 16-ch PWM breakout (I²C) | Drives all servos; base project already supports it |
| 4–6 | SG90 servo | One per bin; start here |
| (opt) | 28BYJ-48 stepper + ULN2003 | Per-bin upgrade if servo indexing is unreliable |
| 4–6 | IR break-beam sensor pair | Drop verification, one per chute |
| 1 | DFPlayer Mini + microSD + 8Ω speaker | Audio alarms (from base) |
| 1 | WS2812B LED(s) | Status indication (from base) |
| 1 | 5V power supply, ≥3A | Servos are the current draw; do NOT power servos from the ESP32's regulator |
| — | Breadboard, jumpers, common-ground wiring, bulk 1000µF cap across servo 5V rail | Standard |

Rough parts cost: **~$60–120** for a 4–6 bin breadboard build, plus filament.

Power note for Claude Code to enforce in docs: servos and ESP32 share **ground** but servos get their own 5V rail; add a bulk capacitor on the servo rail to absorb stall spikes.

---

## 7. PCB (Phase E)

Two acceptable paths — recommend the first:
1. **Adapt Shaztech's base PCB.** It already carries the PCA9685 + ESP32 headers + power. Modify it to (a) break out N servo/stepper headers, (b) add N sensor-input headers, (c) drop the tray-stacking connectors we no longer use. Re-export Gerbers.
2. **Design fresh** in KiCad: ESP32-CYD header footprint, PCA9685 (TSSOP-28) or reuse the breakout as a module, servo headers, sensor headers, 5V power in with bulk cap, I²C pull-ups. Output Gerbers + BOM + centroid for JLCPCB assembly.

Claude Code should produce: schematic, PCB layout, Gerber zip, and an assembly BOM. Keep SMD to 1206 where hand-soldering is desired (the base project uses 1206 + a couple of TSSOP/SOIC ICs).

---

## 8. 3D-printed structure (Phase C/D)

Reuse from base: overall base/enclosure aesthetic, LCD holder, speaker mount, USB mount — these are unaffected by the mechanism swap and save a lot of work.

Design new (parametric):
- `hopper.scad` — refillable bulk hopper with funnel floor + lid.
- `singulation_disc.scad` — the pocket disc, pocket dims as parameters (see §4).
- `disc_housing.scad` — holds disc + servo/stepper, has the scoop window under the hopper and the drop-hole to the chute, mounts the IR sensor.
- `manifold_chute.scad` — merges all N drop-holes into one chute feeding the shared cup.
- `frame.scad` / modified base — positions N hopper-modules above the manifold; sized for the chosen bin count.

Deliver STLs + the parametric source. Document print settings analogous to the base project (15% infill for structure, supports where noted). If Claude Code cannot directly edit the base's STL binaries, it should: (a) generate NEW parametric parts for everything mechanical, and (b) provide written, measured instructions for how the new modules bolt onto the retained base parts (hole positions, standoffs), rather than silently guessing at edits to opaque STLs.

---

## 9. Firmware architecture summary (target state)

```
main
├── net/         WiFi provisioning, NTP (from base)
├── ui/          LVGL screens (SquareLine) — adapt "tray" screens → "bin" screens
├── web/         config portal (from base) — bin definitions, schedules, counts
├── store/       persist bins + schedules + counts to flash/SD (survive power loss)
├── sched/       cron-like scheduler (from base) → fires dose events
├── dose/        NEW core: dispense(dose) → for each bin: singulate_one() × count,
│                each gated by sensor confirmation; jam/double-drop handling
├── hw/
│   ├── actuator.*   interface; ServoActuator (PCA9685) + StepperActuator (28BYJ-48)
│   ├── sensor.*     IR break-beam pulse counting per bin
│   ├── audio.*      DFPlayer alarms (from base)
│   └── leds.*       WS2812B status (from base)
└── alerts/      reminders, missed-dose, jam, low-pill, empty (extend base + Telegram)
```

Key behavioral rules to implement:
- A dose is **atomic per bin**: confirm each pill before decrementing count; on jam, abort the bin and alert — do not partially claim success.
- Never dispense the same scheduled dose twice across reboots (persist "dose fired" state).
- Max-dispense safety cap per bin per day (guards against runaway loops).
- Passcode/lock option for the dispense action (base supports this) if misuse is a concern.

---

## 10. Safety notes to surface to the human (must be in generated README)

- These DIY builds are **not child-proof or fully tamper-proof.** Do not place around small children. Add a locking lid if any risk.
- For medications where a wrong/double dose is dangerous (anticoagulants, cardiac meds, anything narrow-therapeutic-index), the drop-verification sensor is mandatory, and the builder should keep a manual backup pillbox and consider whether a proven commercial device is more appropriate for those specific pills.
- Keep a paper medication list and a manual backup supply. Automatic dispensers can fail on power loss, jams, or firmware bugs.
- This device does not replace pharmacist/physician guidance; it only automates timing/counting of already-correct prescriptions.

---

## 11. First tasks for Claude Code

1. Clone `Shaztech/Pilldispenser`; get the stock firmware building and flashing to an ESP32-CYD; confirm the toolchain (ESP-IDF/Arduino, LVGL, SquareLine export path).
2. Produce an architecture doc mapping the existing "tray" code paths to the new "bin" model (§9), listing exactly which files/functions to keep, modify, or delete.
3. Implement Phase A on breadboard: one servo (via PCA9685) + one IR break-beam → a UI/button-triggered single-singulation with sensor confirmation and count decrement.
4. Draft `singulation_disc.scad` parametric starter (round-tablet variant) and a matching `disc_housing.scad`.
5. Only after A is proven: proceed to Phases B→E per §3.

Report back after step 2 with the keep/modify/delete map before writing large amounts of new firmware.
