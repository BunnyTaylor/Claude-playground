// Bin.h — the bulk-bin data model.
//
// Replaces Shaztech's "Tray { 30 fixed sections }". A Bin holds ONE medication
// loose in bulk and has its own actuator + drop sensor. See
// docs/02-architecture-keep-modify-delete.md.
//
// Skeleton: fields + invariants only. Persistence (store/) writes this struct plus
// a separate "dose fired" ledger to flash/SD so a reboot never re-fires a dose.
#pragma once

#include <cstdint>
#include <string>

namespace pd {

// How a bin's singulation disc is driven. Chosen per-bin so a fussy pill can be
// upgraded from servo to stepper without touching the rest of the system.
enum class ActuatorKind : uint8_t {
  Servo,    // SG90 via PCA9685 channel — default, PCA9685-native (brief §4)
  Stepper,  // 28BYJ-48 + ULN2003 — per-bin upgrade for precise indexing
};

struct Bin {
  uint8_t     id            = 0;   // 0..N-1, maps to a physical bin/module
  std::string medication;          // display name, shown in UI / alerts

  // Bulk inventory (NOT "sections"). Only ever decremented for a pill the drop
  // sensor actually confirmed (safety invariant #4).
  uint32_t    pillsRemaining = 0;
  uint32_t    lowThreshold   = 5;  // warn at/below this (low-pill alert)

  // Mechanism.
  ActuatorKind actuator      = ActuatorKind::Servo;
  uint8_t     servoChannel   = 0;  // PCA9685 channel when actuator == Servo
  // (stepper pin set lives in StepperActuator; referenced by id)
  uint8_t     sensorPin      = 0;  // ESP32 GPIO (or expander line) for the IR receiver

  // Usually 1. A disc *could* carry >1 pocket-fill per stroke, but Phase A assumes 1.
  uint8_t     pillsPerStroke = 1;

  // Runaway-loop guard (safety invariant #3): hard ceiling of pills this bin may
  // dispense in one calendar day, across all doses. Reset at local midnight.
  uint32_t    maxPerDay      = 20;
  uint32_t    dispensedToday = 0;

  // --- derived helpers ---
  bool isEmpty()  const { return pillsRemaining == 0; }
  bool isLow()    const { return pillsRemaining <= lowThreshold; }
  bool capReached(uint32_t want) const { return dispensedToday + want > maxPerDay; }
};

}  // namespace pd
