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
    assert len(lines) == 6, lines
    assert all(line["version"] == 1 for line in lines)
    assert lines[0]["initialized"] is False
    assert lines[1]["ok"] is True and lines[1]["initialized"] is True
    assert lines[2]["code"] == "unsupported_command"
    assert lines[3]["code"] == "invalid_command"
    assert lines[4]["initialized"] is True
    assert lines[5]["initialized"] is False
    assert secret_marker not in completed.stdout + completed.stderr
    assert completed.stderr == ""
    print("Phone11 Siprix helper bootstrap smoke test passed")


if __name__ == "__main__":
    main()
