#!/usr/bin/env python3
"""Generate private native build input; never print a license or accept it on argv."""
import argparse
import os
from pathlib import Path
import stat
import sys
import tempfile


class SilentParser(argparse.ArgumentParser):
    def error(self, message):
        raise ValueError()


def native_input(value, trial_only, platform_name):
    data = value.strip().encode("utf-8", errors="strict")
    if len(data) > 4096 or any(b < 32 or b == 127 for b in data) or (trial_only and data):
        raise ValueError()
    # POSIX mode bits do not establish a Windows ACL. Until that producer is
    # reviewed, Windows can generate only empty trial input.
    if platform_name == "nt" and data:
        raise ValueError()
    return data


def generate(language, output, trial_only=False):
    output = Path(output)
    expected = "Phone11SiprixBuildLicense.java" if language == "java" else "Phone11SiprixBuildLicense.h"
    if not output.is_absolute() or output.name != expected or output.parent.name != "phone11-native-license":
        raise ValueError()
    # Build paths must be canonical and the final directory exclusively private.
    if output.parent.resolve() != output.parent:
        raise ValueError()
    output.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = output.parent.lstat()
    if not stat.S_ISDIR(info.st_mode) or (os.name != "nt" and
            (info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700)):
        raise ValueError()
    if output.exists() or output.is_symlink():
        info = output.lstat()
        if not stat.S_ISREG(info.st_mode) or (os.name != "nt" and info.st_uid != os.getuid()):
            raise ValueError()
        # Invalidate old input even when the new value fails validation.
        output.unlink()
    data = native_input(os.environ.get("PHONE11_SIPRIX_LICENSE", ""), trial_only, os.name)
    if language == "java":
        numbers = ",".join(str(b if b < 128 else b - 256) for b in data)
        content = ("// Private generated build input. Never publish; not proof of entitlement.\n"
                   "package ai.phone11.siprix;\n"
                   "final class Phone11SiprixBuildLicense {\n"
                   "  private Phone11SiprixBuildLicense() {}\n"
                   "  static String value() { return new String(new byte[]{" + numbers +
                   "}, java.nio.charset.StandardCharsets.UTF_8); }\n}\n")
    else:
        encoded = "".join("\\x%02x" % b for b in data)
        content = ("// Private generated build input. Never publish; not proof of entitlement.\n"
                   "#pragma once\nnamespace Phone11NativeBuild {\n"
                   'inline const char* license() { return "' + encoded + '"; }\n}\n')
    fd, temporary = tempfile.mkstemp(prefix=".license-", dir=output.parent)
    try:
        with os.fdopen(fd, "w", encoding="ascii", newline="\n") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, output)
    finally:
        Path(temporary).unlink(missing_ok=True)


def main():
    try:
        # Invalid arguments also produce only the fixed failure line.
        parser = SilentParser(add_help=False, exit_on_error=False)
        parser.add_argument("--language", choices=("java", "cpp"), required=True)
        parser.add_argument("--output", required=True)
        parser.add_argument("--trial-only", action="store_true")
        arguments = parser.parse_args()
        generate(arguments.language, arguments.output, arguments.trial_only)
        return 0
    except BaseException:
        sys.stderr.write("E_PHONE11_NATIVE_LICENSE_INPUT\n")
        return 1


if __name__ == "__main__":
    sys.exit(main())
