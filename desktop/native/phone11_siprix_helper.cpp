#include <atomic>
#include <cctype>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <iostream>
#include <limits>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#if defined(__APPLE__)
#include "SiprixCpp.h"
#elif defined(_WIN32)
#include "Siprix.h"
#else
#error "Phone11 desktop helper supports macOS and Windows only"
#endif

namespace {

// Only an authenticated desktop main process may own this private stdin/stdout
// pipe. Credentials are never accepted on argv or emitted on either stream.
constexpr std::size_t kMaxCommandLength = 96;
#ifndef PHONE11_HELPER_HOLD_TIMEOUT_MS
#define PHONE11_HELPER_HOLD_TIMEOUT_MS 15000
#endif
constexpr auto kHoldCallbackTimeout = std::chrono::milliseconds(PHONE11_HELPER_HOLD_TIMEOUT_MS);
std::mutex outputMutex;

void writeLine(const std::string& line) {
  std::lock_guard<std::mutex> lock(outputMutex);
  std::cout << line << std::endl;
}

void reply(bool ok, bool initialized, const char* code = nullptr) {
  std::string line = std::string("{\"version\":1,\"ok\":") + (ok ? "true" : "false") +
                     ",\"initialized\":" + (initialized ? "true" : "false");
  if (code != nullptr) line += std::string(",\"code\":\"") + code + "\"";
  writeLine(line + "}");
}

bool readBoundedLine(std::string& value, std::size_t limit, bool& tooLong) {
  value.clear();
  tooLong = false;
  char ch;
  while (std::cin.get(ch)) {
    if (ch == '\n') return true;
    if (value.size() < limit) value.push_back(ch);
    else tooLong = true;
  }
  return false;  // An incomplete frame is never accepted at EOF.
}

void wipe(std::string& value) {
  volatile char* bytes = value.empty() ? nullptr : &value[0];
  for (std::size_t i = 0; i < value.size(); ++i) bytes[i] = 0;
  value.clear();
}

bool safeField(const std::string& value, bool allowSpaces = false) {
  if (value.empty()) return false;
  for (unsigned char ch : value) {
    if (ch < 32 || ch == 127 || (!allowSpaces && ch == ' ')) return false;
  }
  return true;
}

bool validDestination(const std::string& value) {
  if (value.empty() || value.size() > 32) return false;
  for (char ch : value) {
    if (!std::isdigit(static_cast<unsigned char>(ch)) && ch != '+' && ch != '*' && ch != '#') return false;
  }
  return true;
}

bool validDtmf(const std::string& value) {
  if (value.empty() || value.size() > 32) return false;
  for (char ch : value) {
    if (!std::isdigit(static_cast<unsigned char>(ch)) && ch != '*' && ch != '#' &&
        (ch < 'A' || ch > 'D') && (ch < 'a' || ch > 'd')) return false;
  }
  return true;
}

bool parseCallId(const std::string& value, Siprix::CallId& id) {
  if (value.empty() || value.size() > 10 || value[0] == '0') return false;
  std::uint64_t parsed = 0;
  for (char ch : value) {
    if (!std::isdigit(static_cast<unsigned char>(ch))) return false;
    parsed = parsed * 10 + static_cast<unsigned>(ch - '0');
  }
  if (parsed > std::numeric_limits<Siprix::CallId>::max()) return false;
  id = static_cast<Siprix::CallId>(parsed);
  return true;
}

class SiprixModule {
 public:
  ~SiprixModule() { shutdown(); }

