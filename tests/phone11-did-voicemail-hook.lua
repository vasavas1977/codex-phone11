-- Replays the static DID extension path and executes its real guarded gateway.
local getenv = os.getenv
local function run(flag)
  local events = {}
  os.getenv = function(name) assert(name == "PHONE11_VOICEMAIL_HOOK_READY"); return flag end
  freeswitch = { API = function() return {} end, consoleLog = function() end }
  session = {
    ready = function() return true end,
    getVariable = function(_, name)
      if name == "destination_number" then return "did-12025551000" end
      if name == "domain_name" then return "phone11.cloud" end
      error("unexpected variable " .. name)
    end,
    execute = function(_, application, data)
      if application == "lua" then
        assert(data == "/etc/freeswitch/scripts/phone11_legacy_voicemail.lua 1000 phone11.cloud answer")
        argv = { "1000", "phone11.cloud", "answer" }
        dofile("deploy/freeswitch/scripts/phone11_legacy_voicemail.lua")
      else
        table.insert(events, application)
        if application == "voicemail" then assert(data == "default phone11.cloud 1000") end
      end
    end,
    hangup = function(_, cause) assert(cause == "NORMAL_TEMPORARY_FAILURE"); table.insert(events, "hangup") end,
  }
  dofile("deploy/freeswitch/scripts/did_routing.lua")
  return table.concat(events, ",")
end
assert(run("false") == "set,set,bridge,answer,voicemail")
assert(run("true") == "set,set,bridge,hangup")
os.getenv = getenv
print("Phone11 static DID route: 2 cases passed")
