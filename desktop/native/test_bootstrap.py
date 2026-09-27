"""Source-only smoke test for a locally built Phone11 Siprix helper binary."""

import json
import subprocess
import sys


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: test_bootstrap.py PATH_TO_HELPER")

    secret_marker = "DO_NOT_ECHO_THIS_INPUT"
    commands = (
        "v1 snapshot\n"
        "v1 init\n"
        "v1 dial 1020\n"
        "v1 answer 1\n"
        "v1 end 1\n"
        "v1 provision\n"
        "invalid.example\n1020\n1020\nDO_NOT_ECHO_THIS_INPUT\nBAD\n"
        f"{secret_marker}\n"
        + "x" * 100
        + "\n"
        "v1 snapshot\n"
        "v1 shutdown\n"
    )
    completed = subprocess.run(
        [sys.argv[1]], input=commands, text=True, capture_output=True, timeout=12, check=True
    )
    lines = [json.loads(line) for line in completed.stdout.splitlines()]
    assert len(lines) == 10, lines
    assert all(line["version"] == 1 for line in lines)
    assert lines[0]["initialized"] is False
    assert lines[1]["ok"] is True and lines[1]["initialized"] is True
    assert all(line["code"] == "call_unavailable" for line in lines[2:5])
    assert lines[5]["code"] == "provisioning_failed"
    assert lines[6]["code"] == "unsupported_command"
    assert lines[7]["code"] == "invalid_command"
    assert lines[8]["initialized"] is True and lines[8]["registered"] is False
    assert lines[8]["callId"] is None
    assert lines[9]["initialized"] is False
    assert secret_marker not in completed.stdout + completed.stderr
    assert completed.stderr == ""
    # An incomplete secret-bearing frame closes the process so the next line
    # cannot be misinterpreted as an ordinary command.
    malformed = subprocess.run(
        [sys.argv[1]], input="v1 init\nv1 provision\ninvalid.example\n1020\n",
        text=True, capture_output=True, timeout=12, check=True,
    )
    malformed_lines = [json.loads(line) for line in malformed.stdout.splitlines()]
    assert len(malformed_lines) == 2, malformed_lines
    assert malformed_lines[1]["code"] == "invalid_provisioning"
    assert malformed.stderr == ""
    print("Phone11 Siprix helper bootstrap smoke test passed")


if __name__ == "__main__":
    main()
