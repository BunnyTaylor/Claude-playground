# Architecture: mapping Shaztech's "tray" model → our "bin" model

**This is the report-back deliverable (brief §11, step 2).** It maps the existing
Shaztech firmware onto the bulk-bin model and says, per subsystem, whether to
**KEEP**, **MODIFY**, or **DELETE** it — *before* we write large amounts of new
firmware.

> **Grounding note.** Shaztech ships as one Arduino sketch (`Arduino/PillDispenser/`)
> plus `Arduino/libraries/` and a SquareLine-generated LVGL UI (`SquareLine Studio/`,
> exported into the sketch as `ui/` sources). The upstream sketch is largely a single
> large `.ino` with helper files rather than the clean module tree below. So this map
> is written at the **subsystem level** and, where it names a concrete artifact, marks
> it *(confirm exact filename in the fork)*. The first firmware task is to fork,
> compile stock, and pin these to real filenames.

---

## The one conceptual change

Everything flows from replacing the data model:

```
BEFORE (Shaztech):  Tray { 30 fixed sections, servo channel, "sections remaining" }
                    dispense = rotate carousel by one section to the drop opening

AFTER  (ours):      Bin  { id, med name, pills_remaining (bulk int),
                           pills_per_pocket (usually 1), actuator, sensor_pin,
                           per-day dispensed count, max-per-day cap }
                    dispense(bin, count) = repeat singulate_one(bin), each
                                           confirmed by the drop sensor
```

The **scheduler, clock, WiFi, web portal, audio, LEDs, OTA, and alerting stay**.
What changes is (a) the data model, (b) what a fired dose *does*, and (c) the tray
screens become bin screens. We are changing *what happens when a dose fires*, not
*how scheduling works*.

---

## Keep / Modify / Delete by subsystem

Target module tree (brief §9) shown alongside its Shaztech origin.

| Target module | Shaztech origin | Verdict | Notes |
|---------------|-----------------|---------|-------|
| `net/` (WiFi provisioning, NTP, UTC/DST) | WiFi + NTP code | **KEEP** | No mechanism dependency. Take as-is. |
| `hw/audio.*` (DFPlayer alarms) | DFPlayer Mini driver + SD audio | **KEEP** | Reuse; add one new distinct "jam/fault" clip. |
| `hw/leds.*` (WS2812B status) | WS2812B + 74AHCT125D driver | **KEEP** | Add jam/low/empty states to the LED state map. |
| OTA update via web portal | OTA path | **KEEP** | Untouched. |
| Telegram / Home Assistant | integrations | **KEEP → EXTEND** | Add jam / low-pill / empty / missed-dose events to the notification payloads. |
| `sched/` (cron-like scheduler) | tray scheduler | **MODIFY (light)** | Keep the cron firing engine. Change only the callback: a fired slot now calls `dose/dispense(dose)` against **bins**, not "advance tray N". |
| `store/` (persistence) | tray + count NVS/SD persistence | **MODIFY** | Persist the **Bin** struct (bulk `pills_remaining`, per-bin actuator type, per-day counters) and a **"dose fired" ledger** so a reboot never re-fires or double-fires a dose. |
| `web/` (config portal) | tray config pages | **MODIFY** | "30-section tray + remaining-sections" fields → "bin: med name, bulk count, schedule, pills/dose, actuator type, low-pill threshold." |
| `ui/` (LVGL / SquareLine screens) | tray screens ("30 sections", "sections remaining" label) | **MODIFY** | Re-skin tray screens as bin screens in SquareLine: bulk count + low/empty/jam indicators; add a "split pills unsupported" note. Re-export. |
| `alerts/` (reminder, missed-dose) | reminder + missed-dose logic | **MODIFY → EXTEND** | Keep reminders/missed-dose. **Add** jam, double-drop, low-pill, empty — each with a **distinct** sound+LED from a normal reminder (safety requirement, brief §2.4 / §5). |
| **`dose/`** (dispense engine) | — (tray had none; it just rotated) | **NEW** | Core new logic: `dispense(dose)` → for each bin `singulate_one()` × count, **each gated by sensor confirmation**; jam / double-drop handling; atomic-per-bin; decrement count only for *sensed* pills; max-per-day cap. |
| **`hw/actuator.*`** | servo cam/arm code (concept only) | **NEW (reuse PCA9685 layer)** | Define an `Actuator` interface. `ServoActuator` reuses Shaztech's PCA9685 driver (one channel per bin, sweep a fixed arc = one pocket index). `StepperActuator` (28BYJ-48 + ULN2003) is a per-bin upgrade. |
| **`hw/sensor.*`** | — (none; magnet was tray *position*, not drop) | **NEW** | IR break-beam per chute; count pulses in a timeout window; 0 pulses = jam, ≥2 = double-drop. This is genuinely new (no upstream drop sensing). |
| **Carousel / tray mechanism** | `A7–A16` "Tray" mechanism: 30-section carousel, cam+arm servo sweep, torsion/pen springs, magnet indexing | **DELETE** | The whole pod concept goes. Remove tray rotation, section indexing, magnet-position read, "sections remaining" model, and the hand-fill workflow. |
| Tray PCB stacking connectors | base/tray PCB tray headers | **DELETE (Phase E)** | Not needed once bins replace the tray. Drop from the adapted PCB (brief §7). |

