# Changelog

All notable changes to this project are documented in this file.

## [1.1.0] - 2026-11-25

### Changed

- The rules of the Ambientika MQTT Bridge, so that Matter, Home Assistant, ioBroker and Homey show the same values.
- A Slave is shown with the operating mode of its zone Master; the role a unit reports itself counts.
- A single impossible temperature or humidity reading is held back; a saturated humidity sensor reads 100 %.
- A command stays shown until the unit reports it, for up to two minutes; the log says so when a unit never does.
- A fixed fan step out of Night, Away or Surveillance changes to manual heat recovery, as out of Smart and Auto.
- After a sign-in that was not accepted the next one comes after a minute, then later each time (30 minutes at most).

## [1.0.0] - 2026-11-21

### Added

- Every Ambientika unit of the account as a bridged fan with temperature, humidity and air quality.
- The operating modes of the unit as a mode selection.
- Sign-in with the e-mail address and password of the Ambientika app; the sign-in is renewed on its own.
- The units of the last run are there at once after a restart, also while the Ambientika cloud cannot be reached.
- White list and black list for units.