  bool initialize() {
    if (module_ != nullptr) return true;
    module_ = Siprix::Module_Create();
    if (module_ == nullptr) return false;
    Siprix::IniData* ini = Siprix::Ini_GetDefault();
    if (ini == nullptr) { shutdown(); return false; }
    // Keep certificate verification on and all vendor logging off. The trial
    // SDK enforces its own 60-second call limit; no key is embedded here.
    Siprix::Ini_SetTlsVerifyServer(ini, true);
    Siprix::Ini_SetLogLevelFile(ini, Siprix::LogLevel::NoLog);
    Siprix::Ini_SetLogLevelIde(ini, Siprix::LogLevel::NoLog);
    Siprix::Ini_SetSingleCallMode(ini, true);
    if (Siprix::Module_Initialize(module_, ini) != Siprix::ErrorCode::EOK) {
      shutdown();
      return false;
    }
    active_ = this;
    const bool callbacksOk =
        Siprix::Callback_SetAccountRegState(module_, &SiprixModule::onRegistration) == Siprix::ErrorCode::EOK &&
        Siprix::Callback_SetCallIncoming(module_, &SiprixModule::onIncoming) == Siprix::ErrorCode::EOK &&
        Siprix::Callback_SetCallProceeding(module_, &SiprixModule::onProceeding) == Siprix::ErrorCode::EOK &&
        Siprix::Callback_SetCallConnected(module_, &SiprixModule::onConnected) == Siprix::ErrorCode::EOK &&
        Siprix::Callback_SetCallHeld(module_, &SiprixModule::onHeld) == Siprix::ErrorCode::EOK &&
        Siprix::Callback_SetCallTerminated(module_, &SiprixModule::onTerminated) == Siprix::ErrorCode::EOK;
    if (!callbacksOk) { shutdown(); return false; }
    {
      std::lock_guard<std::mutex> lock(stateMutex_);
      reconcileStop_ = false;
    }
    reconcileThread_ = std::thread(&SiprixModule::reconcileHolds, this);
    return true;
  }

  bool provision(const std::vector<std::string>& fields) {
    if (!initialized() || accountId_.load() != 0 || fields.size() != 5 ||
        !safeField(fields[0]) || !safeField(fields[1]) || !safeField(fields[2]) ||
        !safeField(fields[3], true) ||
        (fields[4] != "TLS" && fields[4] != "TCP" && fields[4] != "UDP")) return false;
    Siprix::AccData* account = Siprix::Acc_GetDefault();
    if (account == nullptr) return false;
    Siprix::Acc_SetSipServer(account, fields[0].c_str());
    Siprix::Acc_SetSipExtension(account, fields[1].c_str());
    Siprix::Acc_SetSipAuthId(account, fields[2].c_str());
    Siprix::Acc_SetSipPassword(account, fields[3].c_str());
    // A nonzero expiry makes Account_Add send the first REGISTER and refresh
    // it automatically. Calling Account_Register here sends a duplicate.
    Siprix::Acc_SetExpireTime(account, 300);
    Siprix::Acc_SetTranspProtocol(account, fields[4] == "TLS" ? Siprix::SipTransport::TLS :
                                        fields[4] == "TCP" ? Siprix::SipTransport::TCP : Siprix::SipTransport::UDP);
    Siprix::AccountId id = 0;
    if (Siprix::Account_Add(module_, account, &id) != Siprix::ErrorCode::EOK || id == 0) return false;
    accountId_ = id;
    // Normally the callback is asynchronous. Reconcile a possible immediate
    // callback before Account_Add returned the new ID.
    Siprix::RegState state = Siprix::RegState::InProgress;
    if (Siprix::Account_GetRegState(module_, id, &state) == Siprix::ErrorCode::EOK &&
        state == Siprix::RegState::Success && !registered_.exchange(true)) {
      writeLine("{\"version\":1,\"event\":\"registration\",\"registered\":true}");
    }
    return true;
  }

  bool dial(const std::string& destination) {
    if (!initialized() || !registered_ || callId_ != 0 || !validDestination(destination)) return false;
    {
      std::lock_guard<std::mutex> lock(stateMutex_);
      if (pendingDial_ || callId_ != 0) return false;
      pendingDial_ = true;
    }
    Siprix::DestData* dest = Siprix::Dest_GetDefault();
    if (dest == nullptr) {
      std::lock_guard<std::mutex> lock(stateMutex_);
      pendingDial_ = false;
      return false;
    }
    Siprix::Dest_SetAccountId(dest, accountId_);
    Siprix::Dest_SetExtension(dest, destination.c_str());
    Siprix::Dest_SetVideoCall(dest, false);
    Siprix::CallId id = 0;
    if (Siprix::Call_Invite(module_, dest, &id) != Siprix::ErrorCode::EOK || id == 0) {
      std::lock_guard<std::mutex> lock(stateMutex_);
      pendingDial_ = false;
      earlyConnectedId_ = 0;
      earlyTerminatedId_ = 0;
      return false;
    }
    {
      std::lock_guard<std::mutex> lock(stateMutex_);
      callId_ = id;
      pendingDial_ = false;
      connected_ = false;
      muted_ = false;
      localHeld_ = false;
      holdPending_ = false;
      holdUncertain_ = false;
      emitCall(id, "dialing");
      // A failed or very fast call may callback before Call_Invite returns
      // its ID. Preserve event order and never leave a phantom active call.
      if (earlyConnectedId_ == id) { incoming_ = false; connected_ = true; emitCall(id, "connected"); }
      if (earlyTerminatedId_ == id) {
        emitCall(id, "terminated");
        callId_ = 0;
      }
      earlyConnectedId_ = 0;
      earlyTerminatedId_ = 0;
    }
    return true;
  }

