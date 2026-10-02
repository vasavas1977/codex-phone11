#!/usr/bin/env python3
"""Offline transport, seal, drift and rollback checks; never contact a host."""
from contextlib import ExitStack, contextmanager
import importlib.util
import json
from pathlib import Path
import stat
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest import TestCase, main, mock

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("test_phone11_admission_hotfix", ROOT / "scripts" / "phone11-admission-hotfix-release-route.py")
hotfix = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = hotfix
spec.loader.exec_module(hotfix)
route, start = hotfix.route, hotfix.start


def pins():
    return {"candidate": {"port": 3020, "build": "hotfix-build"},
            "baseline": {"build": "baseline-build", "role": "default"},
            "recovery": {"build": "recovery-build", "role": "api-candidate"},
            "nginx": {"site_sha256": "a" * 64, "dump_sha256": "b" * 64}}


def fixture_value():
    return {"schema": hotfix.FIXTURE_SCHEMA, "candidate_port": 3020,
            "candidate_build": "hotfix-build", "public_build": "baseline-build", "public_role": "default"}


def encoded(value):
    return json.dumps(value, sort_keys=True).encode()


def health(candidate=True):
    return encoded({"ok": True, "service": "phone11-backend",
                    "build": "hotfix-build" if candidate else "baseline-build",
                    "runtimeRole": "api-candidate" if candidate else "default"})


def rejection():
    return encoded({"error": {"json": {"code": -32001, "message": "Authentication required",
                    "data": {"code": "UNAUTHORIZED", "httpStatus": 401, "path": "meetings.join"}}}})


@contextmanager
def alarm_clock(previous_timer=(0, 0)):
    previous_handler = mock.Mock(name="previous_alarm_handler")
    clock = SimpleNamespace(now=0, handler=previous_handler, timer=previous_timer,
                            expires=None, history=[], previous_handler=previous_handler)
    def handler(_signum, value):
        old = clock.handler
        clock.handler = value
        clock.history.append(("handler", value))
        return old
    def timer(_which, seconds, interval=0):
        old = clock.timer
        clock.timer = (seconds, interval)
        clock.expires = clock.now + seconds if seconds > 0 else None
        clock.history.append(("timer", seconds, interval))
        return old
    def progress(seconds):
        clock.now += seconds
        if clock.expires is not None and clock.now >= clock.expires:
            clock.expires = None
            clock.handler(hotfix.signal.SIGALRM, None)
    clock.progress = progress
    with mock.patch.object(hotfix.signal, "getsignal", side_effect=lambda _signum: clock.handler), \
         mock.patch.object(hotfix.signal, "getitimer", side_effect=lambda _which: clock.timer), \
         mock.patch.object(hotfix.signal, "signal", side_effect=handler), \
         mock.patch.object(hotfix.signal, "setitimer", side_effect=timer), \
         mock.patch.object(hotfix.time, "monotonic", side_effect=lambda: clock.now):
        yield clock


