"""Compiled private-pipe transfer regressions; fake SDK only, no SIP/network."""
import json
import pathlib
import queue
import subprocess
import tempfile
import time
import threading

NATIVE = pathlib.Path(__file__).resolve().parent
INTENT = "12345678-1234-4234-8234-123456789abc"
OTHER = "12345678-1234-4234-8234-123456789abd"


class Pipe:
    def __init__(self, binary: pathlib.Path):
        self.process = subprocess.Popen([str(binary)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=subprocess.PIPE, text=True)
        self.watchdog = threading.Timer(30, self.process.kill)
        self.watchdog.start()
        self.lines = queue.Queue()
        self.rows = []
        self.output = []
        self.closed = False

        def collect() -> None:
            try:
                for line in self.process.stdout:
                    self.lines.put((line, json.loads(line)))
            except Exception as error:
                self.lines.put(error)
            finally:
                self.lines.put(None)

        self.reader = threading.Thread(target=collect, daemon=True)
        self.reader.start()

    def send(self, text: str) -> None:
        self.process.stdin.write(text)
        self.process.stdin.flush()

    def wait_for(self, predicate, label: str) -> None:
        deadline = time.monotonic() + 5
        while not predicate():
            remaining = deadline - time.monotonic()
            assert remaining > 0, f"Timed out waiting for {label}: {self.rows}"
            try:
                item = self.lines.get(timeout=remaining)
            except queue.Empty as error:
                raise AssertionError(f"Timed out waiting for {label}: {self.rows}") from error
            if isinstance(item, Exception):
                raise AssertionError(f"Invalid protocol frame while waiting for {label}") from item
            if item is None:
                self.closed = True
                assert predicate(), f"Helper closed before {label}: {self.rows}"
            else:
                line, row = item
                self.output.append(line)
                self.rows.append(row)

    def replies(self) -> list:
        return [row for row in self.rows if "ok" in row]

    def call(self, call_id: str, state: str) -> bool:
        return any(row.get("event") == "call" and row.get("callId") == call_id
                   and row.get("state") == state for row in self.rows)

    def finish(self) -> str:
        self.send("v1 shutdown\n")
        self.process.stdin.close()
        self.wait_for(lambda: self.closed, "protocol EOF")
        assert self.process.wait(timeout=5) == 0, "helper crashed or exceeded bounded protocol deadline"
        self.reader.join(timeout=1)
        assert not self.reader.is_alive(), "helper stdout did not close"
        return self.process.stderr.read()

    def close(self) -> None:
        self.watchdog.cancel()
        if self.process.poll() is None:
            self.process.kill()
        self.process.wait(timeout=5)
        self.reader.join(timeout=1)


def compile_helper(binary: pathlib.Path, flags: list[str]) -> None:
    subprocess.run(["clang++", "-std=c++17", "-pthread", "-I", str(NATIVE / "test"),
                    *flags, str(NATIVE / "phone11_siprix_helper.cpp"), "-o", str(binary)],
                   check=True, capture_output=True, text=True, timeout=30)


def run(mode: str, end_race: bool = False) -> None:
    with tempfile.TemporaryDirectory(prefix="phone11-transfer-") as directory:
        binary = pathlib.Path(directory) / "helper"
        flags = (["-D" + mode] if mode else []) + (["-DPHONE11_FAKE_TRANSFER_AFTER_END"] if end_race else [])
        compile_helper(binary, flags)
        pipe = Pipe(binary)
        try:
            pipe.send("v1 init\nv1 provision\ninvalid.example\n1020\n1020\nfake-secret\nTLS\n")
            pipe.wait_for(lambda: len(pipe.replies()) >= 2 and pipe.call("200", "incoming"), "provision and incoming 200")
            pipe.send(f"v1 transfer 200 {INTENT} 1021\nv1 answer 200\n")  # incoming refuses
            pipe.wait_for(lambda: len(pipe.replies()) >= 4 and pipe.call("200", "connected"), "answer and connected 200")
            pipe.send(f"v1 transfer 200 {INTENT} sip:1021\nv1 transfer 200 invalid 1021\n")
            pipe.send(f"v1 transfer 201 {INTENT} 1021\nv1 transfer 200 {INTENT} +6621234567\n")
            pipe.send(f"v1 transfer 200 {OTHER} 1022\nv1 mute 200 1\nv1 hold 200 1\n")
            pipe.wait_for(lambda: len(pipe.replies()) >= 11, "transfer and control replies")
            capable = mode != "PHONE11_FAKE_NO_TRANSFER_CAPABILITY"
            accepted = capable and mode != "PHONE11_FAKE_TRANSFER_REFUSED"
            expected_event = accepted and mode != "PHONE11_FAKE_TRANSFER_DROP" and not end_race
            if expected_event:
                pipe.wait_for(lambda: any(row.get("event") == "transfer" for row in pipe.rows), "transfer callback before End")
            pipe.send("v1 end 200\n")
            pipe.wait_for(lambda: len(pipe.replies()) >= 12 and pipe.call("200", "terminated"), "End reply and terminated 200")
            errors = pipe.finish()
            rows = pipe.rows
            replies = pipe.replies()
            assert (replies[0].get("blindTransfer") == "callback-v1-once") == capable
            # init/provision, incoming transfer refusal/answer, 3 invalid inputs,
            # one valid attempt, duplicate refusal, mute, hold (blocked after attempt), end/shutdown.
            assert [row["ok"] for row in replies] == [True, True, False, True, False, False, False,
                accepted, False, True, not capable, True, True], replies
            events = [row for row in rows if row.get("event") == "transfer"]
            assert len(events) == int(expected_event), events
            if events:
                assert events[0]["intentId"] == INTENT and events[0]["callId"] == "200"
                assert events[0]["statusCode"] == (486 if mode == "PHONE11_FAKE_TRANSFER_FAILED" else
                    200 if mode == "PHONE11_FAKE_TRANSFER_200" else 0)
            assert sum(row.get("state") == "incoming" for row in rows) == (2 if mode == "PHONE11_FAKE_TRANSFER_NEW_CALL" else 1)
            if mode == "PHONE11_FAKE_TRANSFER_NEW_CALL":
                assert [row for row in rows if row.get("callId") == "201"] == [{"version": 1, "event": "call", "callId": "201", "state": "incoming", "muted": False}]
            assert any(row.get("state") == "connected" and row.get("muted") for row in rows)
            assert "fake-secret" not in "".join(pipe.output) + errors
            assert errors == ("transferAfterEndCallbacks=3\n" if end_race else ""), errors
        finally:
            pipe.close()


def run_outgoing_reused_id() -> None:
    with tempfile.TemporaryDirectory(prefix="phone11-outgoing-reuse-") as directory:
        binary = pathlib.Path(directory) / "helper"
        compile_helper(binary, ["-DPHONE11_FAKE_OUTGOING_REUSED_ID"])
        pipe = Pipe(binary)
        try:
            pipe.send("v1 init\nv1 provision\ninvalid.example\n1020\n1020\nfake-secret\nTLS\n")
            pipe.wait_for(lambda: len(pipe.replies()) >= 2 and pipe.call("200", "incoming"), "provision and incoming 200")
            pipe.send("v1 answer 200\n")
            pipe.wait_for(lambda: len(pipe.replies()) >= 3 and pipe.call("200", "connected"), "answer and connected 200")
            pipe.send("v1 end 200\n")
            pipe.wait_for(lambda: len(pipe.replies()) >= 4 and pipe.call("200", "terminated"), "End reply and terminated 200")
            retired_at = len(pipe.rows)
            pipe.send("v1 dial 1021\n")
            pipe.wait_for(lambda: len(pipe.replies()) >= 5, "reused outgoing ID refusal")
            assert [row for row in pipe.rows if row.get("event") == "call_id_reused"] == [
                {"version": 1, "event": "call_id_reused"}]
            pipe.send("v1 snapshot\n")
            errors = pipe.finish()
            replies = pipe.replies()
            assert [row["ok"] for row in replies] == [True, True, True, True, False, True, True]
            assert replies[4]["code"] == "call_unavailable"
            assert replies[5]["callId"] is None
            assert not any(row.get("event") in ("call", "transfer") for row in pipe.rows[retired_at:])
            assert errors == "" and all(secret not in "".join(pipe.output) for secret in
                                        ("fake-secret", "private-from", "private-to", "1021"))
        finally:
            pipe.close()


if __name__ == "__main__":
    for mode in ["", "PHONE11_FAKE_TRANSFER_SYNC", "PHONE11_FAKE_TRANSFER_REFUSED",
                 "PHONE11_FAKE_TRANSFER_DROP", "PHONE11_FAKE_TRANSFER_FAILED",
                 "PHONE11_FAKE_TRANSFER_200", "PHONE11_FAKE_NO_TRANSFER_CAPABILITY"]:
        run(mode)
    run("", end_race=True)
    run("PHONE11_FAKE_TRANSFER_REUSED_ID", end_race=True)
    run("PHONE11_FAKE_TRANSFER_NEW_CALL", end_race=True)
    run_outgoing_reused_id()
    print("Phone11 compiled fake SDK transfer: 11 scenarios passed")
