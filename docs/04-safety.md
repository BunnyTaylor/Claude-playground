# Safety notes (must ship in the README too)

This device dispenses **medication**. A DIY build that miscounts, jams, or fails
silently can cause a missed or double dose. Treat this page as requirements.

## Hard rules

1. **Not child-proof or tamper-proof.** These builds have open hoppers and printed
   lids. Do **not** place them within reach of small children, pets, or anyone who
   might over-ingest. If there is *any* such risk, add a **locking lid** — do not run
   without one.

2. **Drop verification is mandatory for dangerous-if-wrong meds.** For anticoagulants
   (e.g. warfarin), cardiac meds, insulin, and anything with a **narrow therapeutic
   index**, the IR break-beam drop sensor must be present and working, and a fault
   must **halt** that bin — never silently continue. For these specific pills,
   seriously weigh a **proven commercial device** instead of a DIY one.

3. **Split / half pills are unsupported.** Even commercial units (MedaCube) refuse
   them; a pocket disc cannot reliably singulate a half-pill (chipped edges, variable
   thickness). If a half-dose is needed, **buy the correct strength** or pre-split
   into a bin *knowing reliability drops* — and the UI must flag the bin. Do not rely
   on it for a critical med.

4. **Keep a manual backup.** Maintain a **paper medication list** and a normal weekly
   pillbox with a few days' supply. Automatic dispensers fail on power loss, jams,
   empty bins, and firmware bugs. The device automates timing/counting of an
   *already-correct* prescription — it does not replace it.

5. **This is not medical advice.** The device does not replace pharmacist or
   physician guidance. Verify every prescription, strength, and schedule with them.

## Failure modes the firmware must handle (not hide)

| Failure | Required behavior |
|---------|-------------------|
| **Jam** (0 pills sensed within timeout) | Halt that bin, mark dose incomplete, distinct alert (sound + LED ≠ normal reminder). Do **not** decrement count. |
| **Double-drop** (≥2 sensed) | Halt that bin, distinct alert, log it. Count only what's confirmed; flag the over-dispense. |
| **Low pill** (count ≤ threshold) | Warn early (light/sound + Telegram/HA) so the user refills before empty. |
| **Empty bin** | Warn; do not claim a dose was dispensed. |
| **Missed dose** | Reuse base project's missed-dose alerting. |
| **Power loss mid-schedule** | On reboot, never re-fire or double-fire an already-fired dose (persisted "dose fired" ledger). |
| **Runaway loop** | Enforce a **max-dispense-per-bin-per-day cap**. |

## Design safeguards
- **Atomic per bin:** confirm each pill *before* decrementing the stored count.
- **Distinct alerts:** a jam/fault must be immediately distinguishable from a routine
  reminder — different LED color/pattern and a different audio clip.
- **Optional passcode/lock** on the manual dispense action if misuse is a concern.
- Clear/windowed hopper walls so the user can eyeball remaining pills against the
  firmware count.
