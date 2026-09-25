# Meeting title backend image overlay (prepared)

The candidate source is `d67be349fbedbda0d4d441c3e0d958ae1481611a`; its bundled server file is SHA-256 `870fdad722679a67575a57c27fee5131c2128aa75d97d201064588c76cb0292e`. The active parent image is `sha256:d23a97bd859bb2788802fe50debc0d5551a1125d3b879d62277016f41fa0bd22`. The first host attempt failed before producing an image because Docker 29.1.3 has no buildx plugin and the original script forced BuildKit. This revision selects the host's available classic Docker builder explicitly. A probe with a nonexistent context confirmed the classic builder path reaches context validation; the revised image build has not yet run on the host.

Stage the reviewed bundle on the VoIP host at `/opt/phone11ai/meeting-title-20260925/dist/index.mjs` with root-controlled directory permissions. Copy `scripts/phone11-meeting-title-overlay-image.py` to the host, then run:

```sh
sha256sum /opt/phone11ai/meeting-title-20260925/dist/index.mjs
sudo python3 phone11-meeting-title-overlay-image.py --bundle-path /opt/phone11ai/meeting-title-20260925/dist/index.mjs
```

The first digest must be `870fdad722679a67575a57c27fee5131c2128aa75d97d201064588c76cb0292e`. On success, the second command prints one `sha256:` image ID. Record that exact ID for the separate 3009 start operator; do not guess it. The builder does not start a container, touch Nginx, or change the database. It uses Docker locally, with network disabled for the build and no pull.

The script rejects a changed active parent image, source bundle, candidate bundle, or platform. It gives the exact parent image a temporary local tag, builds with `DOCKER_BUILDKIT=0`, `--pull=false`, and `--network=none`, adds only `/app/dist/index.mjs` as a new filesystem layer, and then removes the temporary tag. A failed or unavailable classic builder rejects the candidate. It compares inherited runtime settings, exact parent layer prefix and history, new layer content/ownership/mode/hash, and candidate labels before returning the image ID. The inherited healthcheck is disabled in the image because the separate start operator sets the 3009 healthcheck.

The candidate `source-sha`, `bundle-sha256`, and `candidate-build` labels identify this release. `archive-sha256` and `base-source-sha` are cleared because the inherited values describe the old source archive, not the candidate source; the exact parent image ID is recorded in `overlay-parent-image-id`. Inherited lock and provisioning-overlay labels remain lineage of the unchanged parent runtime, not claims about rebuilding dependencies.

Offline source checks:

```sh
python3 tests/phone11-meeting-title-overlay-image.test.py -v
python3 -m py_compile scripts/phone11-meeting-title-overlay-image.py
```

Passing those checks is source evidence only. The image ID and live Docker verification remain pending until the builder runs on the VoIP host. The 3009 candidate, route change, authenticated title behavior, and two-device meeting audio each need their own later evidence.
