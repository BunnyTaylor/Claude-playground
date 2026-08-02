# Research Synthesis: existing pill-dispenser designs

This pulls from **open-source projects** and **closed-source / commercial products
and patents** to ground our design decisions. It backs up the choices in the build
brief and flags one place where the brief's assumption needs correcting.

---

## 1. Open-source projects

### 1.1 `Shaztech/Pilldispenser` — our primary base (fork this)
<https://github.com/Shaztech/Pilldispenser>

A mature, actively-maintained ESP32 pill dispenser (~180★, multiple releases,
current firmware v1.3). We adopt **everything except its mechanism.**

**Hardware we reuse:**
- **ESP32-2432S028 "CYD"** (Cheap Yellow Display) — 320×240 resistive touchscreen
  dev board. Brain + UI in one ~$14 board.
- **PCA9685** 16-channel I²C PWM driver — drives all servos. *This is the key reuse:*
  16 channels ≫ our 4–6 bins.
- **SG90** servos (base supports up to 10 trays' worth).
- **DFPlayer Mini** + microSD + 30 mm 2 W speaker for MP3 alarms.
- **WS2812B** addressable RGB LED on a small dedicated PCB, fed through a
  **74AHCT125D** level shifter (3.3 V → 5 V data).
- Position feedback via a **5 mm neodymium magnet** (Hall-style) on the tray.

**Firmware / software stack we reuse:**
- **Arduino framework** (not raw ESP-IDF), custom libraries.
- **LVGL** touchscreen UI designed in **SquareLine Studio** (project files included
  in the repo's `SquareLine Studio/` folder).
- WiFi provisioning on-screen, **NTP** time sync with UTC/DST handling.
- Browser **web portal** for configuration.
- **Telegram** integration; community **Home Assistant** add-on.
- **OTA** firmware update through the web portal.
- Multi-user support with per-user color coding.
- Precompiled binaries (bootloader + partition + app) shipped per release, plus
  editable Arduino sketches. Flash via `esptool`.

**Repo structure (from the GitHub tree):**
```
Arduino/            firmware — PillDispenser/ sketch + libraries/
Guides/             build + flashing docs
P-Touch Labels/     label templates
PCB/                Gerbers (base, LED, tray boards) for JLCPCB/PCBWay
Pictures/
SD Card Root/       audio files etc. for the microSD
SquareLine Studio/  LVGL UI project (editable UI source)
```

**Mechanism we REPLACE:** a **30-section rotating carousel tray**, filled by hand,
advanced by a **servo-driven cam + arm** with torsion / pen springs for return and a
magnet for indexing. This is a pod system — exactly what the user wants to avoid.
We rip out the tray and substitute a **bulk hopper + singulation disc per bin.**

**License:** open-source, but the exact terms must be checked in-repo before
redistributing. Personal use is fine.

### 1.2 `WissamAntoun/SMD` (Smart Medicine Dispenser) — architecture reference (read, don't fork)
<https://github.com/WissamAntoun/SMD>

Validates the architecture we're adopting:
- **One modular container per pill type** ("expandable container units"), each with
  its own LED indicator; each holds several servings of one medication.
- **Singulation = a servo rotates a cylinder** a fixed arc then stops (PWM), releasing
  pills — one motor per container. This is precisely our "one actuator per bin,
  rotate-a-pocket-to-release" concept.
- Controlled by an **Arduino Uno R3**, commanded over **Bluetooth** from an Android
  app, with a PHP + MySQL cloud backend.

**What we take:** the per-container / per-motor mechanical concept only.
**What we reject:** the Uno + Bluetooth + PHP/MySQL/Android stack — the Shaztech
ESP32 web/touch/OTA stack is far better and self-contained.

### 1.3 `vtlanglois/MedicineDispenser` — servo dispense pattern (limited use)
<https://github.com/vtlanglois/MedicineDispenser>

A simple servo dispenser triggered by an **ultrasonic sensor**.

> ⚠️ **Correction to the build brief.** The brief cites this project for a
> "drop-detection sensor pattern." In fact its ultrasonic sensor only detects a
> **hand approaching** (to trigger dispensing) — it has **no feedback loop that
> confirms a pill actually fell.** So there is no drop-detection pattern to port
> from here. Our IR break-beam **drop verification is new work** (see §5 of the
> brief and `docs/02` / the `hw/sensor` skeleton). Useful only as a minimal
> servo-dispense example.

---

## 2. Closed-source / commercial products & patents

These informed which mechanism to trust and which edge cases to refuse. We do not
copy any proprietary design; we use them to sanity-check our own.

### 2.1 MedaCube (commercial, loose-pill, up to 16 meds)
Product: <https://www.medacube.com/products/medacube-automatic-pill-dispenser> ·
Review: <https://www.techenhancedlife.com/reviews/medacube-medication-dispenser>

MedaCube is the closest commercial analog to what the user wants: **dump loose pills
in, it singulates on schedule.** Its singulator (per its patent family) works by:
- A **shallow conical spinning tray** (disc) with a raised central hub; pills are
  delivered onto the hub from a hopper/chute.
- An **arcuate "wiper guide"** mounted just above the tray surface. As the tray
  spins, the wiper guides pills outward from the hub to a boundary wall and, being
  curved, **opens a gap between successive pills** — that spacing *is* the
  singulation. Singulated pills exit one at a time at a pickup station.
- **Chute-to-tray spacing is adjustable to pill size** — the same idea as making our
  pocket depth ≈ one pill thickness.
- MedaCube **refuses split / half pills.**

**What this validates for us:**
1. A **spinning disc + a fixed wiper/scraper lip** is a proven, reliable way to take
   pills from bulk to one-at-a-time. Our brief's star-wheel/pocket disc is a
   deterministic cousin of this (a pocket physically holds exactly one pill instead
   of relying on spacing) — even better suited to our per-bin, sensor-verified model.
2. The **wiper that knocks back un-seated pills** is not optional polish — the
   leading commercial device relies on essentially the same element.
3. **Refusing split pills is the correct, industry-standard call.** We adopt it and
   surface it in the UI, exactly as the brief says.

**Relevant patents (public):**
- US 7,412,302 — *Pharmaceutical singulation counting and dispensing system.*
- US 8,862,266 — *Automated dispensary apparatus for dispensing pills* (spinning
  tray + arcuate wiper guide singulation).
- US 20170132867 A1 — *Object dispenser having a variable orifice and image
  identification* (a size-adjustable orifice + optical ID — informs the
  "adjustable-to-pill-size" and future optical-verification ideas).

### 2.2 Canister / cassette-based consumer units (Hero, Livi, etc.)
These use **per-medication canisters** the user (or pharmacy) loads in bulk, and an
internal mechanism meters pills out on schedule — again confirming the
**one-container-per-medication + meter-out** architecture. They are cassette/auger
based rather than pocket-disc, and are closed systems; we note them as convergent
evidence for the per-bin approach, not as something to copy.

---

## 3. Design decisions this research locks in

| Decision | Evidence |
|----------|----------|
| One bin + one actuator + one sensor **per medication** | SMD, Hero/Livi, MedaCube all isolate meds per container |
| Singulate with a **rotating disc + fixed wiper/scraper** | MedaCube's proven spinning-tray + arcuate wiper |
| **Pocket disc** (deterministic, one pocket = one pill) over spacing-based | Best fit for per-bin **sensor-verified single drops**; simpler to tune per pill |
| **Pocket depth ≈ one pill thickness**, chamfered edges | MedaCube's size-adjustable spacing; anti-stack requirement |
| **Refuse split / half pills**, flag in UI | MedaCube (and all commercial units) refuse them |
| **IR break-beam drop verification is new**, not ported | `vtlanglois` has no drop sensing — brief corrected |
| Reuse Shaztech's **entire electronics + firmware stack**, swap only the tray | Shaztech already ships everything but the right mechanism |
| Servo first (PCA9685-native), **28BYJ-48 stepper as per-bin upgrade** | Shaztech is servo/PCA9685-native; SMD shows servo indexing works; stepper gives repeatability if a bin proves fussy |

---

## Sources
- Shaztech/Pilldispenser — <https://github.com/Shaztech/Pilldispenser>
- WissamAntoun/SMD — <https://github.com/WissamAntoun/SMD>
- vtlanglois/MedicineDispenser — <https://github.com/vtlanglois/MedicineDispenser>
- MedaCube product — <https://www.medacube.com/products/medacube-automatic-pill-dispenser>
- MedaCube review — <https://www.techenhancedlife.com/reviews/medacube-medication-dispenser>
- US 7,412,302 — <https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/7412302>
- US 8,862,266 — <https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/8862266>
- US 2017/0132867 A1 — <https://patents.google.com/patent/US20170132867A1/en>