### Summary
- **KEEP (as-is):** net/WiFi/NTP, audio, LEDs, OTA, base web/UI framework.
- **MODIFY:** scheduler callback, persistence (Bin + dose-fired ledger), web config,
  UI screens, alerts (extend with fault types).
- **NEW:** `dose/` engine, `hw/actuator.*` (over the kept PCA9685 layer), `hw/sensor.*`.
- **DELETE:** the entire 30-section carousel tray mechanism + its firmware notion,
  and (Phase E) the tray PCB connectors.

---

## Target module tree (restated for reference, brief §9)

```
main
├── net/         WiFi provisioning, NTP                      [KEEP]
├── ui/          LVGL screens — "tray" → "bin"               [MODIFY]
├── web/         config portal — bin defs, schedules, counts [MODIFY]
├── store/       persist bins + schedules + counts + ledger  [MODIFY]
├── sched/       cron-like scheduler → fires dose events     [MODIFY light]
├── dose/        dispense(dose): singulate_one×count, sensor-gated, jam handling  [NEW]
├── hw/
│   ├── actuator.*  Actuator iface; ServoActuator(PCA9685) + StepperActuator(28BYJ-48)  [NEW/reuse]
│   ├── sensor.*    IR break-beam pulse counting per bin     [NEW]
│   ├── audio.*     DFPlayer alarms                          [KEEP]
│   └── leds.*      WS2812B status                           [KEEP]
└── alerts/      reminder, missed-dose, +jam/low/empty       [MODIFY/EXTEND]
```

## Behavioral rules the new code must enforce (brief §9)
1. **Atomic per bin** — confirm each pill via sensor *before* decrementing count; on
   jam, abort that bin and raise a distinct alert. Never partially claim success.
2. **Never double-fire across reboots** — persist a "dose fired" ledger keyed by
   schedule slot; on boot, don't re-run an already-fired slot.
3. **Max-per-bin-per-day cap** — a hard ceiling guards against runaway singulation loops.
4. **Never advance `pills_remaining` for unsensed pills.**
5. **Optional passcode/lock** on the dispense action (base supports it) if misuse is a concern.

---

## Recommended first firmware steps (after this map is approved)
1. Fork `Shaztech/Pilldispenser`; compile the **stock** sketch and flash a bare
   ESP32-CYD; confirm the toolchain (Arduino core + LVGL + SquareLine export path).
   Pin every *(confirm exact filename)* above to the real file.
2. Introduce the `Bin` struct + `Actuator`/`Sensor` interfaces (skeleton already in
   [`../firmware/`](../firmware/)); stub out the tray model behind them.
3. **Phase A:** one `ServoActuator` (PCA9685 ch 0) + one IR break-beam → a UI button
   runs `singulate_one()` with sensor confirmation and a count decrement. Prove it
   with dummy beads before touching mechanics.
4. Only then Phases B→E.
