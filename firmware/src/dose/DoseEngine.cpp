// DoseEngine.cpp — reference implementation of the atomic, sensor-gated dispense.
//
// This is the safety heart of the firmware. The control flow here is the real
// design; the only `// TODO(fork)` bits are where it binds to the base project's
// concrete objects (PCA9685 servo, ISR pulse counter, NVS store, DFPlayer/LED
// alerts). Keep this logic intact when wiring it in.
#include "DoseEngine.h"

namespace pd {

BinDispenseReport DoseEngine::dispenseBin(Bin& bin, Actuator& actuator,
                                          DropSensor& sensor, uint32_t count) {
  BinDispenseReport rep;
  rep.binId     = bin.id;
  rep.requested = count;
  rep.confirmed = 0;

  // Refuse up-front if the bin can't safely satisfy the request.
  if (bin.isEmpty()) {
    rep.status = BinDispenseStatus::Empty;
    alerts_.empty(bin);
    return rep;
  }
  if (bin.capReached(count)) {
    // Runaway-loop guard (invariant #3). Refuse rather than dispense partially blind.
    rep.status = BinDispenseStatus::CapExceeded;
    return rep;
  }

  actuator.home();

  for (uint32_t i = 0; i < count; ++i) {
    if (bin.isEmpty()) {                 // ran dry mid-dose
      rep.status = BinDispenseStatus::Empty;
      alerts_.empty(bin);
      return rep;
    }

    // 1) One singulation stroke.
    if (!actuator.stroke()) {
      rep.status = BinDispenseStatus::HwFault;
      actuator.home();
      alerts_.hwFault(bin);
      return rep;                        // halt the bin; do not guess
    }

    // 2) Verify the drop BEFORE touching the count (atomic-per-bin, invariant #1/#4).
    switch (sensor.waitForDrop()) {
      case DropResult::Ok:
        bin.pillsRemaining -= 1;
        bin.dispensedToday += 1;
        rep.confirmed      += 1;
        store_.saveBin(bin);             // persist after each confirmed pill (invariant #4)
        break;

      case DropResult::Jam:              // nothing fell — abort, do NOT decrement
        rep.status = BinDispenseStatus::Jam;
        actuator.home();
        alerts_.jam(bin);                // distinct alert (brief §5)
        return rep;

      case DropResult::DoubleDrop:       // too many fell — abort, flag over-dispense
        rep.status = BinDispenseStatus::DoubleDrop;
        actuator.home();
        alerts_.doubleDrop(bin);
        return rep;
    }
  }

  actuator.home();
  rep.status = BinDispenseStatus::Complete;

  // Proactive low-pill warning so the user refills before a future jam-by-empty.
  if (bin.isLow()) alerts_.lowPill(bin);

  return rep;
}

// NOTE: whole-dose orchestration (iterate the bins a scheduled slot names, call
// dispenseBin for each, then store_.markDoseFired(slotId), signal the user with the
// normal reminder light+sound, and cross-check with an optional load cell) lands in
// Phase B once the scheduler callback is rewired to bins. Kept out of Phase A so the
// single-bin path can be proven first (brief §11 step 3).

}  // namespace pd
