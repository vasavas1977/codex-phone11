"""Hold callback races and missing callbacks must not permit an unsafe toggle."""

import json
import pathlib
import subprocess
import tempfile
import time


NATIVE = pathlib.Path(__file__).resolve().parent


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
        assert "fake-secret" not in output
        return initial + [json.loads(line) for line in output.splitlines()]


def main() -> None:
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
    error_index = next(i for i, item in enumerate(late) if item.get("event") == "hold_error")
    recovery_index = next(i for i, item in enumerate(late) if item.get("event") == "hold_recovered")
    remote_index = next(i for i, item in enumerate(late) if i > error_index and
                        item.get("event") == "call" and item.get("state") == "held")
    assert error_index < remote_index < recovery_index, late
    assert late[recovery_index]["code"] == "state_confirmed"
    assert late[recovery_index]["holdControl"] == "ready"
    print("Phone11 Siprix hold reconciliation protocol test passed")


if __name__ == "__main__":
    main()
