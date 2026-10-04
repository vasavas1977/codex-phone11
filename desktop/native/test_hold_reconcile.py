"""Hold callback races and missing callbacks must not permit an unsafe toggle."""

import itertools
import json
import pathlib
import queue
import subprocess
import tempfile
import threading
import time


NATIVE = pathlib.Path(__file__).resolve().parent


def assert_late_recovery(trace: list[dict]) -> None:
    errors = [i for i, item in enumerate(trace) if item.get("event") == "hold_error"]
    recoveries = [i for i, item in enumerate(trace) if item.get("event") == "hold_recovered"]
    held = [i for i, item in enumerate(trace) if item.get("event") == "call" and
            item.get("state") == "held"]
    assert len(errors) == len(recoveries) == 1 and len(held) == 2, trace
    error_index, recovery_index = errors[0], recoveries[0]
    # This fake mode emits Remote before Local. The timer thread can report
    # uncertainty before or after Remote, but only Local may restore control.
    remote_index, local_index = held
    assert error_index < recovery_index and remote_index < recovery_index < local_index, trace
    assert all(trace[i].get("callId") == "200" for i in
               (error_index, remote_index, recovery_index, local_index)), trace
    assert trace[error_index].get("code") == "state_unconfirmed", trace
    assert trace[error_index].get("holdControl") == "blocked", trace
    assert trace[recovery_index].get("code") == "state_confirmed", trace
    assert trace[recovery_index].get("holdControl") == "ready", trace


def test_late_recovery_orderings() -> None:
    error = dict(event="hold_error", callId="200", code="state_unconfirmed", holdControl="blocked")
    remote = dict(event="call", callId="200", state="held")
    recovery = dict(event="hold_recovered", callId="200", code="state_confirmed", holdControl="ready")
    local = dict(event="call", callId="200", state="held")
    accepted = 0
    for prefix in itertools.permutations((error, remote, recovery)):
        valid = prefix[2] is recovery
        try:
            assert_late_recovery([*prefix, local])
        except AssertionError:
            assert not valid, prefix
        else:
            assert valid, prefix
            accepted += 1
    assert accepted == 2  # Both timer/Remote orders; all premature recoveries refused.
    for trace in (
        [error, remote, local, recovery],
        [{**error, "holdControl": "ready"}, remote, recovery, local],
        [error, remote, {**recovery, "holdControl": "blocked"}, local],
        [error, remote, {**recovery, "callId": "201"}, local],
        [error, remote, recovery],
    ):
        try:
            assert_late_recovery(trace)
        except AssertionError:
            pass
        else:
            raise AssertionError("Unsafe recovery trace was accepted")


def run_case(flags: list[str], phases: list[tuple[str, float]], *,
             wait_before_phase: dict[int, str] | None = None) -> list[dict]:
    with tempfile.TemporaryDirectory(prefix="phone11-hold-reconcile-") as tmp:
        binary = pathlib.Path(tmp) / "helper"
        subprocess.run([
            "clang++", "-std=c++17", "-pthread", "-I", str(NATIVE / "test"),
            "-DPHONE11_HELPER_HOLD_TIMEOUT_MS=120", *flags,
            str(NATIVE / "phone11_siprix_helper.cpp"), "-o", str(binary),
        ], check=True, capture_output=True, text=True)
        process = subprocess.Popen([str(binary)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True)
        assert process.stdin is not None
        assert process.stdout is not None
        assert process.stderr is not None
        output: queue.Queue[dict | Exception | None] = queue.Queue()
        trace: list[dict] = []

        def read_output() -> None:
            try:
                for line in process.stdout:
                    output.put(json.loads(line))
            except Exception as error:
                output.put(error)
            finally:
                output.put(None)

        reader = threading.Thread(target=read_output, daemon=True)
        reader.start()

        def next_event(deadline: float, label: str) -> dict | None:
            try:
                item = output.get(timeout=max(0, deadline - time.monotonic()))
            except queue.Empty as error:
                raise AssertionError(f"Timed out waiting for {label}: {trace}") from error
            if isinstance(item, Exception):
                raise AssertionError(f"Invalid helper output while waiting for {label}: {trace}") from item
            if item is not None:
                trace.append(item)
            return item

        def wait_for(label: str, ready) -> None:
            deadline = time.monotonic() + 5
            while not ready():
                assert next_event(deadline, label) is not None, f"Helper EOF before {label}: {trace}"

        def recovered_local() -> bool:
            recovered = next((i for i, item in enumerate(trace) if
                              item.get("event") == "hold_recovered" and
                              item.get("callId") == "200" and
                              item.get("code") == "state_confirmed" and
                              item.get("holdControl") == "ready"), None)
            return recovered is not None and any(
                item.get("event") == "call" and item.get("callId") == "200" and
                item.get("state") == "held" for item in trace[recovered + 1:])

        try:
            process.stdin.write("v1 init\nv1 provision\ninvalid.example\n1020\n1020\nfake-secret\nTLS\n")
            process.stdin.flush()
            wait_for("incoming call", lambda: any(item.get("state") == "incoming" for item in trace))
            process.stdin.write("v1 answer 200\n")
            process.stdin.flush()
            wait_for("connected call", lambda: any(item.get("state") == "connected" for item in trace))
            for index, (commands, delay) in enumerate(phases):
                event = (wait_before_phase or {}).get(index)
                if event == "hold_error":
                    wait_for("blocked hold timeout", lambda: any(
                        item.get("event") == "hold_error" and item.get("callId") == "200" and
                        item.get("code") == "state_unconfirmed" and item.get("holdControl") == "blocked"
                        for item in trace))
                elif event == "hold_recovered_local":
                    wait_for("authoritative local hold recovery", recovered_local)
                else:
                    assert event is None, f"Unknown phase event: {event}"
                process.stdin.write(commands)
                process.stdin.flush()
                time.sleep(delay)
            process.stdin.write("v1 shutdown\n")
            process.stdin.close()
            deadline = time.monotonic() + 5
            while next_event(deadline, "helper shutdown") is not None:
                pass
            assert process.wait(timeout=5) == 0
            errors = process.stderr.read()
            assert errors == "", errors
            assert all(private not in json.dumps(trace) for private in
                       ("fake-secret", "private-from", "private-to"))
            return trace
        finally:
            if not process.stdin.closed:
                try:
                    process.stdin.close()
                except BrokenPipeError:
                    pass
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=2)
            reader.join(timeout=1)
            process.stdout.close()
            process.stderr.close()


