# FreeSWITCH outbound recording metadata fixture

This fixture copies the two real Phone11 outbound dialplan files into a
generated minimal configuration, starts the exact FreeSWITCH image with Docker
networking disabled, and drives SIP plus ESL over that container's loopback.

It first runs an unchanged baseline with the new metadata actions removed, then
runs the candidate. It proves all four source-number patterns keep their
intended transfer and carrier destination. The candidate inbound A-leg must keep
the three canonical authenticated recording variables, the inbound/outbound
direction pair, the received peer address, and the external Sofia profile. The
carrier INVITE must not receive any protected `X-Phone11-*` header. Its
`P-Asserted-Identity` and `Remote-Party-ID` values must exactly equal the
baseline, including when a header is absent in both runs.

The runner requires a Linux host with the pinned image already present, Docker,
Python 3, `nsenter`, and root access. It publishes no ports, uses no production
endpoint, and passes `--pull never`, `--network none`, a read-only root
filesystem, dropped capabilities, and loopback-only SIP/ESL configuration.

From the repository root:

```sh
sudo tests/fixtures/phone11-outbound-recording-fs/run.sh
```

The exact image is:

```text
sha256:b31c743f4c911a19687c61e3214968f2a24f93f9d3d667cc26284192e158ffc6
```