class ProbeGuards(TestCase):
    def test_wall_deadline_expires_during_request_headers_or_progressing_body(self):
        for phase in ("request", "getresponse", "read"):
            connection = mock.Mock()
            response = connection.getresponse.return_value
            response.status, response.read.return_value = 200, health()
            with alarm_clock() as clock:
                def progress(*args, **kwargs):
                    # Each fragment arrives within the socket idle timeout.
                    for _ in range(4):
                        clock.progress(1.5)
                    self.fail("wall deadline did not interrupt progress")
                target = response.read if phase == "read" else getattr(connection, phase)
                target.side_effect = progress
                with mock.patch.object(hotfix.http.client, "HTTPConnection", return_value=connection):
                    with self.assertRaisesRegex(start.Refused, "hotfix_probe_deadline"):
                        hotfix.request("http://127.0.0.1:3020", "GET", "/api/health")
                connection.close.assert_called_once()
                self.assertIs(clock.handler, clock.previous_handler)
                self.assertEqual(clock.timer, (0, 0))
                self.assertEqual([entry for entry in clock.history if entry[0] == "timer"],
                                 [("timer", 5, 0), ("timer", 0, 0), ("timer", 0, 0)])

    def test_wall_deadline_expires_during_stalled_headers_and_body(self):
        for phase in ("getresponse", "read"):
            connection = mock.Mock()
            response = connection.getresponse.return_value
            with alarm_clock() as clock:
                target = response.read if phase == "read" else getattr(connection, phase)
                target.side_effect = lambda *args: clock.progress(5)
                with mock.patch.object(hotfix.http.client, "HTTPSConnection", return_value=connection):
                    with self.assertRaisesRegex(start.Refused, "hotfix_probe_deadline"):
                        hotfix.request(hotfix.PUBLIC_ORIGIN, "GET", "/api/health")
                connection.close.assert_called_once()
                self.assertIs(clock.handler, clock.previous_handler)
                self.assertEqual(clock.timer, (0, 0))

    def test_prior_alarm_and_timer_restored_after_success_and_failure(self):
        for expires in (False, True):
            connection = mock.Mock()
            response = connection.getresponse.return_value
            response.status = 200
            with alarm_clock((20, 3)) as clock:
                def read(*args):
                    clock.progress(5 if expires else 2)
                    return health()
                response.read.side_effect = read
                with mock.patch.object(hotfix.http.client, "HTTPConnection", return_value=connection):
                    if expires:
                        with self.assertRaisesRegex(start.Refused, "hotfix_probe_deadline"):
                            hotfix.request("http://127.0.0.1:3020", "GET", "/api/health")
                    else:
                        self.assertEqual(hotfix.request("http://127.0.0.1:3020", "GET", "/api/health"), (200, health()))
                self.assertIs(clock.handler, clock.previous_handler)
                self.assertEqual(clock.timer, (15 if expires else 18, 3))
                connection.close.assert_called_once()
        with alarm_clock((1, 2)) as clock:
            with self.assertRaisesRegex(start.Refused, "hotfix_probe_deadline"):
                with hotfix.http_deadline():
                    clock.progress(1)
            self.assertEqual([item for item in clock.history if item[0] == "timer"][0], ("timer", 1, 0))
            self.assertIs(clock.handler, clock.previous_handler)
            self.assertEqual(clock.timer, (0.000001, 2))

    def test_timer_setup_failure_restores_handler_before_network(self):
        with alarm_clock((20, 0)) as clock, \
             mock.patch.object(hotfix.signal, "setitimer", side_effect=(OSError("alarm unavailable"), (0, 0), (0, 0))), \
             mock.patch.object(hotfix.http.client, "HTTPConnection") as connection:
            with self.assertRaises(OSError):
                hotfix.request("http://127.0.0.1:3020", "GET", "/api/health")
            self.assertIs(clock.handler, clock.previous_handler)
            connection.assert_not_called()

    def test_non_main_thread_refused_before_network_or_alarm_change(self):
        with mock.patch.object(hotfix.threading, "current_thread", return_value=object()), \
             mock.patch.object(hotfix.signal, "signal") as signal, \
             mock.patch.object(hotfix.http.client, "HTTPConnection") as connection:
            with self.assertRaisesRegex(start.Refused, "hotfix_deadline_support"):
                hotfix.request("http://127.0.0.1:3020", "GET", "/api/health")
            signal.assert_not_called()
            connection.assert_not_called()

    def test_fixture_has_no_request_configuration_or_credentials(self):
        for extra in ("headers", "Cookie", "Authorization", "path", "method", "body", "probes", "token"):
            raw = encoded({**fixture_value(), extra: "forbidden"})
            with mock.patch.object(route, "root_file", return_value=raw), mock.patch.object(hotfix, "request") as request:
                with self.assertRaisesRegex(start.Refused, "hotfix_fixture"):
                    hotfix.probes(Path("/fixture"), start.digest(raw), hotfix.PUBLIC_ORIGIN)
                request.assert_not_called()

    def test_fixture_pin_and_hash_must_match_before_prepare(self):
        for change in ({"candidate_port": 3021}, {"candidate_build": "wrong"}, {"public_build": "wrong"}):
            raw = encoded({**fixture_value(), **change})
            with mock.patch.object(route, "root_file", return_value=raw), mock.patch.object(route, "prepare") as prepare:
                with self.assertRaisesRegex(start.Refused, "hotfix_fixture_pin"):
                    hotfix.prepare(pins(), Path("/start"), Path("/fixture"), start.digest(raw))
                prepare.assert_not_called()
        raw = encoded(fixture_value())
        with mock.patch.object(route, "root_file", return_value=raw):
            with self.assertRaisesRegex(start.Refused, "hotfix_fixture"):
                hotfix.fixture(Path("/fixture"), "a" * 64)
            with self.assertRaisesRegex(start.Refused, "hotfix_fixture"):
                hotfix.fixture(Path("/fixture"), "invalid")
        raw += b" " * 4_096
        with mock.patch.object(route, "root_file", return_value=raw):
            with self.assertRaisesRegex(start.Refused, "hotfix_fixture"):
                hotfix.fixture(Path("/fixture"), start.digest(raw))

    def test_root_fixture_uses_exact_private_owner_and_secure_file(self):
        for uid, mode in ((501, 0o600), (0, 0o644)):
            with mock.patch.object(Path, "lstat", return_value=SimpleNamespace(st_uid=uid, st_gid=0, st_mode=mode)), \
                 mock.patch.object(start, "secure_file") as read:
                with self.assertRaisesRegex(start.Refused, "receipt_owner"):
                    route.root_file(Path("/fixture"))
                read.assert_not_called()
        with mock.patch.object(Path, "lstat", return_value=SimpleNamespace(st_uid=0, st_gid=0, st_mode=0o600)), \
             mock.patch.object(start, "secure_file", return_value=b"fixture") as read:
            self.assertEqual(route.root_file(Path("/fixture")), b"fixture")
            read.assert_called_once_with(Path("/fixture"))

    def test_fixed_requests_candidate_and_public_health_are_distinct(self):
        raw = encoded(fixture_value())
        for origin, candidate in (("http://127.0.0.1:3020", True), (hotfix.PUBLIC_ORIGIN, False)):
            with mock.patch.object(route, "root_file", return_value=raw), \
                 mock.patch.object(hotfix, "request", side_effect=((200, health(candidate)), (401, rejection()))) as request:
                hotfix.probes(Path("/fixture"), start.digest(raw), origin)
                self.assertEqual(request.call_args_list, [
                    mock.call(origin, "GET", "/api/health"),
                    mock.call(origin, "POST", "/api/trpc/meetings.join", hotfix.JOIN_BODY)])
        legacy = encoded({"ok": True, "service": "phone11-backend", "build": "baseline-build"})
        with mock.patch.object(route, "root_file", return_value=raw), \
             mock.patch.object(hotfix, "request", side_effect=((200, legacy), (401, rejection()))):
            hotfix.probes(Path("/fixture"), start.digest(raw), hotfix.PUBLIC_ORIGIN)

    def test_unapproved_origin_never_sends_a_request(self):
        raw = encoded(fixture_value())
        for origin in ("http://127.0.0.1:3016", "http://127.0.0.1:3018", "https://evil.example",
                       "https://api.phone11.ai/path", "https://user:secret@api.phone11.ai"):
            with mock.patch.object(route, "root_file", return_value=raw), mock.patch.object(hotfix, "request") as request:
                with self.assertRaisesRegex(start.Refused, "hotfix_probe_origin"):
                    hotfix.probes(Path("/fixture"), start.digest(raw), origin)
                request.assert_not_called()

    def test_join_rejection_requires_exact_status_procedure_and_error(self):
        raw = encoded(fixture_value())
        valid = json.loads(rejection())
        cases = [(302, rejection()), (200, encoded({"result": {"data": {"token": "private"}}})),
                 (401, encoded({"error": "UNAUTHORIZED"})), (401, encoded([valid])),
                 (401, encoded({**valid, "result": {}}))]
        for field, wrong in (("code", "NOT_FOUND"), ("httpStatus", 403), ("path", "chat.list")):
            value = json.loads(rejection())
            value["error"]["json"]["data"][field] = wrong
            cases.append((401, encoded(value)))
        value = json.loads(rejection())
        value["error"]["json"]["code"] = -32601
        cases.append((401, encoded(value)))
        for status, body in cases:
            with mock.patch.object(route, "root_file", return_value=raw), \
                 mock.patch.object(hotfix, "request", side_effect=((200, health()), (status, body))) as request:
                with self.assertRaisesRegex(start.Refused, "hotfix_join_rejection"):
                    hotfix.probes(Path("/fixture"), start.digest(raw), "http://127.0.0.1:3020")
                self.assertEqual(request.call_count, 2)

    def test_candidate_health_requires_build_role_and_service_before_join(self):
        raw = encoded(fixture_value())
        for change in ({"build": "wrong"}, {"runtimeRole": "default"}, {"service": "wrong"}, {"ok": False}):
            value = {**json.loads(health()), **change}
            with mock.patch.object(route, "root_file", return_value=raw), \
                 mock.patch.object(hotfix, "request", return_value=(200, encoded(value))) as request:
                with self.assertRaisesRegex(start.Refused, "hotfix_health"):
                    hotfix.probes(Path("/fixture"), start.digest(raw), "http://127.0.0.1:3020")
                self.assertEqual(request.call_count, 1)

    def test_transport_is_bounded_closes_and_sends_no_ambient_auth(self):
        connection = mock.Mock()
        response = connection.getresponse.return_value
        response.status, response.read.return_value = 401, rejection()
        with mock.patch.object(hotfix.http.client, "HTTPConnection", return_value=connection) as create:
            self.assertEqual(hotfix.request("http://127.0.0.1:3020", "POST", "/api/trpc/meetings.join", hotfix.JOIN_BODY),
                             (401, rejection()))
        create.assert_called_once_with("127.0.0.1", 3020, timeout=5)
        connection.request.assert_called_once_with("POST", "/api/trpc/meetings.join", body=hotfix.JOIN_BODY,
            headers={"Accept": "application/json", "Connection": "close", "Content-Type": "application/json"})
        response.read.assert_called_once_with(hotfix.MAX_RESPONSE + 1)
        connection.close.assert_called_once()
        connection.reset_mock()
        response.read.return_value = b"x" * (hotfix.MAX_RESPONSE + 1)
        with mock.patch.object(hotfix.http.client, "HTTPConnection", return_value=connection):
            with self.assertRaisesRegex(start.Refused, "hotfix_probe_size"):
                hotfix.request("http://127.0.0.1:3020", "GET", "/api/health")
        connection.close.assert_called_once()
        connection.reset_mock()
        connection.request.side_effect = OSError("private transport")
        with mock.patch.object(hotfix.http.client, "HTTPSConnection", return_value=connection):
            with self.assertRaisesRegex(start.Refused, "hotfix_probe_transport"):
                hotfix.request(hotfix.PUBLIC_ORIGIN, "GET", "/api/health")
        connection.close.assert_called_once()


