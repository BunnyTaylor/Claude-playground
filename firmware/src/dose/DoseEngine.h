// DoseEngine.h — the NEW core: turn a fired schedule slot into verified drops.
//
// dispense(dose) → for each bin: singulateOne() × count, each gated by the drop
// sensor. Atomic per bin: confirm each pill BEFORE decrementing the count; on jam,
// abort that bin and raise a distinct alert — never partially claim success.
// See docs/02 (behavioral rules) and brief §5/§9.
#pragma once

#include "../Bin.h"
#include "../hw/Actuator.h"
#include "../hw/DropSensor.h"
#include <cstdint>

namespace pd {

// Outcome of dispensing one bin's part of a dose.
enum class BinDispenseStatus : uint8_t {
  Complete,     // all `count` pills confirmed
  Empty,        // bin had no pills to give
  CapExceeded,  // would breach maxPerDay — refused
  Jam,          // a stroke produced 0 sensed pills — bin halted mid-dose
  DoubleDrop,   // a stroke produced >=2 sensed pills — bin halted
  HwFault,      // actuator failed to actuate (e.g. I2C error)
};

struct BinDispenseReport {
  uint8_t           binId       = 0;
  uint32_t          requested   = 0;
  uint32_t          confirmed   = 0;   // pills the sensor actually verified
  BinDispenseStatus status      = BinDispenseStatus::Complete;
};

// Alerting is KEPT from the base (audio/leds/Telegram/HA). DoseEngine calls out
// through this interface so the base's alert code stays decoupled from dose logic.
// A fault alert MUST be distinguishable from a routine reminder (brief §5).
class Alerts {
 public:
  virtual ~Alerts() = default;
  virtual void jam(const Bin&)         = 0;
  virtual void doubleDrop(const Bin&)  = 0;
  virtual void lowPill(const Bin&)     = 0;
  virtual void empty(const Bin&)       = 0;
  virtual void hwFault(const Bin&)     = 0;
};

// Persistence is KEPT/MODIFIED from the base (store/). DoseEngine writes through it
// after every confirmed pill so counts survive a power cut and a fired dose is
// never re-run (invariants #2, #4).
class Store {
 public:
  virtual ~Store() = default;
  virtual void saveBin(const Bin&)                 = 0;  // persist pillsRemaining/dispensedToday
  virtual void markDoseFired(uint32_t doseSlotId)  = 0;  // ledger: never re-fire on reboot
  virtual bool wasDoseFired(uint32_t doseSlotId)   = 0;
};

class DoseEngine {
 public:
  DoseEngine(Alerts& alerts, Store& store) : alerts_(alerts), store_(store) {}

  // Dispense `count` pills from one bin, fully verified. Returns a report; on jam
  // or double-drop the bin is left homed and halted, and the matching alert fired.
  // `actuator` and `sensor` belong to this bin (chosen servo/stepper per Bin).
  BinDispenseReport dispenseBin(Bin& bin, Actuator& actuator, DropSensor& sensor,
                                uint32_t count);

 private:
  Alerts& alerts_;
  Store&  store_;
};

}  // namespace pd
