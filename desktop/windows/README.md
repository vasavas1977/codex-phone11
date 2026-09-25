# Windows x64 local trial package

The [Siprix Windows integration guide](https://docs.siprix-voip.com/rst/integration.html#windows)
specifies `siprix.dll` and `siprixMedia.dll` beside the application executable.
The [official trial description](https://www.siprix-voip.com/download/) says calls
are limited to 60 seconds. The [SDK license](https://docs.siprix-voip.com/rst/license.html)
permits an SDK copy with an application copy and also places restrictions on
transferring the SDK. This workflow produces a **local, unsigned trial** only;
confirm distribution terms with Siprix before sharing a package.

1. On Windows with Visual Studio 2022 x64 tools, clone
   `https://github.com/siprix/SiprixUA` outside the Phone11 repository and check
   out `38fe11b14fb80c40bef725bbb61e6b1ea42a0d4f`. Run
   `python desktop/native/test_windows_build_contract.py C:\path\to\SiprixUA`.
   Then build the Phone11 helper:

   ```powershell
   cmake -S desktop/native -B "$env:TEMP\phone11-helper" -G "Visual Studio 17 2022" -A x64 "-DSIPRIX_SDK_ROOT=C:\path\to\SiprixUA"
   cmake --build "$env:TEMP\phone11-helper" --config Release
   python desktop/native/test_bootstrap.py "$env:TEMP\phone11-helper\Release\phone11_siprix_helper.exe"
   ```

2. Transfer the built `phone11_siprix_helper.exe` to a private path on the Mac.
   Keep the SDK checkout at the pinned revision outside the Phone11 repository.
   Do not add the SDK DLLs, helper EXE, or a SIP credential to Git.

3. From the Phone11 repository on macOS arm64, with committed desktop app
   source and installed Node dependencies, create an output directory outside
   the repository and SDK checkout. Set absolute paths and a bare HTTPS API
   origin, then run:

   ```sh
   mkdir -p "$HOME/Downloads/Phone11 Windows Trial Local Package"
   PHONE11_SIPRIX_SDK_ROOT=/private/tmp/phone11-siprixua-windows-trial \
   PHONE11_WINDOWS_HELPER_EXE=/private/tmp/phone11_siprix_helper.exe \
   PHONE11_PACKAGE_OUTPUT="$HOME/Downloads/Phone11 Windows Trial Local Package" \
   PHONE11_API_ORIGIN=https://api.phone11.ai/ \
   npm --prefix desktop/app run package:win:local
   ```

The script requires an x64 PE helper and the pinned official SiprixUA checkout.
It validates the two vendor DLLs against SHA-256 hashes, creates a temporary
resource tree and manifest, builds the app with the Windows manifest hash, and
cross-packages an unsigned Electron Windows x64 directory. It verifies the
packaged helper tree and embedded manifest hash before reporting the output.
Missing, changed, or wrong-architecture files stop packaging. Temporary vendor
copies are removed when the script finishes.

A Mac cannot run this Windows helper or prove SIP registration, audio, the
60-second disconnect, or Windows loader dependencies. On a Windows x64 test
machine, inspect the unsigned package, launch it, confirm the trial notice,
then test sign-in, SIP registration, an inbound and outbound call, two-way
audio, call controls, and the trial cutoff with authorized test credentials.
Signing and distribution require separate release review.
