-- Run with Lua 5.3+ or a compatible parser/runtime. No FreeSWITCH or network
-- access is needed: the producer process and channel are deliberately mocked.
local hook = "infra/configs/freeswitch/scripts/phone11_voicemail_deposit.lua"
local uuid = "11111111-1111-4111-8111-111111111111"

local function run_case(options)
  local events = {}
  local variables = { uuid = uuid, bridge_hangup_cause = options.cause or "NO_ANSWER" }
  argv = options.argv or { "12", "3001", "3001", "phone11.cloud" }
  freeswitch = { consoleLog = function() end }
  session = {
    ready = function() return true end,
    getVariable = function(_, name) return variables[name] end,
    execute = function(_, app, destination)
      assert(app == "voicemail")
      assert(destination == "default phone11.cloud 3001")
      table.insert(events, "voicemail")
      if options.executeError then error("interrupted voicemail application") end
      variables.voicemail_file_path = options.path
      variables.voicemail_account = options.account or "3001"
      variables.voicemail_domain = "phone11.cloud"
      if options.duration ~= false then
        variables.voicemail_message_len = options.duration or "00:00:07"
      end
    end,
    hangup = function() table.insert(events, "hangup") end,
  }
  io.popen = function(command, mode)
    assert(mode == "w")
    assert(command:find("/opt/phone11ai/voicemail/runner.sh", 1, true))
    local phase = command:find(" admit ", 1, true) and "admit" or "complete"
    local pipe = {
      write = function(_, body)
        assert(body:find('"channelUuid":"' .. uuid .. '"', 1, true))
        if phase == "admit" then
          assert(body:find('"tenantId":12', 1, true))
          assert(body:find('"extension":"3001"', 1, true))
        else
          assert(body:find('"voicemailFilePath":"' .. options.path .. '"', 1, true))
          assert(body:find('"durationSeconds":' .. (options.expected_seconds or "7") .. '}', 1, true))
        end
      end,
      close = function() return phase ~= "admit" or options.admit ~= false end,
    }
    table.insert(events, phase)
    return pipe
  end
  dofile(hook)
  return table.concat(events, ",")
end

assert(run_case({ path = "/private/default/phone11.cloud/3001/a.wav" }) == "admit,voicemail,complete")
assert(run_case({ path = "/private/a.wav", duration = "01:02:03", expected_seconds = "3723" }) == "admit,voicemail,complete")
assert(run_case({ path = "/private/a.wav", duration = "00:00:02", expected_seconds = "2" }) == "admit,voicemail,complete")
assert(run_case({ path = "/private/a.wav", duration = "invalid" }) == "admit,voicemail")
assert(run_case({ path = "/private/a.wav", duration = false }) == "admit,voicemail")
assert(run_case({ path = "/private/a.wav", duration = "00:60:00" }) == "admit,voicemail")
assert(run_case({ path = "/private/a.wav", duration = "24:00:01" }) == "admit,voicemail")
assert(run_case({ admit = false }) == "admit,hangup")
assert(run_case({}) == "admit,voicemail")
assert(run_case({ executeError = true }) == "admit,voicemail")
assert(run_case({ path = "/private/a.wav", account = "other" }) == "admit,voicemail")
assert(run_case({ path = "/private/a.wav", cause = "NORMAL_CLEARING" }) == "")
assert(run_case({ path = "/private/a.wav", argv = { "0", "3001", "3001", "phone11.cloud" } }) == "")
print("Phone11 Lua hook: 12 cases passed")
