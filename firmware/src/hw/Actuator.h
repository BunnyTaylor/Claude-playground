// Actuator.h — one "singulation stroke" abstraction.
//
// A stroke advances the singulation disc by exactly one pocket: scoop one pill
// under the hopper, carry it to the drop-hole, let it fall. The DoseEngine never
// cares whether that's a servo arc or a stepper step — only ServoActuator /
// StepperActuator know. See docs/02, brief §4/§9.
#pragma once

namespace pd {

class Actuator {
 public:
  virtual ~Actuator() = default;

  // Perform exactly one singulation stroke and return to the ready position.
  // Blocking is fine at Phase A (one bin at a time); revisit if bins must run
  // concurrently. Returns false only on a hardware-level failure to actuate
  // (e.g. I2C error) — a pill NOT dropping is detected by the DropSensor, not here.
  virtual bool stroke() = 0;

  // Move to a known safe/home position (called on init and after a jam-halt).
  virtual void home() = 0;
};

}  // namespace pd
