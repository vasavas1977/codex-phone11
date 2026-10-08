# Native license input hooks — 8 October 2026

Android and the shared macOS/Windows C++ helper can consume native build input;
this source change does not establish a paid Siprix license or production release
admission. The approved products and retained packages remain 60-second trials.
iOS configuration, its guarded daily-pilot request, and all store, foreground,
background/wake and trial capability gates remain unchanged.

The Python 3 standard-library generator reads only the build process's
`PHONE11_SIPRIX_LICENSE`. Do not supply a key through Gradle properties, CMake
`-D`, compiler definitions, command arguments, Expo public variables, JavaScript,
IPC, server configuration or a runtime environment input. Android's package-local
generated Java class supplies `IniData.setLicense` before `core.initialize`.
Real desktop CMake builds include a generated header and call `Ini_SetLicense`
before `Module_Initialize` only when its input is nonempty. Direct protocol test
compiles have no generated input, and CMake fake-SDK builds refuse nonempty input.

Generation runs before every build/compile, including incremental builds. Unset,
empty or whitespace-only input produces empty native input; removing a value
overwrites old input. Invalid input removes the prior generated file and fails
with a constant error. UTF-8 input is trimmed, bounded to 4096 bytes and rejects
embedded control bytes. These checks concern input shape, not license validity.
No key is passed to child argv, printed, returned by runtime APIs or included in
public source/provenance receipts. Android invokes the generator through a direct
child with both streams discarded, avoiding Gradle Exec environment diagnostics.

Generated output is confined to a canonical `phone11-native-license` build
directory: owner-only directory mode 0700 and atomic files mode 0600 on POSIX;
symlink/shared-directory targets refuse. Byte encoding is not encryption: keys
embedded in native clients remain extractable. Nonempty Windows generation
**fails closed**, because POSIX mode bits cannot establish Windows private ACL
custody. Empty Windows trial builds remain supported. A separately reviewed ACL
producer is needed before a Windows licensed input can be used.

A future authorized licensed build must establish vendor rights/SDK compatibility,
approved key delivery/embedding, private build outputs and diagnostics, and no
public/shared build caches containing generated or compiled key bytes. No such
producer, actual key, entitlement, purchase, signing identity, notarization,
redistribution right or device/call acceptance is admitted here. Successful SDK
initialization or a configured value never proves licensing; SDK errors and trial
behavior remain authoritative. Existing trial receipts and manifests must not be
rebound to different licensed native bytes.

The pinned Android AAR SHA256
`3173ee8bae7aa37d3be3b44f7533d43b4e4d8625110d1d2bd8d79367973c9198`
was admitted before compiler use. Real Android SDK/API and real RN 0.81.5 compiler
gates are distinct from the SDK gate's secondary RN declaration-stub check.
Retained real macOS SDK headers support object compilation; pinned Windows
`38fe11b14fb80c40bef725bbb61e6b1ea42a0d4f` header proof is not a Windows/MSVC
compile, link, package or runtime result.

Focused offline checks use synthetic markers only:

```sh
python3 tests/phone11-native-license-input.test.py
```

The independently reviewed source packet records exact hashes, actual commands,
exit results and limits before integration. Public references:
[Siprix initialization API](https://docs.siprix-voip.com/rst/api.html),
[pinned Android sample](https://raw.githubusercontent.com/siprix/SampleJava/80d198ed6179b45ff8cd8dad9b8086976b4197a0/app/src/main/java/com/siprix/sample/model/ObjModel.java),
[pinned Windows header](https://raw.githubusercontent.com/siprix/SiprixUA/38fe11b14fb80c40bef725bbb61e6b1ea42a0d4f/win/siprix.framework/include/Siprix.h).
