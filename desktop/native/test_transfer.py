"""Compiled private-pipe transfer regressions; fake SDK only, no SIP/network."""
import json
import pathlib
import subprocess
import tempfile
import time
import threading

NATIVE = pathlib.Path(__file__).resolve().parent
INTENT = "12345678-1234-4234-8234-123456789abc"
OTHER = "12345678-1234-4234-8234-123456789abd"


def run(mode: str, end_race: bool = False) -> None:
    with tempfile.TemporaryDirectory(prefix="phone11-transfer-") as directory:
        binary = pathlib.Path(directory) / "helper"
        subprocess.run(["clang++", "-std=c++17", "-pthread", "-I", str(NATIVE / "test"),
                        *(["-D" + mode] if mode else []), str(NATIVE / "phone11_siprix_helper.cpp"),
                        "-o", str(binary)], check=True, capture_output=True, text=True)
        process = subprocess.Popen([str(binary)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True)
        watchdog = threading.Timer(8, process.kill)
        watchdog.start()
        def send(text: str) -> None:
            process.stdin.write(text)
            process.stdin.flush()
        send("v1 init\nv1 provision\ninvalid.example\n1020\n1020\nfake-secret\nTLS\n")
        initial = []
        while sum(row.get("ok") is True for row in initial) < 2:
            initial.append(json.loads(process.stdout.readline()))
        time.sleep(.2)
        send(f"v1 transfer 200 {INTENT} 1021\nv1 answer 200\n")  # incoming refuses
        time.sleep(.2)
        send(f"v1 transfer 200 {INTENT} sip:1021\nv1 transfer 200 invalid 1021\n")
        send(f"v1 transfer 201 {INTENT} 1021\nv1 transfer 200 {INTENT} +6621234567\n")
        send(f"v1 transfer 200 {OTHER} 1022\nv1 mute 200 1\nv1 hold 200 1\n")
        if end_race:
            send("v1 end 200\n")
        time.sleep(.25)
        if not end_race:
            send("v1 end 200\n")
        send("v1 shutdown\n")
        process.stdin.close()
        output = process.stdout.read()
        errors = process.stderr.read()
        code = process.wait(timeout=5)
        watchdog.cancel()
        assert code == 0, "helper crashed or exceeded bounded protocol deadline"
        rows = initial + [json.loads(line) for line in output.splitlines()]
        replies = [row for row in rows if "ok" in row]
        capable = mode != "PHONE11_FAKE_NO_TRANSFER_CAPABILITY"
        assert (replies[0].get("blindTransfer") == "callback-v1-once") == capable
        accepted = capable and mode != "PHONE11_FAKE_TRANSFER_REFUSED"
        # init/provision, incoming transfer refusal/answer, 3 invalid inputs,
        # one valid attempt, duplicate refusal, mute, hold (blocked after attempt), end/shutdown.
        assert [row["ok"] for row in replies] == [True, True, False, True, False, False, False,
            accepted, False, True, not capable, True, True], replies
        events = [row for row in rows if row.get("event") == "transfer"]
        expected_event = accepted and mode != "PHONE11_FAKE_TRANSFER_DROP" and not end_race
        assert len(events) == int(expected_event), events
        if events:
            assert events[0]["intentId"] == INTENT and events[0]["callId"] == "200"
            assert events[0]["statusCode"] == (486 if mode == "PHONE11_FAKE_TRANSFER_FAILED" else
                200 if mode == "PHONE11_FAKE_TRANSFER_200" else 0)
        assert sum(row.get("state") == "incoming" for row in rows) == (2 if mode == "PHONE11_FAKE_TRANSFER_NEW_CALL" else 1)
        if mode == "PHONE11_FAKE_TRANSFER_NEW_CALL":
            assert [row for row in rows if row.get("callId") == "201"] == [{"version": 1, "event": "call", "callId": "201", "state": "incoming", "muted": False}]
        assert any(row.get("state") == "connected" and row.get("muted") for row in rows)
        assert "fake-secret" not in output + errors and errors == ""


if __name__ == "__main__":
    for mode in ["", "PHONE11_FAKE_TRANSFER_SYNC", "PHONE11_FAKE_TRANSFER_REFUSED",
                 "PHONE11_FAKE_TRANSFER_DROP", "PHONE11_FAKE_TRANSFER_FAILED",
                 "PHONE11_FAKE_TRANSFER_200", "PHONE11_FAKE_NO_TRANSFER_CAPABILITY"]:
        run(mode)
    run("", end_race=True)
    run("PHONE11_FAKE_TRANSFER_REUSED_ID", end_race=True)
    run("PHONE11_FAKE_TRANSFER_NEW_CALL", end_race=True)
    print("Phone11 compiled fake SDK transfer: 10 scenarios passed")
