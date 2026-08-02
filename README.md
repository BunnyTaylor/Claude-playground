# Bulk-Bin Auto Pill Dispenser

An automatic pill dispenser that stores each medication **loose, in a bulk hopper**
(no pre-filled pods or trays) and **singulates** — drops exactly one pill at a time —
on a schedule into a shared cup. Targets 4–6 medications.

> **Status: design + scaffolding phase.** This branch contains the research
> synthesis, the architecture / keep-modify-delete map, a firmware skeleton, and
> parametric CAD starters. No hardware has been built or flashed yet. See
> [`docs/`](docs/) for the plan and [`ROADMAP`](#roadmap) below for where we are.

## The core idea

The hard problem in an auto dispenser is **singulation**: reliably releasing
*exactly one* pill from a pile of loose pills. Rather than solve mixed-pill
sorting (the pharmacy-robot problem), we give **each medication its own bin**,
each with its own dedicated singulation disc, actuator, and drop sensor. A dose =
trigger the relevant bins N times each and let the pills fall into one shared cup.
One very hard problem becomes 4–6 copies of an easy, individually-tunable one.

## What we build on

| Source | Type | What we take |
|--------|------|--------------|
| [`Shaztech/Pilldispenser`](https://github.com/Shaztech/Pilldispenser) | Open source | The whole electronics + firmware stack (ESP32-CYD, PCA9685 servo driver, DFPlayer audio, WS2812B LEDs, WiFi/NTP/web-portal/Telegram/OTA). We **replace only its rotating carousel tray**. |
| [`WissamAntoun/SMD`](https://github.com/WissamAntoun/SMD) | Open source | Architecture reference: one container per pill type, a motor-rotated cylinder releases pills. Confirms our per-bin approach. |
| [`vtlanglois/MedicineDispenser`](https://github.com/vtlanglois/MedicineDispenser) | Open source | Servo dispense pattern (note: its "sensor" only detects a *hand*, not a pill drop — our drop verification is new work). |
| **MedaCube** (commercial) | Closed source | Its spinning-tray + arcuate **wiper guide** singulator and its **refusal to dispense split pills** validate our scraper/wiper design and our "no half-pills" rule. |

Full detail, including patents and the singulation trade study, is in
[`docs/01-research-synthesis.md`](docs/01-research-synthesis.md).

## Repository layout

```
docs/     research synthesis, architecture map, wiring, safety  ← read these first
firmware/ ESP32 firmware skeleton (Bin model, dose engine, hw interfaces)
cad/      parametric OpenSCAD: singulation disc, housing, hopper, chute
hardware/ (reserved for Phase E PCB: schematic, layout, Gerbers)
```

## Roadmap

Build in phases — do **not** design the PCB or finalize mechanical parts before
firmware behavior and singulation are proven on a bench.

- **Phase A** — Firmware skeleton on breadboard: one servo (via PCA9685) + one IR
  break-beam → UI button triggers a single singulation, sensor confirms the drop,
  count decrements. *(scaffolded here; not yet run on hardware)*
- **Phase B** — Scheduler, NTP, persistence, alerts, web portal; scale to 4–6 bins;
  jam / double-drop handling.
- **Phase C** — 3D-print ONE singulation module; tune pocket geometry to real pills;
  target ≥200 consecutive correct single-drops before trusting it.
- **Phase D** — Replicate the proven module ×N over a shared manifold + cup.
- **Phase E** — Custom PCB (adapt Shaztech's base) to replace the breadboard.

See [`docs/02-architecture-keep-modify-delete.md`](docs/02-architecture-keep-modify-delete.md)
for the exact code-path map, and the [`firmware/`](firmware/) and [`cad/`](cad/)
READMEs for how to build each part.

## ⚠️ Safety — read before building or relying on this

This is a DIY device that dispenses medication. Treat the following as
requirements, not suggestions. The full version is in [`docs/04-safety.md`](docs/04-safety.md).

- **Not child-proof or tamper-proof.** Do not place within reach of small
  children or anyone who might over-ingest. Add a locking lid if there is any risk.
- **Drop verification is mandatory** for medications where a wrong or double dose
  is dangerous (anticoagulants, cardiac meds, insulin, anything narrow-therapeutic-index).
  For those pills, seriously consider a proven commercial device instead.
- **Split / half pills are unsupported.** Even commercial units refuse them. Buy
  the correct strength or accept reduced reliability, and know the firmware flags it.
- **Keep a manual backup** — a paper medication list and a normal weekly pillbox.
  Automatic dispensers fail on power loss, jams, and firmware bugs.
- This device **does not replace pharmacist or physician guidance.** It only
  automates the timing and counting of already-correct prescriptions.

## License

The upstream `Shaztech/Pilldispenser` license governs any reused firmware/PCB
assets — **check that repo before redistributing.** Original work in this
repository (docs, CAD, new firmware) is intended for personal use; a project
license will be chosen before any redistribution.
