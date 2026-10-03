#!/usr/bin/env python3
"""Run existing meeting race tests on fresh, socket-only PostgreSQL 17 clusters."""
from pathlib import Path
from tempfile import TemporaryDirectory
import os
import subprocess


ROOT = Path(__file__).resolve().parent.parent
CASES = (
    ("meeting", 55439, "phone11_meeting_candidate",
     "server/meetings/channel-meeting-concurrency.pg.test.ts"),
    ("direct-meeting", 55440, "phone11_direct_meeting_candidate",
     "server/meetings/direct-meeting-concurrency.pg.test.ts"),
)


def command(args: list[str], *, env: dict[str, str] | None = None) -> None:
    subprocess.run(args, cwd=ROOT, env=env, check=True, timeout=60)


def main() -> None:
    version = subprocess.check_output(["postgres", "--version"], text=True)
    if not version.startswith("postgres (PostgreSQL) 17."):
        raise RuntimeError("PostgreSQL 17 is required")
    vitest = ROOT / "node_modules/.bin/vitest"
    if not vitest.is_file():
        raise RuntimeError("Install repository dependencies before rehearsal")
    username = os.environ.get("USER")
    if not username:
        raise RuntimeError("Local operating-system user is required")

    for name, port, database, test in CASES:
        socket = Path(f"/tmp/phone11-{name}-candidate-pg/socket")
        if socket.parent.is_symlink() or socket.is_symlink():
            raise RuntimeError(f"Refusing symlinked test socket: {socket}")
        parent_created = not socket.parent.exists()
        if parent_created:
            socket.parent.mkdir(mode=0o700)
        socket_created = not socket.exists()
        if socket_created:
            socket.mkdir(mode=0o700)
        if not socket.is_dir() or any(socket.iterdir()):
            raise RuntimeError(f"Refusing nonempty or invalid test socket: {socket}")
        try:
            with TemporaryDirectory(prefix=f"phone11-{name}-fresh-", dir="/tmp") as temporary:
                data = Path(temporary) / "data"
                log = Path(temporary) / "postgres.log"
                command(["initdb", "-A", "trust", "-U", username,
                         "--no-instructions", "-D", str(data)])
                started = False
                try:
                    command(["pg_ctl", "-D", str(data), "-l", str(log), "-o",
                             f"-c listen_addresses='' -c unix_socket_directories='{socket}' -p {port}",
                             "-w", "start"])
                    started = True
                    command(["createdb", "-h", str(socket), "-p", str(port),
                             "-U", username, database])
                    env = os.environ.copy()
                    env["PHONE11_TEST_DISPOSABLE_PG"] = "YES"
                    env["PHONE11_TEST_PG_SOCKET"] = str(socket)
                    command([str(vitest), "run", test], env=env)
                finally:
                    if started:
                        command(["pg_ctl", "-D", str(data), "-m", "immediate",
                                 "-w", "stop"])
        finally:
            if socket_created:
                socket.rmdir()
            if parent_created:
                socket.parent.rmdir()


if __name__ == "__main__":
    main()
