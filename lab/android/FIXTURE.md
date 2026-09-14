# Phone11 Android SIP fixture

This disposable local PBX exercises the app's **Siprix** engine. Asterisk's server-side PJSIP driver is not an Android client engine or a substitute for Siprix. No production Compose stack, trunk, external SIP registration, PSTN route, customer account, microphone recording, or push sender is configured.

## Commands

```sh
node lab/android/fixture.mjs up
node lab/android/pbx/probe.mjs
node lab/android/fixture.mjs incoming
node lab/android/fixture.mjs incoming-cancel
node lab/android/fixture.mjs remote-hangup
node lab/android/fixture.mjs down
node --test lab/android/pbx/fixture.test.mjs
```

`up` resumes this checkout's existing run or creates one. It verifies PBX endpoints, tone dialplan, effective published ports, the default-deny egress firewall, and Asterisk's zero effective/bounding capability set. It writes `.lab/fixture-check.json`. Running it again preserves this run's password. `down` first validates both container and network ownership labels, then removes only that run's container, network, private configuration directory, and credential metadata. The locally built image and sanitized evidence remain available. Docker daemon failure does not count as successful cleanup.

The host probe temporarily registers synthetic **7102**, authenticates an INVITE to **7190**, sends generated RTP silence to establish symmetric media, decodes received PCMU, verifies a tone near 440 Hz, sends BYE, and unregisters. Its `.lab/fixture-probe.json` is host/PBX evidence only. Do not run the host probe while a separate test is using 7102.

`incoming` requires a registered 7101 and queues exactly one synthetic incoming call from 7102. Ringing is limited to 20 seconds and an answered tone call to another 20 seconds. `incoming-cancel` and `remote-hangup` target only this fixture's PJSIP/7101 channels: a ringing dialog receives CANCEL, an established dialog receives BYE. Queueing and hangup requests are not proof the app received them; the emulator test must record the native callbacks and UI result.

## Emulator contract and private credentials

- Account: **7101**; optional second synthetic account **7102**.
- Emulator SIP server: **10.0.2.2:15060**, UDP or TCP; default UDP.
- Host SIP address: **127.0.0.1:15060**, UDP or TCP.
- RTP: **16000–16019/UDP**, published only on host loopback. SDP advertises the emulator's host alias 10.0.2.2. The endpoint uses symmetric RTP; tests must send RTP before expecting returned tone/echo.
- Allowed dialplan: **7101**, **7102**, **7190** (440 Hz tone), **7191** (echo). All calls have an absolute 20-second answered-call limit. There are no wildcard or external routes.

`.lab/fixture.json` is mode 0600 within `.lab` mode 0700. It contains `runId`, ownership/resource names, `imageId`, `sip`, `rtp`, and `accounts["7101"].password` / `accounts["7102"].password`. Generated PBX configuration is also mode 0600. Provision the lab app at runtime using this private file; never print its password, copy it into source, commit it, bake it into an APK, or include it in screenshots. Docker logging is disabled. The build context contains only the Dockerfile and startup script, and never the runtime configuration.

## Isolation and reproducibility

The image pins Alpine 3.22.1's **arm64** manifest digest and Asterisk **20.11.1-r6**, iptables **1.8.11-r1**, and setpriv **2.41.6-r1**. This build targets Apple Silicon's Docker Desktop, matching the Android lab host. The resulting image digest is captured per run. Transitive APK dependencies still come from Alpine's versioned v3.22 repository; the exact resulting image digest is the reproducibility artifact, and an unavailable pinned package should fail the build rather than silently upgrade.

Docker Desktop did not publish usable host ports on an `--internal` network in the measured setup. This fixture instead uses its own bridge with explicit loopback mappings and a namespace-local default-deny OUTPUT firewall. Only loopback and established/related response traffic can leave the container. DNS and IPv6 are disabled. The startup process briefly holds NET_ADMIN/SETPCAP to establish the firewall and then drops **all** capabilities before starting Asterisk. It never changes the host firewall. Asterisk runs with a read-only root filesystem, bounded tmpfs directories, 256 MB memory, one CPU, and a 128-process limit. No production environment variables or credentials are passed into Docker.

Reference behavior: [Asterisk NAT and symmetric RTP configuration](https://docs.asterisk.org/Configuration/Channel-Drivers/SIP/Configuring-res_pjsip/Configuring-res_pjsip-to-work-through-NAT/), [Alpine Asterisk package](https://pkgs.alpinelinux.org/package/v3.22/main/aarch64/asterisk), and [Docker bridge networking](https://docs.docker.com/engine/network/drivers/bridge/).

## Verified here

2026-09-14: image `sha256:d44eb968124a7ea9085c5021027d59d5d9bad90c00a406b9a02086285e0dd9c6`; four safety tests passed; teardown removed exactly its two Docker resources; repeated `up` retained the current run; real host digest REGISTER, tone INVITE, and BYE returned 200. The received PCMU probe decoded 84 RTP packets / 13,440 samples at 8 kHz, RMS 5,099, estimated tone **440.5 Hz**. Incoming before 7101 registration correctly refused. These results do not establish emulator registration, Android push, physical handset audio, or release readiness.
