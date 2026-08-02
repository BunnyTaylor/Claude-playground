# Breadboard wiring & BOM (Phases A / B)

How to wire the electronics on a breadboard before any PCB exists. Phase A uses
**one** bin's worth (1 servo + 1 sensor); Phase B scales the same pattern to 4–6.

## BOM

| Qty | Part | Notes |
|----:|------|-------|
| 1 | ESP32-2432S028 "CYD" | Brain + 2.8" touchscreen UI (from base project) |
| 1 | PCA9685 16-ch PWM breakout (I²C) | Drives all servos; base already supports it |
| 4–6 | SG90 servo | One per bin; start with one |
| (opt) | 28BYJ-48 stepper + ULN2003 | Per-bin upgrade if servo indexing is unreliable |
| 4–6 | IR break-beam sensor pair | Drop verification, one per chute |
| 1 | DFPlayer Mini + microSD + 8Ω speaker | Audio alarms (from base) |
| 1 | WS2812B LED(s) | Status indication (from base) |
| 1 | 5V power supply, ≥3A | Servos are the current draw; **do NOT** power servos from the ESP32 regulator |
| — | Breadboard, jumpers, 1000µF cap across servo 5V rail | Standard |

Rough cost: **~$60–120** for a 4–6 bin breadboard build, plus filament.

## Power — enforce this

- Servos get their **own 5 V rail** from the ≥3 A supply. **Never** run servos off
  the ESP32's onboard regulator — a stall spike will brown-out the ESP32.
- ESP32 and the servo supply must share a **common ground.**
- Put a **1000 µF bulk capacitor across the servo 5 V rail** (near the PCA9685 V+)
  to absorb stall spikes. A small cap alone is not enough.

```
 5V ≥3A supply ──┬──────────────── PCA9685 V+ (servo power)
                 │        + 1000µF ─┘ (across V+/GND, near the board)
                 └── (do NOT tie to ESP32 3V3)
        GND ─────┬──── PCA9685 GND ──── servo GND ──── sensor GND ──── ESP32 GND
                 (single common ground)
```

## I²C — PCA9685 ↔ ESP32-CYD

The CYD exposes limited free GPIO (many pins are taken by the LCD/touch/SD). Pick
**free** pins for I²C and confirm against the Shaztech pin map when you fork —
these are the conventional defaults, to be verified on the actual board:

| Signal | ESP32-CYD pin (verify) | PCA9685 |
|--------|------------------------|---------|
| SDA | GPIO 21 (or a documented free pin) | SDA |
| SCL | GPIO 22 (or a documented free pin) | SCL |
| 3V3 | 3V3 | VCC (logic) |
| GND | GND | GND |

Add **4.7 kΩ pull-ups** on SDA and SCL if the breakout doesn't already have them.
PCA9685 **V+** is the *servo* rail (5 V, §Power), separate from **VCC** (logic 3V3).

## Servo (Phase A: bin 0)

- SG90 signal → **PCA9685 channel 0** (PWM out).
- SG90 V+ / GND → servo 5 V rail / common GND (**not** the PCA9685 logic VCC).
- The firmware sweeps a fixed arc = one pocket index = one `singulate_one()`.

## IR break-beam drop sensor (Phase A: bin 0)

Mounted across the drop chute so exactly one pill breaks the beam once.

| Sensor pin | Connect to |
|------------|-----------|
| Emitter V+ / GND | 5 V rail (or 3V3 per module spec) / common GND |
| Receiver V+ / GND | 3V3 / common GND |
| Receiver OUT | a free ESP32 **input** GPIO (verify free on CYD) |

Firmware counts beam-break pulses within a timeout window after a stroke:
**1 pulse = OK, 0 = jam, ≥2 = double-drop.** Debounce in firmware (a pill breaks the
beam for a few ms). Choose a receiver GPIO that is input-capable and not strapped.

## Scaling to 4–6 bins (Phase B)

- Servos: PCA9685 channels **0…N-1** — no extra ESP32 pins needed. This is the whole
  reason we keep the PCA9685.
- Sensors: one free input GPIO **per bin**. The CYD has few free pins — if you run
  out, add an **MCP23017 I²C GPIO expander** for the sensor inputs (shares the I²C
  bus with the PCA9685) rather than dropping verification.
- Keep the single common ground and the bulk cap on the shared servo rail.

## Verification checklist before leaving the breadboard (Phase A/B done)
- [ ] Stock Shaztech firmware compiles and flashes to a bare CYD.
- [ ] I²C scan finds the PCA9685.
- [ ] UI button → servo does exactly one singulation stroke.
- [ ] A dropped bead produces exactly one beam-break pulse; count decrements by one.
- [ ] 0 pulses within timeout → jam alert (distinct sound + LED), count unchanged.
- [ ] ≥2 pulses → double-drop alert, bin halted.
- [ ] 4–6 servos + 4–6 sensors all addressable; per-bin isolation holds.
- [ ] Power-cycle mid-schedule → no dose re-fires or double-fires.
