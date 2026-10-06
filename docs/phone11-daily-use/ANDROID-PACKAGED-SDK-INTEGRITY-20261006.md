# Android packaged SDK integrity boundary

The foreground trial APK verifier previously required seven actual DEX class
definitions and four nonempty ARM SDK library entries. Those checks accepted
substituted library bytes. The verifier now additionally checks the full source
AAR against [sdk-lock.json](../../modules/phone11-siprix/android/sdk-lock.json)
and compares the SHA-256 of each packaged SDK library with its corresponding
`jni/` entry in that verified AAR. It does not execute or normalize native code.

The existing `--trial` caller obtains its source AAR from
`PHONE11_SIPRIX_ANDROID_AAR`; `--sdk-aar` supplies an explicit absolute path.
Missing, nonregular, unpinned or malformed source input fails closed. Ordinary
APK verification still requires runtime exclusion and needs no source AAR.
Duplicates, unsafe ZIP paths, missing/extra ABI libraries, nonregular native
entries and library mutations refuse. Limits are 64 MiB AAR, 512 MiB APK,
32 MiB per native entry, 64 MiB per DEX, 256 MiB total DEX and 100,000 ZIP entries.
Archive checks and the APK hash receipt use bounded immutable byte snapshots; library
hashing also checks the ZIP CRC and declared uncompressed size.

The trial's existing reversible Gradle block adds `keepDebugSymbols` for only
`**/libsiprix.so` and `**/libsiprixMedia.so`. This preserves the original SDK
bytes while other libraries retain their existing stripping configuration.
Default OFF, ABI filtering, registration, flags and iOS configuration are
unchanged; repeated ON/OFF restores unrelated Gradle content exactly.

The full source AAR SHA-256 remains
`3173ee8bae7aa37d3be3b44f7533d43b4e4d8625110d1d2bd8d79367973c9198`.
An offline check of private copies with the already installed NDK
`27.1.12297006` and its `llvm-strip --strip-unneeded` confirms why byte
preservation is necessary. Cached AGP `8.11.0` bytecode uses that strip option
and binds its strip task to the JNI `keepDebugSymbols` configuration.

| AAR library | Original SHA-256 | After that strip command |
| --- | --- | --- |
| arm64-v8a/libsiprix.so | `ad0bafcbda660b235f03948a927bf3c1dc7ba428ced30a80ec8d7572abaf7094` | `09a842998cec9cf8caf8095fa58fd3708e4278aec69612ef4d7c4631771bfd34` |
| arm64-v8a/libsiprixMedia.so | `bb3d00b985c89a86aef556e43e7ea896c5836af12e5d2cdbf5109457b6402719` | unchanged |
| armeabi-v7a/libsiprix.so | `8a4de099a953e673b2a0280943da95e083280807c1e2174edde1ab66e016ed53` | `e92c0573d5533bec85b1d3233195aa379d55ebdb5c4e32e360cf85119c26cd0e` |
| armeabi-v7a/libsiprixMedia.so | `8f3481e9bef59c5128829f849e263463acebfbcb9ebeede12ee850ab4f442dd3` | unchanged |

Historical Mobile CI at source `178f5a2` passed the earlier packaging gate and,
as reported by the lead's retained log review, ran `stripDebugDebugSymbols`.
It did not emit individual library hashes;
its actual packaged library equality is **not established** by these source,
strip or synthetic APK checks. A fresh hosted build must verify the new rule
against its actual APK and emit the source AAR and four packaged-library hashes.
That remains packaging evidence: it does not establish installation, native
runtime loading, calls, screen capture, background wake or production acceptance.
