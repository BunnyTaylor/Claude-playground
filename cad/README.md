# CAD — parametric singulation module (OpenSCAD)

Parametric source for the mechanical parts that replace Shaztech's carousel tray.
**All pill-specific tuning lives in [`params.scad`](params.scad)** — edit the four
`PILL` numbers (measured with calipers) and every part regenerates (brief §4).

> **Not yet rendered.** OpenSCAD wasn't available in the authoring environment, so
> these `.scad` files have **not been rendered to STL or visually checked** here.
> Open each in OpenSCAD (F5 preview, F6 render, then Export → STL) and eyeball the
> geometry before printing. Treat them as a tuned starting point, not finished STLs.

## Parts

| File | What it is |
|------|-----------|
| [`params.scad`](params.scad) | Shared parameters — pill dims, pocket dims, disc, shaft, housing. **Start here.** |
| [`singulation_disc.scad`](singulation_disc.scad) | The pocket disc. Round-tablet starter + an oblong/capsule path. One pocket = one pill. |
| [`disc_housing.scad`](disc_housing.scad) | Holds the disc + actuator; scoop window, drop-hole, fixed wiper/scraper lip, IR sensor slot. |
| [`hopper.scad`](hopper.scad) | Refillable bulk funnel-hopper with viewing window + lid. |
| [`manifold_chute.scad`](manifold_chute.scad) | Merges N bins' drop-holes into one chute over the shared cup. Parametric in `bin_count`. |

## The mechanism in one paragraph

Loose pills sit in the `hopper` over the `disc_housing`'s scoop window. The
`singulation_disc` has through-pockets sized to hold exactly one pill; the housing
floor holds each scooped pill in its pocket. As the disc indexes one pocket per
stroke, a fixed **wiper lip** knocks back any pill not seated flush (so a second
can't stack and ride along), and when a loaded pocket reaches the **drop-hole** the
pill falls through the **IR sensor slot** into the `manifold_chute` and the cup. This
is the deterministic cousin of MedaCube's spinning-tray + wiper singulator
(see [`../docs/01-research-synthesis.md`](../docs/01-research-synthesis.md)).

## Tuning workflow (Phase C)

1. Measure the pill; set `pill_shape` + the four `PILL` dims in `params.scad`.
2. Render `singulation_disc.scad`; check pocket bore ≈ pill + `pocket_side_clear`,
   and `disc_thickness` ≈ one pill thickness (a second pill must NOT stack).
3. Print the disc + housing; assemble on the chosen actuator (servo or D-shaft).
4. Test-drop real pills. Adjust `pocket_side_clear`, `pocket_chamfer`, `wiper_gap`.
5. **Reliability gate:** ≥200 consecutive correct single-drops before you trust the
   bin (brief §3 Phase C). Generate per-pill disc variants as needed.

## Print settings (analogous to the base project)
- ~15% infill for structural parts (housing, frame, manifold).
- Disc: print flat, fine layer height (0.12–0.16 mm) for clean pocket walls; consider
  100% infill on the thin disc so pockets are crisp.
- Supports only where noted (funnels print fine without if angled ≥45°).
- **Split / half pills are unsupported by this geometry** — pockets assume a whole
  pill of consistent thickness (brief §4/§10).

## Not modelled here (deliberately)
Per brief §8, mechanical parts are new/parametric, but where new modules bolt onto
Shaztech's **retained** base/enclosure (LCD holder, speaker mount, USB mount) we owe
written, *measured* mounting instructions rather than guessed edits to the opaque
base STLs. Those measurements get taken against the actual fork in Phase D, and the
actuator-mount stubs in `disc_housing.scad` / the inter-inlet trough in
`manifold_chute.scad` are finished then (they depend on the fixed `bin_pitch` and
`shaft_type`).
