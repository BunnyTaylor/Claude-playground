// DropSensor.h — IR break-beam drop verification (safety-critical, brief §5).
//
// One emitter/receiver pair across each bin's drop chute. Exactly one pill should
// break the beam once per stroke. We count debounced beam-break pulses inside a
// timeout window:  1 = OK,  0 = jam,  >=2 = double-drop.
//
// This is NEW work — no upstream drop sensing exists (vtlanglois only sensed a
// hand, not a pill; see docs/01).
#pragma once

#include <cstdint>

namespace pd {

enum class DropResult : uint8_t {
  Ok,          // exactly one pill sensed
  Jam,         // zero pills sensed within the window
  DoubleDrop,  // two or more pills sensed
};

class DropSensor {
 public:
  struct Config {
    uint8_t  pin;                 // ESP32 GPIO (or I2C-expander line) for receiver OUT
    bool     activeLow  = true;   // beam broken pulls the line low on typical modules
    uint16_t debounceMs = 8;      // a pill breaks the beam for a few ms
    uint16_t windowMs   = 800;    // wait this long after a stroke for the pill to fall
  };

  explicit DropSensor(const Config& cfg) : cfg_(cfg) {}

  // Count debounced beam-break pulses for `windowMs` after a stroke fires and
  // classify. Implemented over an ISR pulse counter or a tight polled loop.
  DropResult waitForDrop() {
    // TODO(fork): read the debounced pulse count over cfg_.windowMs.
    uint8_t pulses = readPulses_();
    if (pulses == 0) return DropResult::Jam;
    if (pulses >= 2) return DropResult::DoubleDrop;
    return DropResult::Ok;
  }

 private:
  uint8_t readPulses_() {
    // TODO(fork): attach interrupt on cfg_.pin (edge per activeLow), debounce by
    // cfg_.debounceMs, accumulate for cfg_.windowMs, detach, return the count.
    return 1;  // placeholder so the skeleton is well-formed
  }

  Config cfg_;
};

}  // namespace pd
