"""Exercise private-pipe mute, hold/resume and DTMF with fake Siprix callbacks."""

import json
import pathlib
import subprocess
import tempfile
import time


NATIVE = pathlib.Path(__file__).resolve().parent


def send(process: subprocess.Popen[str], commands: str) -> None:
    assert process.stdin is not None
    process.stdin.write(commands)
    process.stdin.flush()


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="phone11-fake-siprix-controls-") as tmp:
        binary = pathlib.Path(tmp) / "helper"
        subprocess.run([
            "clang++", "-std=c++17", "-pthread", "-I", str(NATIVE / "test"),
            str(NATIVE / "phone11_siprix_helper.cpp"), "-o", str(binary),
        ], check=True, capture_output=True, text=True)
        process = subprocess.Popen([str(binary)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True)
        assert process.stdout is not None
        assert process.stderr is not None
        send(process, "v1 init\nv1 provision\ninvalid.example\n1020\n1020\nfake-secret\nTLS\n")
        initial = []
        while sum(line.get("ok") is True for line in initial) < 2:
            initial.append(json.loads(process.stdout.readline()))
        time.sleep(0.2)
        send(process, "v1 mute 200 1\nv1 hold 200 1\nv1 dtmf 200 5\nv1 answer 200\n")
        time.sleep(0.2)
        send(process, "v1 mute 200 1\nv1 mute 200 0\nv1 hold 200 1\nv1 hold 200 0\n")
        time.sleep(0.2)
        send(process, "v1 hold 200 1\nv1 hold 200 0\n")
        time.sleep(0.2)
        send(process, "v1 dtmf 200 12a#\nv1 dtmf 200 12x\nv1 mute 201 1\nv1 end 200\nv1 shutdown\n")
        assert process.stdin is not None
        process.stdin.close()
        output = process.stdout.read()
        errors = process.stderr.read()
        assert process.wait(timeout=5) == 0
        lines = initial + [json.loads(line) for line in output.splitlines()]
        replies = [line for line in lines if "ok" in line]
        # init/provision; three controls before connected; answer; two mute;
        # hold, duplicate in flight; idempotent hold, resume; DTMF and rejects;
        # end/shutdown.
        expected = [True, True, False, False, False, True, True, True,
                    True, False, True, True, True, False, False, True, True]
        assert [line["ok"] for line in replies] == expected, replies
        call_events = [line for line in lines if line.get("event") == "call"]
        assert any(line["state"] == "connected" and line["muted"] for line in call_events)
        assert any(line["state"] == "held" for line in call_events)
        assert call_events[-1]["state"] == "terminated"
        assert "fake-secret" not in output + errors
        assert "private-from" not in output + errors
        assert errors == ""
    print("Phone11 Siprix in-call controls protocol test passed")


if __name__ == "__main__":
    main()
