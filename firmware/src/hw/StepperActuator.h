// StepperActuator.h — 28BYJ-48 + ULN2003, per-bin upgrade.
//
// Use for a bin whose pill won't index reliably with a servo arc. A stepper gives
// precise, repeatable pocket indexing (fixed step count per pocket). Mixing servo
// and stepper bins is allowed — that's why Actuator is an interface. Brief §4.
#pragma once

#include "Actuator.h"
#include <cstdint>

namespace pd {

class StepperActuator : public Actuator {
 public:
  struct Config {
    uint8_t  in1, in2, in3, in4;      // ULN2003 inputs → ESP32 GPIO (or expander)
    uint16_t stepsPerPocket = 512;    // 28BYJ-48 ≈ 2048 steps/rev; TUNE per disc
    uint16_t stepDelayUs    = 1200;   // between half-steps
    bool     reverse        = false;  // disc rotation direction
  };

  explicit StepperActuator(const Config& cfg) : cfg_(cfg) {}

  bool stroke() override {
    // TODO(fork): half-step `stepsPerPocket` steps in the configured direction,
    // then de-energize the coils (don't hold torque / cook the ULN2003).
    return true;
  }

  void home() override {
    // Steppers have no absolute home; "home" = de-energize coils. An optional
    // index switch/optical flag per disc could re-zero if drift is observed.
    // TODO(fork): de-energize all four coils.
  }

 private:
  Config cfg_;
};

}  // namespace pd