class RouteGuards(TestCase):
    @contextmanager
    def simulation(self):
        record = pins()
        before = (b"# immutable wake:3018 and auth routing\n"
                  b"location = /api/trpc {\n proxy_pass http://127.0.0.1:3016;\n}\n"
                  b"location ^~ /api/trpc/ {\n proxy_pass http://127.0.0.1:3016;\n}\n")
        after = route.old.rewrite_trpc(before, 3016, 3020)
        record["nginx"] = {"site_sha256": start.digest(before), "dump_sha256": start.digest(b"head" + before + b"tail")}
        current, files, writes = [before], {}, []
        raw_fixture = encoded(fixture_value())
        def root_file(path):
            return raw_fixture if path == Path("/fixture") else files[str(path)]
        def site(expected=None):
            start.require(expected is None or current[0] == expected, "site_drift")
            return current[0], SimpleNamespace(st_uid=0, st_gid=0, st_mode=0o644)
        def write(expected, replacement, _info):
            start.require(current[0] == expected, "site_drift")
            writes.append((expected, replacement))
            current[0] = replacement
        def atomic(path, raw, **kwargs):
            self.assertEqual(kwargs["mode"], 0o600)
            files[str(path)] = raw
        def nginx(*args):
            self.assertEqual(args, ("nginx", "-T"))
            return b"head" + current[0] + b"tail"
        info = SimpleNamespace(st_mode=stat.S_IFDIR | 0o700, st_uid=0, st_gid=0)
        with TemporaryDirectory() as tmp, ExitStack() as stack:
            for obj, name, kwargs in (
                (route, "ROOT", {"new": Path(tmp)}), (route, "root_dir", {}),
                (route, "start_receipt", {"return_value": "f" * 64}),
                (start, "site_and_wake", {}), (route, "protected", {}),
                (route, "root_file", {"side_effect": root_file}),
                (route, "site", {"side_effect": site}), (route, "write_site", {"side_effect": write}),
                (route, "reload", {}), (route.old, "atomic_write", {"side_effect": atomic}),
                (start, "command", {"side_effect": nginx}),
            ):
                stack.enter_context(mock.patch.object(obj, name, **kwargs))
            original_lstat = Path.lstat
            stack.enter_context(mock.patch.object(Path, "lstat", autospec=True,
                side_effect=lambda path: info if path.parent == route.ROOT else original_lstat(path)))
            stack.enter_context(mock.patch.object(hotfix, "request",
                side_effect=lambda origin, method, path, *args: (200, health(origin != hotfix.PUBLIC_ORIGIN))
                if path == "/api/health" else (401, rejection())))
            directory = hotfix.prepare(record, Path("/start"), Path("/fixture"), start.digest(raw_fixture))
            yield SimpleNamespace(pins=record, before=before, after=after, current=current, files=files,
                                  writes=writes, directory=directory)

    def test_prepare_activate_rollback_with_real_seal_integrity(self):
        with self.simulation() as sim:
            prepared = json.loads(sim.files[str(sim.directory / "receipt.json")])
            self.assertEqual(prepared["schema"], hotfix.SCHEMA)
            self.assertEqual(prepared["state"], "prepared")
            self.assertEqual(sim.writes, [])
            hotfix.activate(sim.pins, sim.directory, Path("/fixture"), hotfix.PUBLIC_ORIGIN)
            self.assertEqual(sim.current[0], sim.after)
            active = json.loads(sim.files[str(sim.directory / "receipt.json")])
            self.assertEqual(active["state"], "active")
            self.assertEqual(active["active_dump_sha256"], start.digest(b"head" + sim.after + b"tail"))
            with mock.patch.object(hotfix, "request") as request:
                route.rollback(sim.pins, sim.directory, hotfix.PUBLIC_ORIGIN)
                request.assert_not_called()
            self.assertEqual(sim.current[0], sim.before)
            self.assertEqual(json.loads(sim.files[str(sim.directory / "receipt.json")])["state"], "rolled_back")

    def test_public_probe_failure_restores_exact_predecessor(self):
        with self.simulation() as sim:
            def request(origin, method, path, *args):
                if origin == hotfix.PUBLIC_ORIGIN: raise start.Refused("public_probe")
                return (200, health()) if path == "/api/health" else (401, rejection())
            with mock.patch.object(hotfix, "request", side_effect=request):
                with self.assertRaisesRegex(start.Refused, "public_probe"):
                    hotfix.activate(sim.pins, sim.directory, Path("/fixture"), hotfix.PUBLIC_ORIGIN)
            self.assertEqual(sim.current[0], sim.before)
            self.assertEqual(sim.writes, [(sim.before, sim.after), (sim.after, sim.before)])
            self.assertEqual(json.loads(sim.files[str(sim.directory / "receipt.json")])["state"], "prepared")

    def test_post_switch_http_deadline_restores_predecessor_and_closes_connection(self):
        real_request = hotfix.request
        connection = mock.Mock()
        response = connection.getresponse.return_value
        response.status = 200
        with self.simulation() as sim, alarm_clock() as clock:
            def read(*args):
                for _ in range(5):
                    clock.progress(1)
                self.fail("deadline did not expire")
            response.read.side_effect = read
            def request(origin, method, path, *args):
                if origin == hotfix.PUBLIC_ORIGIN:
                    return real_request(origin, method, path, *args)
                return (200, health()) if path == "/api/health" else (401, rejection())
            with mock.patch.object(hotfix, "request", side_effect=request), \
                 mock.patch.object(hotfix.http.client, "HTTPSConnection", return_value=connection):
                with self.assertRaisesRegex(start.Refused, "hotfix_probe_deadline"):
                    hotfix.activate(sim.pins, sim.directory, Path("/fixture"), hotfix.PUBLIC_ORIGIN)
            connection.close.assert_called_once()
            self.assertEqual(sim.current[0], sim.before)
            self.assertEqual(sim.writes, [(sim.before, sim.after), (sim.after, sim.before)])
            self.assertEqual(json.loads(sim.files[str(sim.directory / "receipt.json")])["state"], "prepared")
            self.assertIs(clock.handler, clock.previous_handler)
            self.assertEqual(clock.timer, (0, 0))

    def test_reload_failure_restores_and_recover_does_not_probe_bad_candidate(self):
        with self.simulation() as sim:
            with mock.patch.object(route, "reload", side_effect=(start.Refused("reload_failed"), None)) as reload:
                with self.assertRaisesRegex(start.Refused, "reload_failed"):
                    hotfix.activate(sim.pins, sim.directory, Path("/fixture"), hotfix.PUBLIC_ORIGIN)
                self.assertEqual(reload.call_count, 2)
            self.assertEqual(sim.current[0], sim.before)
            with mock.patch.object(hotfix, "request") as request:
                route.recover(sim.pins, sim.directory, hotfix.PUBLIC_ORIGIN)
                request.assert_not_called()
            self.assertEqual(json.loads(sim.files[str(sim.directory / "receipt.json")])["state"], "aborted")

    def test_third_party_drift_is_never_overwritten_on_failure(self):
        with self.simulation() as sim:
            def reload():
                sim.current[0] = b"third-party"
                raise start.Refused("ambiguous_reload")
            with mock.patch.object(route, "reload", side_effect=reload):
                with self.assertRaisesRegex(start.Refused, "restore_requires_operator"):
                    hotfix.activate(sim.pins, sim.directory, Path("/fixture"), hotfix.PUBLIC_ORIGIN)
            self.assertEqual(sim.current[0], b"third-party")
            self.assertEqual(sim.writes, [(sim.before, sim.after)])

    def test_site_and_nginx_drift_refuse_before_route_write(self):
        for stage in ("site", "dump"):
            with self.simulation() as sim:
                if stage == "site": sim.current[0] = b"third-party"
                with mock.patch.object(start, "command", return_value=b"drift") if stage == "dump" else ExitStack():
                    with self.assertRaises(start.Refused):
                        hotfix.activate(sim.pins, sim.directory, Path("/fixture"), hotfix.PUBLIC_ORIGIN)
                self.assertEqual(sim.writes, [])

    def test_tampered_or_mainline_receipt_refused_before_activation(self):
        for change in ({"schema": "phone11-mainline-ec2-route/v2"}, {"fixture_sha256": "b" * 64},
                       {"before_sha256": "b" * 64}, {"candidate_id": "b" * 64}):
            with self.simulation() as sim:
                path = str(sim.directory / "receipt.json")
                sim.files[path] = route.encoded({**json.loads(sim.files[path]), **change})
                with self.assertRaises(start.Refused):
                    hotfix.activate(sim.pins, sim.directory, Path("/fixture"), hotfix.PUBLIC_ORIGIN)
                self.assertEqual(sim.writes, [])

    def test_shared_runtime_and_wake_guards_remain_mandatory(self):
        record = pins()
        with mock.patch.object(start, "source_runtime", return_value={}) as source, \
             mock.patch.object(start, "pinned_container") as pinned, \
             mock.patch.object(start, "check_candidate") as candidate, \
             mock.patch.object(start, "wake_guard", side_effect=start.Refused("wake_drift")) as wake:
            with self.assertRaisesRegex(start.Refused, "wake_drift"):
                route.protected(record, "f" * 64)
            source.assert_called_once_with(record)
            candidate.assert_called_once_with(record, {}, "f" * 64)
            self.assertEqual([call.args[0] for call in pinned.call_args_list], [start.BASELINE, start.RECOVERY])
            wake.assert_called_once_with(record)

    def test_private_module_does_not_weaken_mainline_operator(self):
        spec = importlib.util.spec_from_file_location("test_unmodified_mainline", ROOT / "scripts" / "phone11-mainline-release-route.py")
        mainline = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mainline)
        self.assertEqual(mainline.SCHEMA, "phone11-mainline-ec2-route/v2")
        self.assertEqual(mainline.ROOT, Path("/var/lib/phone11-mainline-release-route"))
        self.assertIsNot(mainline.probes, hotfix.probes)
        self.assertIsNot(mainline, route)


if __name__ == "__main__":
    main()
