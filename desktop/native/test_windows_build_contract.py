"""Check the pinned Windows Siprix build inputs without running a SIP call."""

import pathlib
import struct
import sys


NATIVE = pathlib.Path(__file__).resolve().parent
REPO = NATIVE.parent.parent
PINNED_REVISION = "38fe11b14fb80c40bef725bbb61e6b1ea42a0d4f"
REQUIRED_API = (
    "Module_Create", "Module_Initialize", "Module_UnInitialize",
    "Account_Add", "Account_GetRegState", "Call_Invite", "Call_Accept",
    "Call_Reject", "Call_Bye", "Call_Hold", "Call_GetHoldState",
    "Call_MuteMic", "Call_SendDtmf", "Callback_SetCallHeld",
)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def require_amd64_dll(path: pathlib.Path) -> None:
    data = path.read_bytes()
    require(data[:2] == b"MZ" and len(data) >= 0x40, f"Not a PE DLL: {path}")
    header_offset = struct.unpack_from("<I", data, 0x3C)[0]
    require(data[header_offset:header_offset + 4] == b"PE\0\0", f"Invalid PE header: {path}")
    machine = struct.unpack_from("<H", data, header_offset + 4)[0]
    require(machine == 0x8664, f"Expected x64 DLL: {path}")


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: test_windows_build_contract.py PATH_TO_PINNED_SIPRIXUA")
    sdk = pathlib.Path(sys.argv[1])
    sdk_win = sdk / "win" / "siprix.framework"
    header = sdk_win / "include" / "Siprix.h"
    library = sdk_win / "lib" / "siprix.lib"
    require(header.is_file(), "Pinned Windows Siprix.h is missing")
    require(library.is_file(), "Pinned Windows siprix.lib is missing")
    declarations = header.read_text(encoding="utf-8")
    for name in REQUIRED_API:
        require(f"{name}(" in declarations, f"Windows SDK lacks {name}")
    for name in ("siprix.dll", "siprixMedia.dll"):
        require_amd64_dll(sdk_win / "lib" / name)

    cmake = (NATIVE / "CMakeLists.txt").read_text(encoding="utf-8")
    workflow = (REPO / ".github" / "workflows" / "phone11-desktop-helper-build.yml").read_text(encoding="utf-8")
    require("PHONE11_USE_FAKE_SDK" in cmake and "COPYONLY" in cmake,
            "Windows test-double build must not require or replace the vendor SDK")
    require("siprix.lib" in cmake and "siprixMedia.dll" in cmake,
            "Windows vendor import library or media DLL staging is missing")
    require(PINNED_REVISION in workflow and "windows-2022" in workflow and "-A x64" in workflow,
            "CI must pin the upstream SDK and build the Windows x64 target")
    require("PHONE11_USE_FAKE_SDK=ON" in workflow,
            "CI must compile the Windows test-double target separately")
    print("Phone11 Windows x64 Siprix source/build contract passed; no call or media was exercised")


if __name__ == "__main__":
    main()
