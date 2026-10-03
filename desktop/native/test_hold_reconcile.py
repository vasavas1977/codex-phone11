"""Hold callback races and missing callbacks must not permit an unsafe toggle."""

import itertools
import json
import pathlib
import subprocess
import tempfile
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


def run_case(flags: list[str], phases: list[tuple[str, float]]) -> list[dict]:
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
        process.stdin.write("v1 init\nv1 provision\ninvalid.example\n1020\n1020\nfake-secret\nTLS\n")
        process.stdin.flush()
        initial = []
        while not any(item.get("state") == "incoming" for item in initial):
            initial.append(json.loads(process.stdout.readline()))
        process.stdin.write("v1 answer 200\n")
        process.stdin.flush()
        while not any(item.get("state") == "connected" for item in initial):
            initial.append(json.loads(process.stdout.readline()))
        for commands, delay in phases:
            process.stdin.write(commands)
            process.stdin.flush()
            time.sleep(delay)
        process.stdin.write("v1 shutdown\n")
        process.stdin.close()
        output = process.stdout.read()
        errors = process.stderr.read()
        assert process.wait(timeout=5) == 0
        assert errors == "", errors
        trace = initial + [json.loads(line) for line in output.splitlines()]
        assert all(private not in json.dumps(trace) for private in
                   ("fake-secret", "private-from", "private-to"))
        return trace


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
        ("v1 hold 200 1\n", 0.18),
        ("v1 hold 200 0\n", 0.14),
        ("v1 hold 200 0\n", 0.02),
    ])
    assert [item["ok"] for item in late if "ok" in item] == [True, True, True, True, False, True, True], late
    assert_late_recovery(late)
    print("Phone11 Siprix hold reconciliation protocol test passed")


if __name__ == "__main__":
    main()
