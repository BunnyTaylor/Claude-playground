// ServoActuator.h — SG90 driven through the kept PCA9685 driver.
//
// Reuses Shaztech's PCA9685 layer (the whole reason we keep that board): one
// channel per bin, no extra ESP32 pins. A stroke sweeps a fixed arc (one pocket
// index) then returns. Default actuator; brief §4.
#pragma once

#include "Actuator.h"
#include <cstdint>

namespace pd {

// Thin wrapper over the base project's PCA9685 servo API. Pulse endpoints are the
// two positions between which a single pocket indexes; tune per disc geometry.
class ServoActuator : public Actuator {
 public:
  struct Config {
    uint8_t  channel      = 0;    // PCA9685 channel (== Bin.servoChannel)
    uint16_t homePulse    = 150;  // ~0.5 ms  (12-bit PCA9685 count) — ready position
    uint16_t strokePulse  = 450;  // ~1.5 ms  — one-pocket advance; TUNE per disc
    uint16_t settleMs     = 250;  // dwell so the pill clears the drop-hole
    uint16_t returnMs     = 250;  // dwell after returning home
  };

  explicit ServoActuator(const Config& cfg) : cfg_(cfg) {}

  bool stroke() override {
    // TODO(fork): drive via the base's PCA9685 instance:
    //   pca.setPWM(cfg_.channel, 0, cfg_.strokePulse); delay(cfg_.settleMs);
    //   pca.setPWM(cfg_.channel, 0, cfg_.homePulse);   delay(cfg_.returnMs);
    // Return false if the PCA9685 write itself errors (I2C NACK).
    return true;
  }

  void home() override {
    // TODO(fork): pca.setPWM(cfg_.channel, 0, cfg_.homePulse);
  }

 private:
  Config cfg_;
};

}  // namespace pd