  bool answer(Siprix::CallId id) {
    if (!initialized() || id == 0) return false;
    {
      std::lock_guard<std::mutex> lock(stateMutex_);
      if (id != callId_ || !incoming_) return false;
    }
    if (Siprix::Call_Accept(module_, id, false) != Siprix::ErrorCode::EOK) return false;
    {
      std::lock_guard<std::mutex> lock(stateMutex_);
      // Call_Accept success means this exact INVITE is no longer rejectable,
      // even if its connected callback has not arrived yet. Call_Bye handles
      // the connected or still-connecting state (BYE or CANCEL in Siprix).
      if (id == callId_) incoming_ = false;
    }
    return true;
  }

  bool end(Siprix::CallId id) {
    if (!initialized() || id == 0) return false;
    bool rejectable = false;
    {
      std::lock_guard<std::mutex> lock(stateMutex_);
      if (id != callId_) return false;
      rejectable = incoming_;
    }
    return (rejectable ? Siprix::Call_Reject(module_, id, 486) : Siprix::Call_Bye(module_, id)) == Siprix::ErrorCode::EOK;
  }

  bool mute(Siprix::CallId id, bool value) {
    if (!initialized() || id == 0 || id != callId_ || !connected_) return false;
    if (Siprix::Call_MuteMic(module_, id, value) != Siprix::ErrorCode::EOK) return false;
    std::lock_guard<std::mutex> lock(stateMutex_);
    if (id != callId_ || !connected_) return false;
    muted_ = value;
    emitCall(id, held_ ? "held" : "connected", value);
    return true;
  }

  bool hold(Siprix::CallId id, bool desired) {
    if (!initialized() || id == 0) return false;
    {
      std::lock_guard<std::mutex> lock(stateMutex_);
      if (id != callId_ || !connected_ || holdPending_ || holdUncertain_) return false;
      holdPending_ = true;
      holdTargetLocal_ = desired;
      holdAccepted_ = false;
      holdMatched_ = false;
    }
    Siprix::HoldState state = Siprix::HoldState::None;
    const bool readOk = Siprix::Call_GetHoldState(module_, id, &state) == Siprix::ErrorCode::EOK;
    const bool localHeld = state == Siprix::HoldState::Local || state == Siprix::HoldState::LocalAndRemote;
    if (!readOk || localHeld == desired) {
      std::lock_guard<std::mutex> lock(stateMutex_);
      if (id == callId_) { localHeld_ = readOk && localHeld; holdPending_ = false; holdCv_.notify_all(); }
      return readOk;
    }
    // Siprix Call_Hold toggles local hold. Keep the reservation until its
    // OnCallHeld callback confirms the final state; duplicates cannot toggle
    // it back while the first request is in flight.
    if (Siprix::Call_Hold(module_, id) != Siprix::ErrorCode::EOK) {
      std::lock_guard<std::mutex> lock(stateMutex_);
      if (id == callId_) { holdPending_ = false; holdCv_.notify_all(); }
      return false;
    }
    {
      std::lock_guard<std::mutex> lock(stateMutex_);
      if (id == callId_ && holdPending_) {
        holdAccepted_ = true;
        if (holdMatched_) holdPending_ = false;
        else holdDeadline_ = std::chrono::steady_clock::now() + kHoldCallbackTimeout;
        holdCv_.notify_all();
      }
    }
    return true;
  }

