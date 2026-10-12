# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for Sonoff / eWeLink devices: a
Node.js service (Node 22.4+, ESM, no build step) running in its own sandboxed
Docker container, talking to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. Local network first (mDNS relayed by the core,
eWeLink LAN protocol in unicast), eWeLink cloud optional (the user's own
developer App ID: OAuth 2.0 or password, REST v2 + WebSocket). The LAN
protocol and the UIID catalog are ported from SonoffLAN (AlexxIT, MIT): see
NOTICE.

## Commands

```bash
npm install
npm test                                  # node --test, never touches the network
node --test test/manager.test.js          # one file
node --test --test-name-pattern "OAuth"   # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store . --skip-image-check
./scripts/build-cover.sh                  # cover.svg -> cover.jpg (800x534, < 150 KB)
```

## Architecture

```
index.js                     SDK wiring only (createIntegration + connect + shutdown)
src/integration.js           every handler registered before connect()
src/manager.js               runtime: LAN scan/poll, cloud session, routing
                             local/cloud, transports, states, scene events
src/registry.js              one entry per device id: cloud list + LAN + manual
src/devices/specs.js         UIID -> capabilities (port of SonoffLAN devices.py)
src/devices/capabilities.js  one Gladys feature per capability: read / write
src/devices/model.js         Gladys device payload, params -> states and events
src/devices/convert.js       ranges, colors, mireds
src/ewelink/local.js         mDNS records, /zeroconf/<cmd> client (AES / DIY)
src/ewelink/cloud.js         REST v2: OAuth, login, refresh, device list
src/ewelink/socket.js        WebSocket: handshake, updates, commands by sequence
src/ewelink/crypto.js        AES-128-CBC(MD5(devicekey)), HMAC-SHA256 signatures
src/actions.js               manifest actions (add/remove a device, test)
src/scenes.js                scene actions (RF code, raw command, rescan)
src/widgets.js               widgets (network status, energy, RF remote)
src/i18n.js                  runtime messages in en / fr / de / es
src/config.js                DEFAULT_CONFIG (mirrors the manifest) + normalization
src/store.js                 /data: last cloud device list, monthly API counter
.github/scripts/release.mjs  version, changelog, version files, PR title checks
```

## Rules

- **External ids are forever**: `gladys.externalIds('sonoff', deviceid)`, the
  eWeLink device id (10 hex characters). Feature keys (`switch`, `switch_2`,
  `power`, `rf_3`...), widget, scene trigger/action, variable, output and
  config keys are forever too: never rename one, add a new one.
- **The container rootfs is read-only**: write only under `/data`
  (`DATA_DIR`). Never log tokens, passwords, App Secrets or device keys.
- **Never embed an App ID or an App Secret**: the user brings the ones of
  their own eWeLink developer application.
- **CoolKit bans IPs that sign in too often**: never open a new WebSocket
  (`userOnline`) without need; a Gladys reconnection keeps the session.
- **Container networking**: no multicast. mDNS goes through
  `gladys.scanNetwork('mdns')` (declared in `network_discovery`), everything
  else in unicast.
- **States**: publish with `publishChangedStates` (300 states per minute).
  Scene events on transitions only, flat string data, never in reaction to a
  scene action.
- **Versions belong to the Release workflow**: never edit `version` in
  `package.json`, `package-lock.json` or the manifest, nor the `docker_image`
  tag. `test/manifest.test.js` checks they agree with the first CHANGELOG
  section. The project stays below 1.0.0 until the maintainer runs Release
  with `release-as: 1.0.0`.
- **Changelog**: never edit CHANGELOG.md by hand, it is generated at release
  time from the Conventional Commits. Write the pull request title as the line
  the user will read (`feat(widgets): add a power chart to the energy widget`).
- **Languages**: every user-facing text exists in English, French, German and
  Spanish: manifest, `src/i18n.js`, `docs/{en,fr,de,es}.md`, the four READMEs.
  `test/i18n.test.js` checks the manifest, the messages and the doc structure.
- **Manifest**: `gladys_version >= 5.2.0` (secret field in an action form).
  `test/manifest.test.js` ties it to the handlers, the defaults and the fired
  triggers: change both sides together.
- **Style**: Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network (fake Gladys of the SDK, fake LAN,
  fake fetch and WebSocket in `test/helpers.js`).
