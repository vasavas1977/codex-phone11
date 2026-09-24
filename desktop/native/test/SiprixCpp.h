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
struct ISiprixModule { bool initialized = false; bool accepted = false; };
struct IniData {};
struct AccData {};
struct DestData {};
using OnAccountRegState = void (*)(AccountId, RegState, const char*);
using OnCallIncoming = void (*)(CallId, AccountId, bool, const char*, const char*);
using OnCallProceeding = void (*)(CallId, const char*);
using OnCallConnected = void (*)(CallId, const char*, const char*, bool);
using OnCallTerminated = void (*)(CallId, std::uint32_t);
inline OnCallIncoming incomingCallback = nullptr;
inline OnCallTerminated terminatedCallback = nullptr;
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
inline ErrorCode Callback_SetCallConnected(ISiprixModule*, OnCallConnected) { return ErrorCode::EOK; }
inline ErrorCode Callback_SetCallTerminated(ISiprixModule*, OnCallTerminated cb) { terminatedCallback = cb; return ErrorCode::EOK; }
inline AccData* Acc_GetDefault() { return &account; }
inline void Acc_SetSipServer(AccData*, const char*) {}
inline void Acc_SetSipExtension(AccData*, const char*) {}
inline void Acc_SetSipAuthId(AccData*, const char*) {}
inline void Acc_SetSipPassword(AccData*, const char*) {}
inline void Acc_SetExpireTime(AccData*, std::uint32_t) {}
inline void Acc_SetTranspProtocol(AccData*, SipTransport) {}
inline ErrorCode Account_Add(ISiprixModule* m, AccData*, AccountId* id) {
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