  bool dtmf(Siprix::CallId id, const std::string& digits) {
    if (!initialized() || id == 0 || id != callId_ || !connected_ || !validDtmf(digits)) return false;
    std::string normalized = digits;
    for (char& ch : normalized) ch = static_cast<char>(std::toupper(static_cast<unsigned char>(ch)));
    // Siprix recommends 200ms tone and 50ms gap. RTP is the pinned SDK's
    // first DTMF method; a deployment may later provision an explicit policy.
    return Siprix::Call_SendDtmf(module_, id, normalized.c_str(), 200, 50,
                                 Siprix::DtmfMethod::DTMF_RTP) == Siprix::ErrorCode::EOK;
  }

  void shutdown() {
    active_ = nullptr;
    {
      std::lock_guard<std::mutex> lock(stateMutex_);
      reconcileStop_ = true;
      holdCv_.notify_all();
    }
    if (reconcileThread_.joinable()) reconcileThread_.join();
    if (module_ != nullptr) {
      Siprix::Module_UnInitialize(module_);
      module_ = nullptr;
    }
    accountId_ = 0;
    callId_ = 0;
    earlyConnectedId_ = 0;
    earlyTerminatedId_ = 0;
    pendingDial_ = false;
    registered_ = false;
    incoming_ = false;
    connected_ = false;
    muted_ = false;
    held_ = false;
    localHeld_ = false;
    holdPending_ = false;
    holdUncertain_ = false;
  }

  bool initialized() const { return module_ != nullptr && Siprix::Module_IsInitialized(module_); }
  bool registered() const { return registered_; }
  Siprix::CallId callId() const { return callId_; }

