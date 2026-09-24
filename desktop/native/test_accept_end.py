"""Exercise the real helper protocol with a fake Siprix callback source.

The fake SDK fails Reject after Accept, while Bye terminates that accepted
call. This catches the incoming Answer → End-before-Connected regression
without a live PBX or credentials.
"""

import json
import pathlib
import subprocess
import tempfile
import time


NATIVE = pathlib.Path(__file__).resolve().parent


def run_scenario(binary: pathlib.Path, accept: bool) -> None:
    process = subprocess.Popen(
        [str(binary)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, text=True,
    )
    assert process.stdin is not None
    assert process.stdout is not None
    assert process.stderr is not None
    process.stdin.write("v1 init\nv1 provision\ninvalid.example\n1020\n1020\nfake-secret\nTLS\n")
    process.stdin.flush()
    initial = []
    while sum(line.get("ok") is True for line in initial) < 2:
        initial.append(json.loads(process.stdout.readline()))
    time.sleep(0.2)  # Fake SDK delivers incoming call after provisioning.
    if accept:
        process.stdin.write("v1 answer 200\n")
    process.stdin.write("v1 end 200\nv1 snapshot\nv1 shutdown\n")
    process.stdin.flush()
    process.stdin.close()
    output = process.stdout.read()
    errors = process.stderr.read()
    assert process.wait(timeout=5) == 0
    lines = initial + [json.loads(line) for line in output.splitlines()]
    assert errors == ""
    assert "fake-secret" not in output
    assert "private-from" not in output
    assert "private-to" not in output
    assert any(line.get("event") == "call" and line.get("state") == "incoming" for line in lines), lines
    assert any(line.get("event") == "call" and line.get("state") == "terminated" for line in lines), lines
    expected_ok = 6 if accept else 5  # init, provision, [answer], end, snapshot, shutdown
    assert sum(line.get("ok") is True for line in lines) == expected_ok, lines
    assert next(line for line in lines if "callId" in line and "ok" in line)["callId"] is None


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="phone11-fake-siprix-") as tmp:
        binary = pathlib.Path(tmp) / "phone11_siprix_helper_fake"
        subprocess.run([
            "clang++", "-std=c++17", "-pthread", "-I", str(NATIVE / "test"),
            str(NATIVE / "phone11_siprix_helper.cpp"), "-o", str(binary),
        ], check=True, capture_output=True, text=True)
        run_scenario(binary, accept=False)
        run_scenario(binary, accept=True)
    print("Phone11 Siprix accept/end transition test passed")


if __name__ == "__main__":
    main()