def main() -> None:
    test_late_recovery_orderings()
    remote = run_case(["-DPHONE11_FAKE_REMOTE_FIRST"], [
        ("v1 hold 200 1\nv1 hold 200 0\n", 0.25),
        ("v1 hold 200 0\n", 0.15),
    ])
    remote_replies = [item["ok"] for item in remote if "ok" in item]
    assert remote_replies == [True, True, True, True, False, True, True], remote
    assert not any(item.get("event") == "hold_error" for item in remote)

    missing = run_case(["-DPHONE11_FAKE_DROP_HOLD_CALLBACK"], [
        ("v1 hold 200 1\nv1 hold 200 0\n", 0.25),
        ("v1 hold 200 0\n", 0.25),
    ])
    missing_replies = [item["ok"] for item in missing if "ok" in item]
    assert missing_replies == [True, True, True, True, False, True, True], missing
    assert not any(item.get("event") == "hold_error" for item in missing)
    assert any(item.get("state") == "held" for item in missing)

    unchanged = run_case(["-DPHONE11_FAKE_DROP_HOLD_CALLBACK", "-DPHONE11_FAKE_HOLD_NO_STATE_CHANGE"], [
        ("v1 hold 200 1\n", 0.25),
        ("v1 hold 200 0\nv1 end 200\n", 0.05),
    ])
    unchanged_replies = [item["ok"] for item in unchanged if "ok" in item]
    assert unchanged_replies == [True, True, True, True, False, True, True], unchanged
    assert any(item.get("event") == "hold_error" and item.get("code") == "state_unconfirmed" and
               item.get("holdControl") == "blocked" for item in unchanged)
    assert any(item.get("event") == "call" and item.get("state") == "terminated" for item in unchanged)

    late = run_case(["-DPHONE11_FAKE_HOLD_DELAYED_STATE"], [
        ("v1 hold 200 1\n", 0),
        ("v1 hold 200 0\n", 0),
        ("v1 hold 200 0\n", 0.02),
    ], wait_before_phase={1: "hold_error", 2: "hold_recovered_local"})
    assert [item["ok"] for item in late if "ok" in item] == [True, True, True, True, False, True, True], late
    assert_late_recovery(late)
    error_index = next(i for i, item in enumerate(late) if item.get("event") == "hold_error")
    recovery_index = next(i for i, item in enumerate(late) if item.get("event") == "hold_recovered")
    rejected = [i for i, item in enumerate(late) if item.get("ok") is False]
    assert len(rejected) == 1 and error_index < rejected[0] < recovery_index, late
    print("Phone11 Siprix hold reconciliation protocol test passed")


if __name__ == "__main__":
    main()