 private:
  void reconcileHolds() {
    std::unique_lock<std::mutex> lock(stateMutex_);
    while (!reconcileStop_) {
      holdCv_.wait(lock, [this] { return reconcileStop_ || (holdPending_ && holdAccepted_); });
      if (reconcileStop_) break;
      const Siprix::CallId id = callId_;
      const auto deadline = holdDeadline_;
      const bool target = holdTargetLocal_;
      if (holdCv_.wait_until(lock, deadline, [this, id, deadline] {
            return reconcileStop_ || !holdPending_ || callId_ != id || holdDeadline_ != deadline;
          })) continue;
      // A missing callback is a bounded uncertainty, not permission to issue
      // another toggle. Query the SDK before allowing any further hold action.
      holdPending_ = false;
      holdUncertain_ = true;
      lock.unlock();
      Siprix::HoldState state = Siprix::HoldState::None;
      const bool readOk = Siprix::Call_GetHoldState(module_, id, &state) == Siprix::ErrorCode::EOK;
      lock.lock();
      if (reconcileStop_ || callId_ != id || !holdUncertain_) continue;
      const bool local = state == Siprix::HoldState::Local || state == Siprix::HoldState::LocalAndRemote;
      if (readOk && local == target) {
        localHeld_ = local;
        held_ = state != Siprix::HoldState::None;
        holdUncertain_ = false;
        emitCall(id, held_ ? "held" : "connected", muted_);
      } else {
        // End remains available; another hold toggle is refused for this
        // call because a delayed SDK transition could invert the new intent.
        writeLine(std::string("{\"version\":1,\"event\":\"hold_error\",\"callId\":\"") +
                  std::to_string(id) + "\",\"code\":\"state_unconfirmed\",\"holdControl\":\"blocked\"}");
      }
    }
  }
  static void emitCall(Siprix::CallId id, const char* state, bool muted = false) {
    writeLine(std::string("{\"version\":1,\"event\":\"call\",\"callId\":\"") +
              std::to_string(id) + "\",\"state\":\"" + state + "\",\"muted\":" +
              (muted ? "true" : "false") + "}");
  }
  static void onRegistration(Siprix::AccountId id, Siprix::RegState state, const char*) {
    auto* self = active_.load();
    if (!self || id != self->accountId_) return;
    self->registered_ = state == Siprix::RegState::Success;
    writeLine(std::string("{\"version\":1,\"event\":\"registration\",\"registered\":") +
              (self->registered_ ? "true" : "false") + "}");
  }
  static void onIncoming(Siprix::CallId id, Siprix::AccountId accountId, bool, const char*, const char*) {
    auto* self = active_.load();
    if (!self || accountId != self->accountId_) return;
    bool secondCall = false;
    {
      std::lock_guard<std::mutex> lock(self->stateMutex_);
      if (self->pendingDial_ || self->callId_ != 0) secondCall = true;
      else {
        self->callId_ = id;
        self->incoming_ = true;
        self->connected_ = false;
        self->muted_ = false;
        self->held_ = false;
        self->localHeld_ = false;
        self->holdPending_ = false;
        self->holdUncertain_ = false;
        self->holdCv_.notify_all();
        emitCall(id, "incoming");
      }
    }
    if (secondCall) {
      // Never expose or accept a second call in the one-call desktop prototype.
      Siprix::Call_Reject(self->module_, id, 486);
    }
  }
  static void onProceeding(Siprix::CallId id, const char*) {
    auto* self = active_.load();
    if (!self) return;
    std::lock_guard<std::mutex> lock(self->stateMutex_);
    if (id == self->callId_ && !self->connected_) emitCall(id, "ringing");
  }
  static void onConnected(Siprix::CallId id, const char*, const char*, bool) {
    auto* self = active_.load();
    if (!self) return;
    std::lock_guard<std::mutex> lock(self->stateMutex_);
    if (id == self->callId_) {
      self->incoming_ = false;
      self->connected_ = true;
      emitCall(id, self->held_ ? "held" : "connected", self->muted_);
    }
    else if (self->callId_ == 0) self->earlyConnectedId_ = id;
  }
  static void onHeld(Siprix::CallId id, Siprix::HoldState state) {
    auto* self = active_.load();
    if (!self) return;
    std::lock_guard<std::mutex> lock(self->stateMutex_);
    if (id != self->callId_ || !self->connected_) return;
    self->localHeld_ = state == Siprix::HoldState::Local || state == Siprix::HoldState::LocalAndRemote;
    self->held_ = state != Siprix::HoldState::None;
    if (self->holdPending_ && self->localHeld_ == self->holdTargetLocal_) {
      self->holdMatched_ = true;
      if (self->holdAccepted_) { self->holdPending_ = false; self->holdCv_.notify_all(); }
    }
    if (self->holdUncertain_ && self->localHeld_ == self->holdTargetLocal_) {
      self->holdUncertain_ = false;
      // Only a matching local-state callback can reopen hold control after
      // a timeout; remote-only held events must not clear the warning.
      writeLine(std::string("{\"version\":1,\"event\":\"hold_recovered\",\"callId\":\"") +
                std::to_string(id) + "\",\"code\":\"state_confirmed\",\"holdControl\":\"ready\"}");
    }
    emitCall(id, self->held_ ? "held" : "connected", self->muted_);
  }
  static void onTerminated(Siprix::CallId id, std::uint32_t) {
    auto* self = active_.load();
    if (!self) return;
    std::lock_guard<std::mutex> lock(self->stateMutex_);
    if (id == self->callId_) {
      emitCall(id, "terminated");
      self->callId_ = 0;
      self->incoming_ = false;
      self->connected_ = false;
      self->muted_ = false;
      self->held_ = false;
      self->localHeld_ = false;
      self->holdPending_ = false;
      self->holdUncertain_ = false;
      self->holdCv_.notify_all();
    } else if (self->callId_ == 0) self->earlyTerminatedId_ = id;
  }

  Siprix::ISiprixModule* module_ = nullptr;
  std::atomic<Siprix::AccountId> accountId_{0};
  std::atomic<Siprix::CallId> callId_{0};
  std::atomic<bool> registered_{false};
  std::atomic<bool> incoming_{false};
  std::atomic<bool> connected_{false};
  bool muted_ = false;
  bool held_ = false;
  bool localHeld_ = false;
  bool holdPending_ = false;
  bool holdUncertain_ = false;
  bool holdTargetLocal_ = false;
  bool holdAccepted_ = false;
  bool holdMatched_ = false;
  bool reconcileStop_ = false;
  std::chrono::steady_clock::time_point holdDeadline_{};
  std::condition_variable holdCv_;
  std::thread reconcileThread_;
  std::mutex stateMutex_;
  Siprix::CallId earlyConnectedId_ = 0;
  Siprix::CallId earlyTerminatedId_ = 0;
  bool pendingDial_ = false;
  static std::atomic<SiprixModule*> active_;
};

std::atomic<SiprixModule*> SiprixModule::active_{nullptr};

}  // namespace

