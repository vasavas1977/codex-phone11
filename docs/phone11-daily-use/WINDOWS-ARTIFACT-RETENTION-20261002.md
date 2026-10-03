# Windows helper artifact retention

The `windows-x64` job in `.github/workflows/phone11-desktop-helper-build.yml`
retains exactly our `phone11_siprix_helper.exe` and `integrity-receipt.json` for
seven days after a successful `workflow_dispatch` in
`vasavas1977/codex-phone11`. Pull-request builds still compile and run the
existing real-helper and protocol-double tests, without uploading these files.
The repository is public: the helper and receipt are publicly downloadable by
signed-in GitHub readers. This is **not private binary retention**.

Only our dynamically linked application helper is retained. CMake compiles
`phone11_siprix_helper.cpp` and links the pinned vendor's import library; the
official Windows integration guide places the SDK implementation in separate
DLLs. Inspection of that pinned import library found AMD64 import objects for
`siprix.dll` and import/debug metadata, without implementation code sections.
The consumer header declares imported APIs and interfaces. The artifact does
not contain proprietary SDK implementation or user data. Vendor DLLs, headers,
import libraries, PDBs, logs, configuration, sessions, tokens, and license keys
are excluded by an exact two-file upload list, rather than a directory glob.

Before staging, the job checks the source SHA and unchanged native sources,
the clean vendor checkout, and these pinned inputs:

| Input | Pin |
| --- | --- |
| SiprixUA revision | `38fe11b14fb80c40bef725bbb61e6b1ea42a0d4f` |
| `siprix.lib` SHA-256 | `cca002e86c2898d9cda336406f3121e8c5cfbdffeed775e5c28784d14091060d` |
| `siprix.dll` SHA-256 | `55869c2f83b8ca08659e1ecd40d7542b54563ed8452bb1a49a1fa9d80eeb2cd4` |
| `siprixMedia.dll` SHA-256 | `0ebd1bddf590002a83c0059e4064bbae80e91bbd9827a68546280af45452887b` |
| Upload action | `actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02` |

The EXE must be a bounded AMD64 PE32+ executable, dynamically importing
`siprix.dll` and only the permitted Windows/MSVC runtime modules. Embedded
resources may contain only a bounded XML application manifest. Invalid or
missing inputs stop staging. The existing bootstrap test runs again with
captured output; only its exact success marker and empty stderr are accepted.
No captured output is retained. The helper hash must remain unchanged. A fresh
staging directory, verified copy hash, exact filename check, successful-step
upload condition, and `if-no-files-found: error` prevent partial or stale uploads.

The non-secret receipt records source/vendor revisions, run ID and attempt,
EXE hash/size/PE/import metadata, source/header/input hashes, and successful
bootstrap status. It is build provenance, not the application resource
manifest and not a Windows calling acceptance receipt. Dispatch must use the
independently reviewed committed workflow and source; the resulting receipt
and downloaded EXE hash must be checked against that run before packaging.

The existing `desktop/app/scripts/package-windows-local.ts` accepts this EXE
through `PHONE11_WINDOWS_HELPER_EXE`, plus a separate genuine official SiprixUA
checkout through `PHONE11_SIPRIX_SDK_ROOT`. It already checks the vendor revision
and DLL hashes above, and builds its own resource integrity manifest. Fetch the
SDK directly from the pinned official repository into an external local input
directory; never redistribute the SDK through this public Actions artifact.
The verified local checkout is currently
`~/Library/Application Support/Phone11/desktop-windows-inputs-20261002/SiprixUA`.
Packaging remains separately authorized because it rewrites shared app `dist`
and may fetch the pinned Electron Windows runtime. No package or hosted
retention run is proven by this source change.

The existing 60-second trial limit remains. This does not establish Windows
loader behavior, sign-in, SIP registration, audio, call controls, trial cutoff,
signing, or permission to distribute a package containing vendor DLLs. Those
remain separate Windows-device and release gates; confirm SDK distribution
terms before sharing a bundled package.

## 4 October read-only custody refresh

The source-only boundary above is historical. Successful manual
[run 36904369975](https://github.com/vasavas1977/codex-phone11/actions/runs/36904369975)
at `e9241df8a6b1d89cdeedbc6eecff73714a6cfcd4` retained artifact
`11183430872`, unexpired until 8 October 2026 at 18:07:34 UTC. Its local archive
matches GitHub's SHA-256 `e5f8be1453848eba71669d30182e5d96b058c89b85828a4725df3d3334743dd6`.
The helper SHA-256 is `595d49fbffb003957c58777ed54efb963b869d0f0661b6717f40a33834f866c9`.

An existing local unsigned portable trial ZIP also remains retained at
`~/Library/Application Support/Phone11/desktop-windows-packages/avatar-history-e9241df-20261002/Phone11-Windows-x64-Trial-e9241df.zip`.
It is 169,099,116 bytes, SHA-256
`aaa162ddd3b199ed60f18566ba2e748bfc2d61e1a4ec451839c24d47a05ca694`.
Twenty-four read-only checks passed, including receipt/run/source binding,
Windows CRLF source hashes, package manifest/ASAR/helper hashes, ZIP integrity
and all 78 archived files matching the retained directory. Desktop app/native
source and the helper workflow are unchanged from `e9241df` through `4854985`.
No executable was run or downloaded during this refresh.

Reuse these inputs; a new helper build is unnecessary for custody. Windows
loader/sign-in/SIP/audio/controls/trial-cutoff acceptance, release signing,
installer preparation and vendor redistribution terms remain separate gates.

References: [official Windows integration](https://docs.siprix-voip.com/rst/integration.html#windows),
[SDK license](https://docs.siprix-voip.com/rst/license.html),
[trial description](https://www.siprix-voip.com/download/),
[GitHub artifact access](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts),
and [Microsoft PE format](https://learn.microsoft.com/en-us/windows/win32/debug/pe-format).
