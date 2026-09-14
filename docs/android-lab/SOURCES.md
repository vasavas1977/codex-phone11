# Verified sources

The supplied documents refer to a SOURCES.md, but that file was not among the attachments or matching Downloads files. This is a new source record, not a reconstruction of unseen R/S references.

- Current repository/base and platform configs were inspected locally and against `git ls-remote`.
- [Official Siprix Java sample](https://github.com/siprix/SampleJava/tree/80d198ed6179b45ff8cd8dad9b8086976b4197a0): AAR origin, Java examples, 60-second trial call limit. Vendor sample logging/trust defaults were not copied.
- [Siprix integration](https://docs.siprix-voip.com/rst/integration.html): native AAR integration and UI/service/model ownership guidance.
- [Siprix release notes](https://docs.siprix-voip.com/rst/updates.html): Android1.1.0 release details. Actual AAR ABI and method signatures additionally inspected locally.
- [Asterisk PJSIP configuration](https://docs.asterisk.org/Configuration/Channel-Drivers/SIP/Configuring-res_pjsip/res_pjsip-Configuration-Examples/): isolated PBX endpoint/auth/AOR configuration. PBX internals do not change the Android Siprix engine.
- [Alpine package catalog](https://pkgs.alpinelinux.org/packages?branch=v3.22&name=asterisk): PBX package provenance; exact image/package pins and runtime checks in fixture files.
