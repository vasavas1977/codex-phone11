#pragma once

// Minimal fake of the pinned C++ API for helper protocol tests. The release
// target includes the vendor header from SIPRIX_SDK_ROOT, never this header.
#include <chrono>
#include <cstdint>
#include <thread>

namespace Siprix {
using AccountId = std::uint32_t;
using CallId = std::uint32_t;
enum class ErrorCode { EOK, ENotIncoming };
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
inline ErrorCode Module_UnInitialize(ISiprixModule* m) { m->initialized = false; return ErrorCode::EOK; }
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
inline ErrorCode Call_Invite(ISiprixModule*, DestData*, CallId* id) { *id = 201; return ErrorCode::EOK; }
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
  if (id != 200 || !m->accepted) return ErrorCode::ENotIncoming;
  m->muted = value;
  return ErrorCode::EOK;
}
inline ErrorCode Call_GetHoldState(ISiprixModule* m, CallId id, HoldState* state) {
  if (id != 200 || !m->accepted) return ErrorCode::ENotIncoming;
  *state = m->held ? HoldState::Local : HoldState::None;
  return ErrorCode::EOK;
}
inline ErrorCode Call_Hold(ISiprixModule* m, CallId id) {
  if (id != 200 || !m->accepted) return ErrorCode::ENotIncoming;
#ifdef PHONE11_FAKE_HOLD_DELAYED_STATE
  const bool nextHeld = !m->held;
  std::thread([m, id, nextHeld] {
    std::this_thread::sleep_for(std::chrono::milliseconds(160));
    if (m->initialized && heldCallback) heldCallback(id, HoldState::Remote);
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
  const HoldState finalState = m->held ? HoldState::Local : HoldState::None;
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
  if (id != 200 || !m->accepted) return ErrorCode::ENotIncoming;
  if (terminatedCallback) terminatedCallback(id, 200);
  return ErrorCode::EOK;
}
}  // namespace Siprix
