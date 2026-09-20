"""Hermetic tests for protected Phone11 chat candidate preparation."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).parents[1]


def load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


prepare = load("phone11_prepare_chat_candidate", ROOT / "scripts" / "phone11-prepare-chat-candidate.py")
operator = load("phone11_parallel_api_pilot_for_prepare", ROOT / "scripts" / "phone11-parallel-api-pilot.py")


def base_compose() -> dict:
    return {
        "name": "phone11-owned-auth",
        "services": {
            "backend": {
                "image": "reviewed-active-tag",
                "container_name": prepare.ACTIVE_CONTAINER,
                "restart": "always",
                "ports": ["127.0.0.1:3000:3000"],
                "env_file": ["/protected/runtime.env", "/protected/media.env"],
                "environment": {
                    "NORMAL_DOLLAR": "cost$5",
                    "DOUBLE_DOLLAR": "cost$$5",
                    "INTERPOLATION_SHAPE": "${DO_NOT_EXPAND_AGAIN}",
                    "PHONE11_WAKE_ENABLED": "true",
                },
                "volumes": [
                    {"type": "bind", "source": "/protected/data", "target": "/var/lib/phone11"},
                    {"type": "bind", "source": "/protected/apns", "target": "/run/secrets/apns", "read_only": True},
                ],
                "networks": {"existing": {"aliases": ["backend"], "ipv4_address": "172.18.0.4"}},
                "labels": {"old": "label"},
            },
        },
        "networks": {"existing": {"external": True, "name": prepare.EXPECTED_NETWORK}},
    }


class PrepareChatCandidateTests(unittest.TestCase):
    def test_session_broker_uses_the_runtime_database_url_without_emitting_it(self) -> None:
        self.assertIn("new Pool({connectionString:databaseUrl})", prepare.TOKEN_BROKER)
        self.assertIn("createRequire(rootRequire.resolve('better-auth')).resolve('better-call')", prepare.TOKEN_BROKER)
        self.assertIn("pathToFileURL(betterCallPath).href", prepare.TOKEN_BROKER)
        self.assertIn("serializeSignedCookie('',token,secret)", prepare.TOKEN_BROKER)
        self.assertNotIn("createHmac", prepare.TOKEN_BROKER)
        self.assertNotIn("console.log", prepare.TOKEN_BROKER)
        self.assertNotIn("console.error", prepare.TOKEN_BROKER)

    def test_encoded_bearer_is_validated_decoded_but_preserved_for_transport(self) -> None:
        encoded = "session-token." + ("A" * 43) + "%3D"
        with patch.object(prepare, "command", return_value=json.dumps({"1": encoded, "2": encoded}).encode()):
            self.assertEqual(prepare.active_pilot_tokens(), {1: encoded, 2: encoded})
        invalid = "session-token." + ("A" * 43)
        with patch.object(prepare, "command", return_value=json.dumps({"1": invalid, "2": encoded}).encode()):
            with self.assertRaises(prepare.PrepError):
                prepare.active_pilot_tokens()

    def test_runtime_environment_matches_active_values_except_intended_candidate_overrides(self) -> None:
        active = {"Config": {"Env": ["PATH=/bin", "DATABASE_URL=postgres://db/prod", "PORT=3000", "PHONE11_BUILD_SHA=old"]}}
        image = {"Config": {"Env": ["PATH=/bin"]}}
        rendered = {"services": {"candidate": {"environment": {
            "DATABASE_URL": "postgres://db/prod", "PORT": "3002", "PHONE11_BUILD_SHA": prepare.CANDIDATE_BUILD,
            "PHONE11_RUNTIME_ROLE": "api-candidate", "PHONE11_CONNECT11_PLAIN_VIDEO_TENANTS": "protected",
            "PGOPTIONS": prepare.CANDIDATE_PGOPTIONS,
        }}}}
        self.assertEqual(prepare.validate_runtime_environment(active, image, rendered), [])
        rendered["services"]["candidate"]["environment"]["DATABASE_URL"] = "postgres://db/drifted"
        self.assertEqual(prepare.validate_runtime_environment(active, image, rendered), ["DATABASE_URL"])

    def test_runtime_environment_rejects_existing_or_url_embedded_pgoptions(self) -> None:
        rendered = {"services": {"candidate": {"environment": {
            "DATABASE_URL": "postgres://db/prod", "PGOPTIONS": prepare.CANDIDATE_PGOPTIONS,
        }}}}
        image = {"Config": {"Env": []}}
        for active_env in (["DATABASE_URL=postgres://db/prod", "PGOPTIONS=-c lock_timeout=0"],
                           ["DATABASE_URL=postgres://db/prod?options=-c%20lock_timeout%3D0"]):
            with self.subTest(active_env=active_env), self.assertRaises(prepare.PrepError):
                prepare.validate_runtime_environment({"Config": {"Env": active_env}}, image, rendered)

    def test_candidate_preserves_protected_env_mounts_network_and_literal_dollars(self) -> None:
        source = base_compose()
        document = prepare.build_candidate_compose(source)
        service = document["services"]["candidate"]
        self.assertEqual(service["image"], prepare.CANDIDATE_IMAGE)
        self.assertEqual(service["container_name"], prepare.CANDIDATE_NAME)
        self.assertEqual(service["restart"], "unless-stopped")
        self.assertEqual(service["ports"], [{"host_ip": "127.0.0.1", "target": 3002, "published": "3002", "protocol": "tcp"}])
        self.assertEqual(service["volumes"], source["services"]["backend"]["volumes"])
        self.assertEqual(document["networks"], source["networks"])
        self.assertEqual(service["networks"], {"existing": {}})
        self.assertEqual(service["env_file"], ["/protected/runtime.env", "/protected/media.env", prepare.CONFERENCE_ENV])
        for key in ("NORMAL_DOLLAR", "DOUBLE_DOLLAR", "INTERPOLATION_SHAPE"):
            self.assertEqual(service["environment"][key], source["services"]["backend"]["environment"][key])
        self.assertEqual(service["environment"]["PORT"], "3002")
        self.assertEqual(service["environment"]["PHONE11_RUNTIME_ROLE"], "api-candidate")
        self.assertEqual(service["environment"]["PGOPTIONS"], prepare.CANDIDATE_PGOPTIONS)
        health = " ".join(service["healthcheck"]["test"])
        self.assertIn("127.0.0.1:3002/api/health", health)
        self.assertNotIn("127.0.0.1:3000/api/health", health)

    def test_candidate_rejects_unknown_network_or_unprotected_shape(self) -> None:
        for mutate in (
            lambda value: value["networks"]["existing"].update(name="wrong"),
            lambda value: value["services"]["backend"].pop("volumes"),
            lambda value: value["services"].update(extra={}),
        ):
            value = base_compose()
            mutate(value)
            with self.assertRaises(prepare.PrepError):
                prepare.build_candidate_compose(value)

    def test_probe_bundle_has_exact_labels_owner_binding_and_operator_shape(self) -> None:
        fixture = {"conversationId": "11111111-1111-4111-8111-111111111111", "messageId": "22222222-2222-4222-8222-222222222222"}
        tokens = {1: "one." + "a" * 43, 2: "two." + "b" * 43}
        document = prepare.build_probes(tokens, fixture)
        probes = {item["label"]: item for item in document["probes"]}
        self.assertEqual(set(probes), operator.EXPECTED_PROBES)
        for item in probes.values():
            owner = item["headers"]["X-Phone11-Chat-Owner"]
            bearer = item["headers"]["Authorization"]
            self.assertEqual(bearer, f"Bearer {tokens[int(owner)]}")
            self.assertNotIn("Cookie", item["headers"])
            self.assertIn("PHONE11_AUTH_SECRET", item["forbidden"])
        self.assertIn("127.0.0.1", prepare.build_candidate_compose(base_compose())["services"]["candidate"]["ports"][0]["host_ip"])
        self.assertIn("chat.typingPublish,chat.publishReadReceipts", probes["existing_chat"]["path"])
        self.assertIn("phone.getConfig,chat.presenceCapability,chat.readReceiptSummaries,chat.readReceiptDetails", probes["mixed_batch"]["path"])
        self.assertIn("phone.getConfig", probes["existing_phone"]["path"])
        self.assertIn('"available":false', probes["conference"]["required"])
        raw = json.dumps(document, separators=(",", ":")).encode()
        pins = operator.parse_manifest({
            "schema": operator.SCHEMA,
            "active": {"container_id": "a" * 64, "image": operator.ACTIVE_IMAGE, "runtime_sha256": "1" * 64, "health_build": "live"},
            "candidate": {"image": prepare.CANDIDATE_IMAGE, "build": prepare.CANDIDATE_BUILD, "config_sha256": "2" * 64,
                          "compose_file": "/root/compose", "compose_sha256": "3" * 64},
            "credentials": {"config_sha256": "4" * 64, "metadata_sha256": "5" * 64},
            "migration": {"receipt_file": "/root/receipt", "receipt_sha256": "6" * 64},
            "probes": {"file": "/root/probes", "sha256": operator.sha256_bytes(raw)},
            "nginx": {"site": "/etc/nginx/site", "site_sha256": "7" * 64, "dump_sha256": "8" * 64,
                      "insert_marker": "# PHONE11_PARALLEL_API_INSERT reviewed"},
            "kamailio": {"config_path": "/etc/kamailio.cfg", "config_sha256": "9" * 64, "wake_occurrences": 4},
            "public_origin": operator.PUBLIC_ORIGIN,
        })
        self.assertEqual(len(operator.load_probes(raw, pins)), 5)

    def test_auth_me_must_match_each_pilot_without_logging_body(self) -> None:
        tokens = {1: "one.secret", 2: "two.secret"}
        responses = [(200, b'{"user":{"id":1,"name":"hidden"}}'), (200, b'{"user":{"id":2,"name":"hidden"}}')]
        with patch.object(prepare, "request", side_effect=responses) as request:
            prepare.verify_auth(tokens)
        self.assertEqual(request.call_count, 2)
        self.assertEqual(request.call_args_list[0].args[1], "/api/auth/me")
        with patch.object(prepare, "request", return_value=(200, b'{"user":{"id":2}}')):
            with self.assertRaises(prepare.PrepError) as error:
                prepare.verify_auth({1: "one.secret"})
        self.assertEqual(error.exception.stage, "auth_me")

    def test_fixture_checkpoint_is_reused_without_reading_other_chat_rows(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            checkpoint = Path(temporary) / "fixture.json"
            value = {"schema": "phone11-chat-pilot-fixture/v1", "fixtureId": str(__import__("uuid").uuid4()),
                     "tenantId": 1, "pilotUserIds": [1, 2], "clientId": str(__import__("uuid").uuid4()),
                     "conversationId": str(__import__("uuid").uuid4()), "messageId": str(__import__("uuid").uuid4()), "state": "ready"}
            checkpoint.write_bytes(prepare.canonical_bytes(value))
            checkpoint.chmod(0o600)
            with patch.object(prepare, "CHECKPOINT", checkpoint), patch.object(prepare.os, "geteuid", return_value=0), \
                 patch.object(prepare, "secure_read", return_value=prepare.canonical_bytes(value)), \
                 patch.object(prepare, "trpc_query") as query, patch.object(prepare, "trpc_mutation") as mutation:
                self.assertEqual(prepare.prepare_fixture({1: "one", 2: "two"}), value)
            query.assert_not_called()
            mutation.assert_not_called()

    def test_trpc_paths_encode_superjson_and_batch_inputs(self) -> None:
        single = prepare.trpc_path(["chat.list"], [{"tenantId": 1}])
        self.assertTrue(single.startswith("/api/trpc/chat.list?input="))
        batch = prepare.trpc_path(["phone.listOrganizations", "chat.presenceCapability"], [None, {"tenantId": 1}], batch=True)
        self.assertIn("?batch=1&input=", batch)


if __name__ == "__main__":
    unittest.main()
