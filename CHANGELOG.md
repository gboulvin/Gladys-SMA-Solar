# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.1] - 2026-10-22

### Security

- `brace-expansion`, pulled in by ESLint, raised to 5.0.12 against the
  high-severity denial-of-service advisories (GHSA-mh99-v99m-4gvg and
  related). A development tool only: the published image never shipped it.
- The image is rebuilt on the latest `node:24-alpine` (Node.js and Alpine
  security patches); development tools and CI actions up to date.

## [1.0.0] - 2026-10-14

### Added

- First release of the SMA Solar integration: SMA inverters, hybrid and
  battery inverters read on the local network through Modbus TCP (SMA Modbus
  profile), without any cloud account.
- One Gladys device per SMA device, keyed by its serial number: solar
  production, production of the day and total, battery level, charge and
  discharge power and energy, grid import and export (with an SMA Energy Meter
  or Sunny Home Manager), AC voltage and current, inverter temperature.
- Several devices per installation, each with its own port and Modbus unit ID
  (devices behind an SMA Data Manager or Cluster Controller).
- Scene triggers: solar production started, solar production stopped (with
  the energy of the day), SMA device condition changed.
- Scene actions: read an SMA device, read the whole solar installation.
- Dashboard widgets: solar installation overview and single SMA device.
- "Test the connection" button in the Configuration screen.
- Local / unreachable transport badge, and connection status in the
  Configuration screen.
- The devices identified once are remembered, so inverters asleep at night stay
  available after a restart of Gladys.
- English, French, German and Spanish texts and user documentation.

[Unreleased]: https://github.com/gboulvin/Gladys-SMA-Solar/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/gboulvin/Gladys-SMA-Solar/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/gboulvin/Gladys-SMA-Solar/releases/tag/v1.0.0
