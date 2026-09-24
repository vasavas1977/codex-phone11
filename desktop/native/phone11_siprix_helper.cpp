#include <iostream>
#include <string>

#if defined(__APPLE__)
#include "SiprixCpp.h"
#elif defined(_WIN32)
#include "Siprix.h"
#else
#error "Phone11 desktop helper supports macOS and Windows only"
#endif

namespace {

// A private stdin/stdout pipe is owned by the future authenticated main
// process. This bootstrap intentionally has no account or call commands.
constexpr std::size_t kMaxCommandLength = 64;

void reply(bool ok, bool initialized, const char* code = nullptr) {
  std::cout << "{\"version\":1,\"ok\":" << (ok ? "true" : "false")
            << ",\"initialized\":" << (initialized ? "true" : "false");
  if (code != nullptr) std::cout << ",\"code\":\"" << code << "\"";
  std::cout << "}" << std::endl;
}

bool readCommand(std::string& command, bool& tooLong) {
  command.clear();
  tooLong = false;
  char ch;
  while (std::cin.get(ch)) {
    if (ch == '\n') return true;
    if (command.size() < kMaxCommandLength) command.push_back(ch);
    else tooLong = true;
  }
  return !command.empty() || tooLong;
}

class SiprixModule {
 public:
  ~SiprixModule() { shutdown(); }

  bool initialize() {
    if (module_ != nullptr) return true;
    module_ = Siprix::Module_Create();
    if (module_ == nullptr) return false;

    Siprix::IniData* ini = Siprix::Ini_GetDefault();
    if (ini == nullptr) {
      Siprix::Module_UnInitialize(module_);
      module_ = nullptr;
      return false;
    }
    // The upstream console sample disables certificate verification and logs
    // SIP payloads. Phone11 must retain verification and suppress SDK logs.
    Siprix::Ini_SetTlsVerifyServer(ini, true);
    Siprix::Ini_SetLogLevelFile(ini, Siprix::LogLevel::NoLog);
    Siprix::Ini_SetLogLevelIde(ini, Siprix::LogLevel::NoLog);
    if (Siprix::Module_Initialize(module_, ini) != Siprix::ErrorCode::EOK) {
      // No raw vendor errors on stdout/stderr: they can include SIP material.
      Siprix::Module_UnInitialize(module_);
      module_ = nullptr;
      return false;
    }
    return true;
  }

  void shutdown() {
    if (module_ != nullptr) {
      Siprix::Module_UnInitialize(module_);
      module_ = nullptr;
    }
  }

  bool initialized() const {
    return module_ != nullptr && Siprix::Module_IsInitialized(module_);
  }

 private:
  Siprix::ISiprixModule* module_ = nullptr;
};

}  // namespace

int main() {
  SiprixModule siprix;
  std::string command;
  bool tooLong = false;
  while (readCommand(command, tooLong)) {
    if (tooLong) {
      reply(false, siprix.initialized(), "invalid_command");
    } else if (command == "v1 init") {
      const bool ok = siprix.initialize();
      reply(ok, siprix.initialized(), ok ? nullptr : "initialization_failed");
    } else if (command == "v1 snapshot") {
      reply(true, siprix.initialized());
    } else if (command == "v1 shutdown") {
      siprix.shutdown();
      reply(true, false);
      return 0;
    } else {
      reply(false, siprix.initialized(), "unsupported_command");
    }
  }
  // EOF from a crashed or signed-out main process tears down the SDK.
  siprix.shutdown();
  return 0;
}