int main() {
  SiprixModule siprix;
  std::string command;
  bool tooLong = false;
  while (readBoundedLine(command, kMaxCommandLength, tooLong)) {
    if (tooLong) {
      reply(false, siprix.initialized(), "invalid_command");
    } else if (command == "v1 init") {
      const bool ok = siprix.initialize();
      reply(ok, siprix.initialized(), ok ? nullptr : "initialization_failed");
    } else if (command == "v1 snapshot") {
      writeLine(std::string("{\"version\":1,\"ok\":true,\"initialized\":") +
                (siprix.initialized() ? "true" : "false") + ",\"registered\":" +
                (siprix.registered() ? "true" : "false") + ",\"callId\":" +
                (siprix.callId() ? "\"" + std::to_string(siprix.callId()) + "\"" : "null") + "}");
    } else if (command == "v1 provision") {
      std::vector<std::string> fields(5);
      const std::size_t limits[] = {512, 256, 256, 4096, 3};
      bool valid = true;
      for (std::size_t i = 0; i < fields.size(); ++i) {
        if (!readBoundedLine(fields[i], limits[i], tooLong) || tooLong) { valid = false; break; }
      }
      if (!valid) {
        for (auto& field : fields) wipe(field);
        reply(false, siprix.initialized(), "invalid_provisioning");
        break;  // The framing cannot be trusted; close the private pipe.
      }
      const bool ok = siprix.provision(fields);
      for (auto& field : fields) wipe(field);
      reply(ok, siprix.initialized(), ok ? nullptr : "provisioning_failed");
    } else if (command.rfind("v1 dial ", 0) == 0) {
      const bool ok = siprix.dial(command.substr(8));
      reply(ok, siprix.initialized(), ok ? nullptr : "call_unavailable");
    } else if (command.rfind("v1 answer ", 0) == 0 || command.rfind("v1 end ", 0) == 0) {
      const bool answer = command.rfind("v1 answer ", 0) == 0;
      Siprix::CallId id = 0;
      const bool valid = parseCallId(command.substr(answer ? 10 : 7), id);
      const bool ok = valid && (answer ? siprix.answer(id) : siprix.end(id));
      reply(ok, siprix.initialized(), ok ? nullptr : "call_unavailable");
    } else if (command.rfind("v1 mute ", 0) == 0 || command.rfind("v1 hold ", 0) == 0) {
      const bool mute = command.rfind("v1 mute ", 0) == 0;
      const std::string args = command.substr(8);
      const auto separator = args.find(' ');
      Siprix::CallId id = 0;
      const bool valid = separator != std::string::npos &&
                         parseCallId(args.substr(0, separator), id) &&
                         (args.substr(separator + 1) == "0" || args.substr(separator + 1) == "1");
      const bool value = valid && args.back() == '1';
      const bool ok = valid && (mute ? siprix.mute(id, value) : siprix.hold(id, value));
      reply(ok, siprix.initialized(), ok ? nullptr : "call_unavailable");
    } else if (command.rfind("v1 dtmf ", 0) == 0) {
      const std::string args = command.substr(8);
      const auto separator = args.find(' ');
      Siprix::CallId id = 0;
      const bool valid = separator != std::string::npos &&
                         parseCallId(args.substr(0, separator), id) &&
                         validDtmf(args.substr(separator + 1));
      const bool ok = valid && siprix.dtmf(id, args.substr(separator + 1));
      reply(ok, siprix.initialized(), ok ? nullptr : "call_unavailable");
    } else if (command == "v1 shutdown") {
      siprix.shutdown();
      reply(true, false);
      return 0;
    } else {
      reply(false, siprix.initialized(), "unsupported_command");
    }
  }
  siprix.shutdown();  // EOF or framing failure tears down SIP credentials.
  return 0;
}
