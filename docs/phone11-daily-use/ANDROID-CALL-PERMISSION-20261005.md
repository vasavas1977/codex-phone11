# Android foreground trial microphone recovery — 5 October 2026

The isolated Android Siprix foreground trial checks `RECORD_AUDIO` on user Dial
and Answer. If needed, it requests the OS permission before sending a call
command. Repeated identical actions share the pending permission/command;
conflicting actions are refused. Denial leaves a retry available and sends no
native call command. A permanently denied permission requires Android Settings.

Callbacks may publish the outgoing call or move the answered call to active
before the native command promise resolves. An identical pending gesture joins
that command using its captured account and call lifetime, rather than requiring
fresh Dial/Answer eligibility. A temporary call-store observer binds the first
matching outgoing callback at the command boundary; replacement, takeover or
termination invalidates that join, including reuse of an ID for the same peer.
The observer is removed when the command settles or the provider unmounts.

Dial obtains permission before acquiring SIP media ownership. Answer retains
the ringing-call lease already acquired by the incoming subscription; denial
does not release that lease, answer the call or send Hangup. The existing
CallKeep initialization and display behavior remain unchanged, including its
possible initial permission prompt during foreground registration.

After asynchronous permission, ownership and initialization steps, the trial
path rechecks the exact authenticated user and assigned account. Answer also
rechecks the incoming call's lifetime and ringing status, including native ID
reuse. Logout, account replacement, termination, another incoming call or
provider unmount invalidates the pending action. iOS/CallKit and ordinary
Android builds retain their existing call paths.

Focused tests mock the OS permission and native call interfaces. They establish
source behavior only. No device prompt, APK installation, call, audio or provider
acceptance is established; the 60-second trial and foreground-only limits remain.
