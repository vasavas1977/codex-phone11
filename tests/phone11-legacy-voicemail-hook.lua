local hook = "deploy/freeswitch/scripts/phone11_legacy_voicemail.lua"
local getenv = os.getenv
local function run(flag, arguments)
  local events = {}
  argv = arguments or { "3001", "phone11.cloud" }
  os.getenv = function(name) assert(name == "PHONE11_VOICEMAIL_HOOK_READY"); return flag end
  freeswitch = { consoleLog = function() end }
  session = {
    ready = function() return true end,
    getVariable = function() error("must not trust channel commissioning variables") end,
    execute = function(_, application, data)
      table.insert(events, application)
      if application == "voicemail" then assert(data == "default phone11.cloud " .. argv[1]) end
      if application == "bridge" then assert(data == "loopback/app=voicemail:default phone11.cloud " .. argv[1]) end
    end,
    hangup = function(_, cause) assert(cause == "NORMAL_TEMPORARY_FAILURE"); table.insert(events, "hangup") end,
  }
  dofile(hook)
  return table.concat(events, ",")
end
assert(run(nil, { "3001", "phone11.cloud", "answer" }) == "answer,voicemail")
assert(run("false", { "7001", "phone11.cloud" }) == "voicemail")
assert(run("false", { "7002", "phone11.cloud" }) == "voicemail")
assert(run("false", { "u3001", "phone11.cloud" }) == "voicemail")
assert(run("true", { "3001", "phone11.cloud", "answer" }) == "hangup")
assert(run("true", { "7001", "phone11.cloud" }) == "hangup")
assert(run("true", { "7002", "phone11.cloud" }) == "hangup")
assert(run("false", { "3001", "phone11.cloud injected" }) == "hangup")
assert(run("false", { "3001 other", "phone11.cloud" }) == "hangup")
assert(run("false", { "3001", "phone11.cloud", "direct" }) == "hangup")
assert(run("false", { "1000", "phone11.cloud", "loopback" }) == "answer,sleep,bridge")
assert(run("true", { "1000", "phone11.cloud", "loopback" }) == "hangup")
os.getenv = getenv
print("Phone11 static legacy gate: 12 cases passed")
