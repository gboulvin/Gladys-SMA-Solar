# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

**SMA Solar**, a Gladys Assistant **external integration**: a Node.js service
(Node 22+, ESM, no build step) that runs in its own sandboxed Docker container
and talks to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template
([integration-template-js](https://github.com/GladysAssistant/integration-template-js)).

It reads SMA inverters, hybrid and battery inverters **locally**, over Modbus
TCP (SMA Modbus profile, function 0x04, unit ID 3 by default). Local only: the
manifest declares `"transports": ["local"]`. It never writes a register.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/installation.test.js     # one file
node --test --test-name-pattern "widget"  # tests whose name matches
LOG_LEVEL=debug npm test                  # with the integration logs
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                SDK wiring only: handlers registered before connect()
src/config.js           DEFAULT_CONFIG (mirrors the manifest defaults), normalization, parseTargets
src/modbus.js           minimal Modbus TCP client (read input registers), injectable socket
src/sma.js              SMA register map, decoding (U32/S32/U64, FIXn, NaN), identifyDevice, readSnapshot
src/devices.js          Gladys device + features built from an identified profile, states of a reading
src/installation.js     configured devices, identification, reading loop, publications, totals
src/triggers.js         scene trigger detection (pure function of previous/current state)
src/scenes.js           scene action handlers (manifest `scene_actions`)
src/widgets.js          dashboard widget handlers (manifest `widgets`)
src/actions.js          Configuration screen buttons (manifest `actions`)
src/storage.js          /data/sma-devices.json: profiles identified once (inverters sleep at night)
src/i18n.js             multi-language helpers, condition labels
gladys-assistant-integration.json   manifest
docs/{en,fr,de,es}.md   user documentation, re-hosted by Gladys (en + fr mandatory)
test/                   node --test, fake Gladys of the SDK + simulated SMA device (test/helpers/fakeSma.js)
.github/scripts/release.mjs   release helpers (manifest bump, changelog), tested in test/
```

## Rules

- **External ids are forever.** Devices are `gladys.externalIds('sma', serial)`
  — the SMA serial number, never the IP address. Feature keys (`FEATURES` in
  `src/devices.js`), manifest `config_schema`, `actions`, scene trigger,
  scene action, output, variable and widget keys are stored by Gladys and by
  users' scenes and dashboards: add new ones, never rename or remove one.
- **Registers.** Every register lives in `REGISTERS` (`src/sma.js`), with its
  format and FIX scale. A NaN value or a Modbus exception reads as `null`; a
  transport error makes the device unreachable. Only read: this integration
  never writes to an inverter.
- **Tests never touch the network.** Use `createFakeSmaDevice` /
  `fakeNetwork` (test/helpers/fakeSma.js), which answers real Modbus frames
  from a register map through an in-memory socket.
- **The container rootfs is read-only.** Write only under `/data`
  (`SMA_DATA_DIR` overrides it). Never log tokens or passwords.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section.
- **Four languages.** Every user-facing text — manifest `label` /
  `description` / `placeholder`, action messages, connection status, widget
  contents — is a multi-language object `{ en, fr, de, es }` (use `text()` from
  `src/i18n.js`), and `docs/en.md`, `fr.md`, `de.md`, `es.md` are kept in sync.
  `test/manifest.test.js` fails on a missing language.
- **Manifest.** The catalog `description` holds 10 to 100 characters per
  language. `widgets`, `scene_triggers` and `scene_actions` require
  `gladys_version` >= 5.1.0. The tests tie the manifest to the code (defaults,
  actions, scene actions and outputs, triggers and their data, widgets):
  change both sides together.
- **Scene events.** One event per transition, never per reading (300
  events/minute), and only the keys declared in the trigger `fields` /
  `variables`.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English.
