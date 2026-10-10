#!/usr/bin/env python3
"""Overlay only the reviewed provisioning read path onto the live 9aab162 source.

The live 3006 bundle is reproduced byte-for-byte from that source before this
overlay is used. This script deliberately leaves all other server behavior at
the deployed revision, including Team Chat, meetings, and worker ownership.
"""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path


BASE_SHA256 = "c05212a529344504d75c4a7f563120da9858881a17726e9bee76fb855166d42f"
READ_PATH_SHA256 = "c6ff39c1970d08e4bfdcf17c66dc9976294206a24e3e7f434126937870dc98e7"


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def section(value: str, start: str, end: str) -> str:
    if value.count(start) != 1 or value.count(end) != 1:
        raise ValueError(f"source section boundary drift: {start!r}")
    before, rest = value.split(start, 1)
    middle, after = rest.split(end, 1)
    if not before or not middle or not after:
        raise ValueError(f"empty source section: {start!r}")
    return start + middle


def replace_section(base: str, current: str, start: str, base_end: str, current_end: str) -> str:
    old = section(base, start, base_end)
    new = section(current, start, current_end)
    if old == new:
        raise ValueError(f"no change in section: {start!r}")
    return base.replace(old, new, 1)


def overlay(base: str, current: str) -> str:
    if digest(base) != BASE_SHA256:
        raise ValueError("deployed base source hash does not match pinned 9aab162")
    if digest(current) != READ_PATH_SHA256:
        raise ValueError("reviewed read-path source hash changed")

    old_import = 'import { createSipCredentials, decryptSecret } from "./pbx/sip-secrets";'
    new_import = 'import { computeHA1, computeHA1B, createSipCredentials, decryptSecret } from "./pbx/sip-secrets";'
    if base.count(old_import) != 1:
        raise ValueError("SIP import drift")
    result = base.replace(old_import, new_import, 1)

    old_field = '  extension?: {\n    number: string;'
    new_field = '  extension?: {\n    /** Selected tenant-owned extension ID, bound to the same SIP row below. */\n    id?: number;\n    number: string;'
    if result.count(old_field) != 1:
        raise ValueError("extension interface drift")
    result = result.replace(old_field, new_field, 1)

    result = replace_section(result, current, "function getSipPassword(", "\nfunction buildConfig(", "\nfunction buildConfig(")
    result = replace_section(result, current, "function buildConfig(", "\nasync function applyPhoneProvisioningSchema(", "\nasync function applyPhoneProvisioningSchema(")
    result = replace_section(
        result, current, "export async function getPhoneConfig(",
        "\n/**\n * Pilot bootstrap for first-device tests.",
        "\n/**\n * Change a tenant-owned extension's SIP authentication",
    )
    if result.count("id: Number.isSafeInteger(ext.id)") != 1:
        raise ValueError("extension ID absent or duplicated")
    if "WHERE (ue.user_id = $1 OR e.user_id = $1 OR sa.user_id = $1)" in result:
        raise ValueError("old permissive ownership check survived")
    for marker in (
        "e.user_id = $1 AND sa.user_id = $1 AND ue.user_id = $1",
        "other_e.id <> e.id AND other_e.deleted_at IS NULL",
        "other_sa.status = 'active' AND other_sa.deleted_at IS NULL",
        "row.subscriber_ha1 !== ha1 || row.subscriber_ha1b !== ha1b",
    ):
        if result.count(marker) != 1:
            raise ValueError(f"required provisioning guard absent or duplicated: {marker}")
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", type=Path, required=True)
    parser.add_argument("--reviewed", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.resolve() != args.base.resolve():
        raise SystemExit("output must be the isolated base file; in-place overlay is intentional")
    base = args.base.read_text()
    result = overlay(base, args.reviewed.read_text())
    args.output.write_text(result)
    print(f"base_sha256={BASE_SHA256}")
    print(f"reviewed_read_path_sha256={READ_PATH_SHA256}")
    print(f"candidate_provisioning_sha256={digest(result)}")


if __name__ == "__main__":
    main()
