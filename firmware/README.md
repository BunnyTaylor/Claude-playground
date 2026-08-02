# Firmware (skeleton)

This is the **Phase A scaffolding**, not a finished firmware. It defines the new
data model and hardware interfaces from the architecture map
([`../docs/02-architecture-keep-modify-delete.md`](../docs/02-architecture-keep-modify-delete.md))
so that, once we fork `Shaztech/Pilldispenser`, the new `dose/` + `hw/` code drops
into the kept net/UI/web/audio/LED/OTA stack with minimal glue.

> ⚠️ **Deliberately not wired to the base yet.** The brief asks us to *report back
> with the keep/modify/delete map before writing large amounts of new firmware.*
> So these headers compile conceptually and document intent, but the concrete
> ESP32/PCA9685/LVGL bodies land **after** the fork compiles stock and the map is
> approved. `// TODO(fork)` marks each spot that binds to real upstream code.

## Layout

```
src/
├── Bin.h            the Bin data model (replaces Shaztech's Tray)
├── dose/
│   └── DoseEngine.h/.cpp   dispense(dose): singulate_one × count, sensor-gated,
│                           atomic-per-bin, jam / double-drop handling
└── hw/
    ├── Actuator.h         interface: one "singulation stroke"
    ├── ServoActuator.h    SG90 via the kept PCA9685 driver (one channel per bin)
    ├── StepperActuator.h  28BYJ-48 + ULN2003 per-bin upgrade
    └── DropSensor.h       IR break-beam pulse counting (1 = ok, 0 = jam, ≥2 = double)
```

Subsystems marked **KEEP** in the architecture map (net, audio, leds, web, ui, OTA)
are **not** re-implemented here — they come from the fork unchanged. Only the
**NEW** and **MODIFY-heavy** pieces are scaffolded.

## Toolchain (to confirm on fork, brief §11 step 1)
- **Arduino core for ESP32** (Shaztech is Arduino-framework, not raw ESP-IDF).
- **LVGL** UI exported from **SquareLine Studio** (`SquareLine Studio/` in the fork).
- **PCA9685** servo library (Adafruit-style) — already a dependency of the base.
- Flash with `esptool` per the base README.

## Phase A goal this scaffolding serves
UI button → `DoseEngine::singulateOne(bin0)` → `ServoActuator` sweeps one arc →
`DropSensor` confirms exactly one beam-break → `bin.pillsRemaining--`. Jam (0) or
double-drop (≥2) halts the bin and raises a distinct alert. Prove with dummy beads
before any mechanics.
