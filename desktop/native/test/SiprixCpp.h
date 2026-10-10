#pragma once

// Minimal fake of the pinned C++ API for helper protocol tests. The release
// target includes the vendor header from SIPRIX_SDK_ROOT, never this header.
#include <chrono>
#include <cstdio>
#include <cstdint>
#include <thread>

namespace Siprix {
using AccountId = std::uint32_t;
using CallId = std::uint32_t;
enum class ErrorCode { EOK, ENotIncoming, ECallAlreadySwitched };
enum class LogLevel { NoLog };
enum class RegState { Success, Failed, Removed, InProgress };
enum class SipTransport { UDP, TCP, TLS };
enum class SecureMedia { Disabled, SdesSrtp, DtlsSrtp };
enum class HoldState { None, Local, Remote, LocalAndRemote };
enum class DtmfMethod { DTMF_RTP, DTMF_INFO };
struct ISiprixModule { bool initialized = false; bool accepted = false; bool held = false; bool muted = false; };
struct IniData {};
struct AccData { SecureMedia secureMedia = SecureMedia::Disabled; };
struct DestData {};
using OnAccountRegState = void (*)(AccountId, RegState, const char*);
using OnCallIncoming = void (*)(CallId, AccountId, bool, const char*, const char*);
using OnCallProceeding = void (*)(CallId, const char*);
using OnCallConnected = void (*)(CallId, const char*, const char*, bool);
using OnCallTerminated = void (*)(CallId, std::uint32_t);
using OnCallTransferred = void (*)(CallId, std::uint32_t);
inline OnCallTransferred transferredCallback = nullptr;
using OnCallSwitched = void (*)(CallId);
inline OnCallSwitched switchedCallback = nullptr;
inline CallId switchedCall = 0;
using OnCallRedirected = void (*)(CallId, CallId, const char*);
inline OnCallRedirected redirectedCallback = nullptr;
inline bool redirectedLegAlive = false;
inline unsigned redirectByeCount = 0, originalByeCount = 0, consultByeCount = 0;
inline bool consultAccepted = false;
inline bool consultMuted = false;
using OnCallHeld = void (*)(CallId, HoldState);
inline OnCallIncoming incomingCallback = nullptr;
inline OnCallTerminated terminatedCallback = nullptr;
inline OnCallConnected connectedCallback = nullptr;
inline OnCallHeld heldCallback = nullptr;
inline ISiprixModule module;
inline IniData ini;
inline AccData account;
inline DestData destination;
inline ISiprixModule* Module_Create() { return &module; }
inline ErrorCode Module_Initialize(ISiprixModule* m, IniData*) { m->initialized = true; return ErrorCode::EOK; }
inline ErrorCode Module_UnInitialize(ISiprixModule* m) {
#ifdef PHONE11_FAKE_WARM_REDIRECT
  if (m->initialized) std::fprintf(stderr,"redirectBye=%u originalBye=%u consultBye=%u hiddenBeforeShutdown=%d\n",redirectByeCount,originalByeCount,consultByeCount,int(redirectedLegAlive));
#endif
  m->initialized = false; redirectedLegAlive = false; return ErrorCode::EOK;
}
inline bool Module_IsInitialized(ISiprixModule* m) { return m->initialized; }
inline IniData* Ini_GetDefault() { return &ini; }
inline void Ini_SetTlsVerifyServer(IniData*, bool) {}
inline void Ini_SetLogLevelFile(IniData*, LogLevel) {}
inline void Ini_SetLogLevelIde(IniData*, LogLevel) {}
inline void Ini_SetSingleCallMode(IniData*, bool) {}
inline ErrorCode Callback_SetAccountRegState(ISiprixModule*, OnAccountRegState) { return ErrorCode::EOK; }
inline ErrorCode Callback_SetCallIncoming(ISiprixModule*, OnCallIncoming cb) { incomingCallback = cb; return ErrorCode::EOK; }
inline ErrorCode Callback_SetCallProceeding(ISiprixModule*, OnCallProceeding) { return ErrorCode::EOK; }
inline ErrorCode Callback_SetCallConnected(ISiprixModule*, OnCallConnected cb) { connectedCallback = cb; return ErrorCode::EOK; }
inline ErrorCode Callback_SetCallTransferred(ISiprixModule*, OnCallTransferred cb) {
#ifdef PHONE11_FAKE_NO_TRANSFER_CAPABILITY
  return ErrorCode::ENotIncoming;
#else
  transferredCallback = cb; return ErrorCode::EOK;
#endif
}
inline ErrorCode Callback_SetCallRedirected(ISiprixModule*, OnCallRedirected cb) {
#ifdef PHONE11_FAKE_NO_REDIRECT_CAPABILITY
  return ErrorCode::ENotIncoming;
#else
  redirectedCallback = cb; return ErrorCode::EOK;
#endif
}
inline ErrorCode Callback_SetCallSwitched(ISiprixModule*, OnCallSwitched cb) {
#ifdef PHONE11_FAKE_NO_WARM_CAPABILITY
  return ErrorCode::ENotIncoming;
#else
  switchedCallback = cb; return ErrorCode::EOK;
#endif
}
inline ErrorCode Callback_SetCallHeld(ISiprixModule*, OnCallHeld cb) { heldCallback = cb; return ErrorCode::EOK; }
inline ErrorCode Callback_SetCallTerminated(ISiprixModule*, OnCallTerminated cb) { terminatedCallback = cb; return ErrorCode::EOK; }
inline AccData* Acc_GetDefault() { return &account; }
inline void Acc_SetSipServer(AccData*, const char*) {}
inline void Acc_SetSipExtension(AccData*, const char*) {}
inline void Acc_SetSipAuthId(AccData*, const char*) {}
inline void Acc_SetSipPassword(AccData*, const char*) {}
inline void Acc_SetExpireTime(AccData*, std::uint32_t) {}
inline void Acc_SetTranspProtocol(AccData*, SipTransport) {}
inline void Acc_SetSecureMediaMode(AccData* a, SecureMedia mode) { a->secureMedia = mode; }
inline ErrorCode Account_Add(ISiprixModule* m, AccData* a, AccountId* id) {
  if (a->secureMedia != SecureMedia::SdesSrtp) return ErrorCode::ENotIncoming;
  *id = 1;
  std::thread([m] {
    std::this_thread::sleep_for(std::chrono::milliseconds(70));
    if (m->initialized && incomingCallback) incomingCallback(200, 1, false, "private-from", "private-to");
  }).detach();
  return ErrorCode::EOK;
}
inline ErrorCode Account_GetRegState(ISiprixModule*, AccountId, RegState* state) {
  *state = RegState::Success; return ErrorCode::EOK;
}
inline DestData* Dest_GetDefault() { return &destination; }
inline void Dest_SetAccountId(DestData*, AccountId) {}
inline void Dest_SetExtension(DestData*, const char*) {}
inline void Dest_SetVideoCall(DestData*, bool) {}
inline ErrorCode Call_Invite(ISiprixModule*, DestData*, CallId* id) {
#ifdef PHONE11_FAKE_OUTGOING_REUSED_ID
  *id = 200;
#else
  *id = 201;
#endif
#if PHONE11_DESKTOP_WARM_TRANSFER_SOURCE_ENABLED
  consultAccepted = true;
#ifndef PHONE11_FAKE_WARM_INVITE_DROP
#ifdef PHONE11_FAKE_WARM_INVITE_SYNC
  if (connectedCallback) connectedCallback(*id, "private", "private", false);
#else
  const CallId call = *id;
  std::thread([call] { std::this_thread::sleep_for(std::chrono::milliseconds(70)); if (module.initialized && connectedCallback) connectedCallback(call, "private", "private", false); }).detach();
#endif
#endif
#endif
  return ErrorCode::EOK;
}
inline ErrorCode Call_Accept(ISiprixModule* m, CallId id, bool) {
  if (id != 200) return ErrorCode::ENotIncoming;
  m->accepted = true;
  std::thread([m, id] {
    std::this_thread::sleep_for(std::chrono::milliseconds(70));
    if (m->initialized && connectedCallback) connectedCallback(id, "private-from", "private-to", false);
  }).detach();
  return ErrorCode::EOK;
}
inline ErrorCode Call_MuteMic(ISiprixModule* m, CallId id, bool value) {
#if PHONE11_DESKTOP_WARM_TRANSFER_SOURCE_ENABLED
  if (id == 201 && consultAccepted) {
#ifdef PHONE11_FAKE_WARM_INITIAL_MUTE_REFUSED_SYNC
    if (value) { if (connectedCallback) connectedCallback(id,"private","private",false); return ErrorCode::ENotIncoming; }
#endif
#ifdef PHONE11_FAKE_WARM_UNMUTE_REFUSED_SYNC
    if (!value) { if (connectedCallback) connectedCallback(id,"private","private",false); return ErrorCode::ENotIncoming; }
#endif
    consultMuted = value;
#ifdef PHONE11_FAKE_WARM_REDIRECT
    if (!value) {
      redirectedLegAlive = true;
      if (redirectedCallback) {
#ifdef PHONE11_FAKE_WARM_REDIRECT_RETIRED
        if (terminatedCallback) terminatedCallback(200,200);
        redirectedCallback(201,200,"private-refer-to"); // old original ID cannot identify its reused incarnation
#elif defined(PHONE11_FAKE_WARM_REDIRECT_OVERLAP)
        redirectedCallback(201, 200, "private-refer-to");
#elif defined(PHONE11_FAKE_WARM_REDIRECT_UNKNOWN)
        redirectedCallback(999, 202, "private-refer-to");
#elif defined(PHONE11_FAKE_WARM_REDIRECT_ZERO)
        redirectedCallback(201, 0, "private-refer-to");
#else
        redirectedCallback(201, 202, "private-refer-to");
        redirectedCallback(999, 202, "private-refer-to"); // retired duplicate never ends a reused leg
#endif
      }
      if (connectedCallback) connectedCallback(202,"private","private",false);
    }
#endif
    return ErrorCode::EOK;
  }
#endif
  if (id == 202 && redirectedLegAlive) {
#ifdef PHONE11_FAKE_WARM_REDIRECT_MUTE_REFUSED
    return ErrorCode::ENotIncoming;
#else
    return ErrorCode::EOK;
#endif
  }
  if (id != 200 || !m->accepted) return ErrorCode::ENotIncoming;
  m->muted = value;
  return ErrorCode::EOK;
}
inline ErrorCode Call_GetHoldState(ISiprixModule* m, CallId id, HoldState* state) {
#if PHONE11_DESKTOP_WARM_TRANSFER_SOURCE_ENABLED
  if (id == 201 && consultAccepted) { *state = HoldState::None; return ErrorCode::EOK; }
#endif
  if (id != 200 || !m->accepted) return ErrorCode::ENotIncoming;
#ifdef PHONE11_FAKE_WARM_REMOTE_HOLD
  *state = m->held ? (consultAccepted ? HoldState::LocalAndRemote : HoldState::Local) : (consultAccepted ? HoldState::Remote : HoldState::None);
#else
  *state = m->held ? HoldState::Local : HoldState::None;
#endif
  return ErrorCode::EOK;
}
inline ErrorCode Call_Hold(ISiprixModule* m, CallId id) {
  if (id != 200 || !m->accepted) return ErrorCode::ENotIncoming;
#ifdef PHONE11_FAKE_HOLD_DELAYED_STATE
  const bool nextHeld = !m->held;
  std::thread([m, id, nextHeld] {
    std::this_thread::sleep_for(std::chrono::milliseconds(160));
    // Before the delayed local transition, a remote hold does not remove an
    // existing local hold. Resume is confirmed only by the final None callback.
    if (m->initialized && heldCallback) heldCallback(id, nextHeld ? HoldState::Remote : HoldState::LocalAndRemote);
    std::this_thread::sleep_for(std::chrono::milliseconds(90));
    if (m->initialized) {
      m->held = nextHeld;
      if (heldCallback) heldCallback(id, nextHeld ? HoldState::Local : HoldState::None);
    }
  }).detach();
  return ErrorCode::EOK;
#endif
#ifndef PHONE11_FAKE_HOLD_NO_STATE_CHANGE
  m->held = !m->held;
#endif
#ifdef PHONE11_FAKE_WARM_REMOTE_HOLD
  const HoldState finalState = m->held ? HoldState::Local : HoldState::Remote;
#else
  const HoldState finalState = m->held ? HoldState::Local : HoldState::None;
#endif
#ifdef PHONE11_FAKE_REMOTE_FIRST
  if (heldCallback) heldCallback(id, HoldState::Remote);
#endif
#ifndef PHONE11_FAKE_DROP_HOLD_CALLBACK
  std::thread([m, id, finalState] {
    std::this_thread::sleep_for(std::chrono::milliseconds(70));
    if (m->initialized && heldCallback) heldCallback(id, finalState);
  }).detach();
#endif
  return ErrorCode::EOK;
}
inline ErrorCode Mixer_SwitchToCall(ISiprixModule*, CallId id) {
#ifdef PHONE11_FAKE_WARM_FOCUS_DROP
  return ErrorCode::EOK;
#else
  if (switchedCall == id) return ErrorCode::ECallAlreadySwitched;
  switchedCall = id;
  if (switchedCallback) switchedCallback(id);
#ifdef PHONE11_FAKE_WARM_FOCUS_REFUSED_SYNC
  if (id == 201) return ErrorCode::ENotIncoming;
#endif
#ifdef PHONE11_FAKE_WARM_RESTORE_REFUSED_SYNC
  if (id == 200) return ErrorCode::ENotIncoming;
#endif
  return ErrorCode::EOK;
#endif
}
inline ErrorCode Call_TransferAttended(ISiprixModule* m, CallId original, CallId consult) {
  if (original != 200 || consult != 201 || !m->held || !consultAccepted || consultMuted) return ErrorCode::ENotIncoming;
#ifdef PHONE11_FAKE_WARM_TRANSFER_REFUSED
  return ErrorCode::ENotIncoming;
#endif
#ifndef PHONE11_FAKE_WARM_TRANSFER_DROP
  if (transferredCallback) {
#ifdef PHONE11_FAKE_WARM_TRANSFER_FAILED
    transferredCallback(original, 486);
#else
    transferredCallback(original, 0);
#endif
    transferredCallback(original, 0); // one-attempt duplicate fence
#ifdef PHONE11_FAKE_WARM_TRANSFER_REFUSED_SYNC
    return ErrorCode::ENotIncoming;
#endif
  }
#endif
  return ErrorCode::EOK;
}
inline unsigned transferInvocations = 0;
#ifdef PHONE11_FAKE_TRANSFER_AFTER_END
// Only the End-race protocol fixture uses this flag. Call_Bye releases the
// exact pending callback after termination and any replacement incoming call.
inline CallId deferredTransferCall = 0;
#endif
inline ErrorCode Call_TransferBlind(ISiprixModule* m, CallId id, const char*) {
  if (id != 200 || !m->accepted || m->held) return ErrorCode::ENotIncoming;
#ifdef PHONE11_FAKE_TRANSFER_REFUSED
  return ++transferInvocations == 1 ? ErrorCode::ENotIncoming : ErrorCode::EOK;
#endif
#ifdef PHONE11_FAKE_TRANSFER_AFTER_END
  deferredTransferCall = id;
#elif defined(PHONE11_FAKE_TRANSFER_SYNC)
  if (transferredCallback) transferredCallback(id, 0);
#else
#ifndef PHONE11_FAKE_TRANSFER_DROP
  std::thread([m, id] {
    std::this_thread::sleep_for(std::chrono::milliseconds(150));
    if (!m->initialized || !transferredCallback) return;
#ifdef PHONE11_FAKE_TRANSFER_FAILED
    transferredCallback(id, 486);
#elif defined(PHONE11_FAKE_TRANSFER_200)
    transferredCallback(id, 200);
#else
    transferredCallback(id, 0);
#endif
    // Deliberate duplicate and wrong-call callbacks must not publish twice.
    transferredCallback(id, 0);
    transferredCallback(id + 1, 0);
  }).detach();
#endif
#endif
  return ErrorCode::EOK;
}
inline ErrorCode Call_SendDtmf(ISiprixModule* m, CallId id, const char* digits,
                               std::uint16_t duration, std::uint16_t gap, DtmfMethod method) {
  if (id != 200 || !m->accepted || !digits || duration != 200 || gap != 50 || method != DtmfMethod::DTMF_RTP)
    return ErrorCode::ENotIncoming;
  return ErrorCode::EOK;
}
inline ErrorCode Call_Reject(ISiprixModule* m, CallId id, std::uint16_t) {
  if (id != 200 || m->accepted) return ErrorCode::ENotIncoming;
  if (terminatedCallback) terminatedCallback(id, 486);
  return ErrorCode::EOK;
}
inline ErrorCode Call_Bye(ISiprixModule* m, CallId id) {
  if (id == 202 && redirectedLegAlive) {
    ++redirectByeCount;
#ifdef PHONE11_FAKE_WARM_REDIRECT_END_REFUSED
    return ErrorCode::ENotIncoming;
#else
    redirectedLegAlive = false;
    if (terminatedCallback) terminatedCallback(id, 200);
    if (connectedCallback) connectedCallback(id,"private","private",false); // late must not revive
    return ErrorCode::EOK;
#endif
  }
#if PHONE11_DESKTOP_WARM_TRANSFER_SOURCE_ENABLED
  if (id == 201 && consultAccepted) {
    ++consultByeCount;
#ifdef PHONE11_FAKE_WARM_END_REFUSED
    static bool refused = false; if (!refused) { refused = true; return ErrorCode::ENotIncoming; }
#endif
    consultAccepted = false;
    if (terminatedCallback) terminatedCallback(id, 200);
#ifndef PHONE11_FAKE_WARM_RESTORE_REFUSED_SYNC
    switchedCall = 200; if (switchedCallback) switchedCallback(200); // documented SDK auto-focus of survivor
#endif
    if (connectedCallback) connectedCallback(id, "private", "private", false); // retired late callback
    return ErrorCode::EOK;
  }
#endif
  if (id != 200 || !m->accepted) return ErrorCode::ENotIncoming;
  ++originalByeCount;
  if (terminatedCallback) terminatedCallback(id, 200);
#ifdef PHONE11_FAKE_TRANSFER_REUSED_ID
  if (incomingCallback) incomingCallback(id, 1, false, "private-from", "private-to");
#elif defined(PHONE11_FAKE_TRANSFER_NEW_CALL)
  if (incomingCallback) incomingCallback(id + 1, 1, false, "private-from", "private-to");
#endif
#ifdef PHONE11_FAKE_TRANSFER_AFTER_END
  if (deferredTransferCall == id && transferredCallback) {
    deferredTransferCall = 0;
    unsigned delivered = 0;
    transferredCallback(id, 0); ++delivered;
    transferredCallback(id, 0); ++delivered; // duplicate retired lifetime
    transferredCallback(id + 1, 0); ++delivered; // wrong/new incoming lifetime
    // A test-only receipt proves the suppression assertions are not vacuous.
    std::fprintf(stderr, "transferAfterEndCallbacks=%u\n", delivered);
  }
#endif
  return ErrorCode::EOK;
}
}  // namespace Siprix
