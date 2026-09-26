-- Isolated Lua lifecycle test; no SIP server, HTTP request, recording or user.
local hook = "infra/configs/freeswitch/scripts/phone11_voicemail_local_fallback.lua"
local uuid = "11111111-1111-4111-8111-111111111111"
local epoch = "22222222-2222-4222-8222-222222222222"
local reference = string.rep("a", 64)
local original_popen, original_open, original_remove, original_getenv = io.popen, io.open, os.remove, os.getenv

local function case(options)
  local events = {}
  local ready_checks = 0
  local handoff = "12\n1020\n1020\nsip.phone11.ai\n" .. epoch .. "\n"
  local values = {
    context = options.context or "phone11-local-voicemail",
    destination_number = options.destination or ("phone11-vm-" .. reference),
    sip_received_ip = options.source or "10.0.0.5",
    sip_call_id = "call-123@phone11.invalid", sip_from_tag = "tag-123", uuid = uuid,
  }
  freeswitch = { consoleLog = function() end }
  session = {
    ready = function()
      ready_checks = ready_checks + 1
      return ready_checks ~= options.cancel_at
    end,
    getVariable = function(_, key) return values[key] end,
    execute = function(_, app, destination)
      assert(app == "voicemail" and destination == "default sip.phone11.ai 1020")
      table.insert(events, "voicemail")
      values.voicemail_file_path = "/private/1020/a.wav"
      values.voicemail_account = "1020"
      values.voicemail_domain = "sip.phone11.ai"
      values.voicemail_message_len = "00:00:07"
    end,
    hangup = function() table.insert(events, "hangup") end,
  }
  os.getenv = function(key)
    if key == "PHONE11_VOICEMAIL_FALLBACK_KAM_IP" then return "10.0.0.5" end
    if key == "PHONE11_VOICEMAIL_FALLBACK_HANDOFF_ROOT" then return "/private/handoff" end
  end
  os.remove = function(name)
    assert(name == "/private/handoff/" .. uuid .. ".ready")
    table.insert(events, "consume-handoff")
    return true
  end
  io.open = function(name, mode)
    assert(name == "/private/handoff/" .. uuid .. ".ready" and mode == "rb")
    local reads = 0
    return {
      read = function()
        reads = reads + 1
        return reads == 1 and (options.handoff or handoff) or nil
      end,
      close = function() end,
    }
  end
  io.popen = function(command, mode)
    assert(mode == "w")
    local phase = command:find("local%-fallback%-ingress%.mjs") and "redeem"
      or command:find(" admit ") and "admit" or "complete"
    assert(command:find(" >/dev/null", 1, true))
    return {
      write = function(_, body)
        if phase == "redeem" then
          assert(body:find('"reference":"' .. reference .. '"', 1, true))
          assert(body:find('"callId":"call-123@phone11.invalid"', 1, true))
          assert(body:find('"fromTag":"tag-123"', 1, true))
        elseif phase == "admit" then
          assert(body:find('"tenantId":12', 1, true))
          assert(body:find('"extension":"1020"', 1, true))
          assert(body:find('"expectedOwnerEpoch":"' .. epoch .. '"', 1, true))
        else
          assert(body:find('"voicemailFilePath":"/private/1020/a.wav"', 1, true))
        end
      end,
      close = function()
        table.insert(events, phase)
        return phase ~= options.fail_phase
      end,
    }
  end
  local ok, err = pcall(dofile, hook)
  io.popen, io.open, os.remove, os.getenv = original_popen, original_open, original_remove, original_getenv
  assert(ok, err)
  return table.concat(events, ",")
end

assert(case({}) == "redeem,consume-handoff,admit,voicemail,complete")
assert(case({ destination = "ordinary-1020" }) == "")
assert(case({ context = "public" }) == "")
assert(case({ source = "10.0.0.6" }) == "")
assert(case({ fail_phase = "redeem" }) == "redeem")
assert(case({ handoff = "12\n1020\n1020\nsip.phone11.ai\nbad\n" }) == "redeem,consume-handoff")
assert(case({ cancel_at = 2 }) == "redeem,consume-handoff")
assert(case({ cancel_at = 3 }) == "redeem,consume-handoff")
assert(case({ cancel_at = 4 }) == "redeem,consume-handoff,admit")
assert(case({ fail_phase = "admit" }) == "redeem,consume-handoff,admit,hangup")
print("Phone11 local fallback Lua: 10 cases passed")
