import copy
import importlib.util
from pathlib import Path
import unittest


PATH = Path(__file__).resolve().parents[1] / "scripts/phone11-worker3000-handoff.py"
SPEC = importlib.util.spec_from_file_location("worker3000", PATH)
op = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(op)

OLD_ID = "a" * 64
OLD_IMAGE = "sha256:" + "b" * 64
NEW_IMAGE = "sha256:" + "c" * 64
OLD_BUNDLE = "d" * 64
NEW_BUNDLE = "e" * 64
OLD = {
    "Id": OLD_ID, "Name": "/cp11-backend", "Image": OLD_IMAGE,
    "State": {"Running": True},
    "Config": {"User": "cloudphone", "WorkingDir": "/app",
               "Entrypoint": ["docker-entrypoint.sh"], "Cmd": ["node", "dist/index.mjs"],
               "Env": ["PORT=3000", "PHONE11_RUNTIME_ROLE=default",
                       "PHONE11_CHAT_NOTIFICATIONS_ENABLED=1", "SECRET=private$literal"],
               "Healthcheck": {"Test": ["CMD", "node", "health.js"]},
               "ExposedPorts": {"3000/tcp": {}}},
    "HostConfig": {"NetworkMode": "private-net", "PortBindings":
                   {"3000/tcp": [{"HostIp": "127.0.0.1", "HostPort": "3000"}]},
                   "RestartPolicy": {"Name": "unless-stopped"}, "Memory": 123456},
    "Mounts": [{"Type": "bind", "Source": "/private/data", "Destination": "/data", "RW": True}],
    "NetworkSettings": {"Networks": {"private-net": {}}},
}
PARENT = {"Id": OLD_IMAGE, "Config": copy.deepcopy(OLD["Config"])}
CHILD = {"Id": NEW_IMAGE, "Config": copy.deepcopy(OLD["Config"])}
CHILD["Config"]["Labels"] = {
    "com.phone11.overlay-parent-image-id": OLD_IMAGE,
    "com.phone11.overlay-kind": "bundle-only",
    "com.phone11.bundle-sha256": NEW_BUNDLE,
}
PIN = {"schema": op.SCHEMA,
       "old": {"container_id": OLD_ID, "image": OLD_IMAGE, "bundle_sha256": OLD_BUNDLE},
       "release": {"image": NEW_IMAGE, "bundle_sha256": NEW_BUNDLE},
       "snapshot_sha256": op.digest(op.canonical(op.snapshot(OLD)))}


class Worker3000Tests(unittest.TestCase):
    def test_exact_live_and_overlay_pins_pass(self):
        op.verify(PIN, OLD, PARENT, CHILD, [OLD], OLD_BUNDLE)

    def test_old_id_image_bundle_and_config_drift_refuse(self):
        cases = [
            (lambda old, pin: old.update(Id="f" * 64), "old_identity"),
            (lambda old, pin: old.update(Image=NEW_IMAGE), "old_identity"),
            (lambda old, pin: old["Config"]["Env"].append("UNEXPECTED=1"), "old_config_drift"),
        ]
        for edit, stage in cases:
            old, pin = copy.deepcopy(OLD), copy.deepcopy(PIN)
            edit(old, pin)
            with self.assertRaisesRegex(op.Refused, stage):
                op.verify(pin, old, PARENT, CHILD, [old], OLD_BUNDLE)
        with self.assertRaisesRegex(op.Refused, "old_bundle_drift"):
            op.verify(PIN, OLD, PARENT, CHILD, [OLD], "f" * 64)
        host = copy.deepcopy(OLD)
        host["HostConfig"]["Memory"] = 0
        with self.assertRaisesRegex(op.Refused, "old_config_drift"):
            op.verify(PIN, host, PARENT, CHILD, [host], OLD_BUNDLE)

    def test_ambiguous_or_unsafe_runtime_is_refused(self):
        for edit, stage in [
            (lambda item: item["Config"]["Env"].append("PHONE11_RUNTIME_ROLE=api-candidate"), "environment"),
            (lambda item: item["HostConfig"]["PortBindings"].update({"3000/tcp": [{"HostIp": "0.0.0.0", "HostPort": "3000"}]}), "port_shape"),
            (lambda item: item["NetworkSettings"]["Networks"].update(other={}), "network_shape"),
        ]:
            item = copy.deepcopy(OLD)
            edit(item)
            with self.assertRaisesRegex(op.Refused, stage):
                op.snapshot(item)

    def test_overlay_parent_or_runtime_config_drift_refuses(self):
        for change in (
            lambda item: item["Config"]["Labels"].update({"com.phone11.overlay-parent-image-id": NEW_IMAGE}),
            lambda item: item["Config"]["Labels"].update({"com.phone11.bundle-sha256": OLD_BUNDLE}),
        ):
            image = copy.deepcopy(CHILD)
            change(image)
            with self.assertRaisesRegex(op.Refused, "new_image_labels"):
                op.verify(PIN, OLD, PARENT, image, [OLD], OLD_BUNDLE)
        image = copy.deepcopy(CHILD)
        image["Config"]["Cmd"] = ["sleep", "forever"]
        with self.assertRaisesRegex(op.Refused, "new_image_config_drift"):
            op.verify(PIN, OLD, PARENT, image, [OLD], OLD_BUNDLE)

    def test_second_default_worker_blocks_prepare(self):
        peer = copy.deepcopy(OLD)
        peer["Id"] = "f" * 64
        peer["Name"] = "/unrelated-worker"
        with self.assertRaisesRegex(op.Refused, "double_worker"):
            op.verify(PIN, OLD, PARENT, CHILD, [OLD, peer], OLD_BUNDLE)
        peer["Config"]["Env"] = ["PHONE11_RUNTIME_ROLE=api-candidate"]
        op.verify(PIN, OLD, PARENT, CHILD, [OLD, peer], OLD_BUNDLE)

    def test_exclusive_new_worker_and_rollback_order(self):
        stopped = copy.deepcopy(OLD)
        stopped["State"]["Running"] = False
        replacement = copy.deepcopy(OLD)
        replacement["Id"] = "f" * 64
        replacement["Image"] = NEW_IMAGE
        replacement["Config"]["Env"].append("PHONE11_BUILD_SHA=new-build")
        op.verify_exclusive_phase(stopped, replacement, [stopped, replacement], rollback=False)
        with self.assertRaisesRegex(op.Refused, "worker_exclusivity"):
            op.verify_exclusive_phase(OLD, replacement, [OLD, replacement], rollback=False)
        with self.assertRaisesRegex(op.Refused, "replacement_env_drift"):
            changed = copy.deepcopy(replacement)
            changed["Config"]["Env"].append("SECRET_TWO=unexpected")
            op.verify_exclusive_phase(stopped, changed, [stopped, changed], rollback=False)
        with self.assertRaisesRegex(op.Refused, "rollback_order"):
            op.verify_exclusive_phase(stopped, replacement, [stopped, replacement], rollback=True)
        old_disabled = copy.deepcopy(OLD)
        old_disabled["Config"]["Env"][-2] = "PHONE11_CHAT_NOTIFICATIONS_ENABLED=0"
        with self.assertRaisesRegex(op.Refused, "rollback_notifications"):
            op.verify_exclusive_phase(OLD, None, [OLD], rollback=True)
        op.verify_exclusive_phase(old_disabled, None, [old_disabled], rollback=True)


if __name__ == "__main__":
    unittest.main()
