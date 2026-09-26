-- Dedicated local fallback leg only. The trusted Kamailio failure route puts
-- an opaque one-use reference in the R-URI; a fresh FS leg has no prior
-- bridge_hangup_cause, so this script must never infer one.
local INGRESS = "/usr/local/bin/node /opt/phone11ai/voicemail/local-fallback-ingress.mjs"
local PRODUCER = "/opt/phone11ai/voicemail/runner.sh"
local CONTEXT = "phone11-local-voicemail"
local UUID = "^[0-9a-fA-F]+%-[0-9a-fA-F]+%-[0-9a-fA-F]+%-[0-9a-fA-F]+%-[0-9a-fA-F]+$"

local function variable(name)
  local ok, value = pcall(function() return session:getVariable(name) end)
  if ok and type(value) == "string" then return value end
  return nil
end

local function ready()
  local ok, value = pcall(function() return session and session:ready() end)
  return ok and value == true
end

local function log_failure(reason)
  -- No SIP IDs, reference, tenant, mailbox, path or credentials in logs.
  freeswitch.consoleLog("ERR", "Phone11 local voicemail: " .. reason .. "\n")
end

local function json_string(value)
  return '"' .. value:gsub('[%z\1-\31\\"]', function(character)
    if character == "\\" then return "\\\\" end
    if character == '"' then return '\\"' end
    return string.format("\\u%04x", string.byte(character))
  end) .. '"'
end

local function fixed_stdin(command, body)
  local ok, pipe = pcall(io.popen, command .. " >/dev/null", "w")
  if not ok or not pipe then return false end
  local wrote = pcall(function() pipe:write(body) end)
  local closed, result = pcall(function() return pipe:close() end)
  return wrote and closed and (result == true or result == 0)
end

local function canonical_handoff(root, uuid)
  local file = root .. "/" .. uuid .. ".ready"
  local handle = io.open(file, "rb")
  if not handle then return nil end
  local data = handle:read(512)
  local extra = handle:read(1)
  handle:close()
  os.remove(file)
  if type(data) ~= "string" or extra ~= nil then return nil end
  local tenant, extension, account, domain, epoch =
    data:match("^([1-9][0-9]*)\n([1-9][0-9]*)\n([1-9][0-9]*)\n([a-z0-9%.%-]+)\n([0-9a-fA-F%-]+)\n$")
  if not tenant or #tenant > 16 or #extension > 16 or extension ~= account or
      #domain > 128 or not domain:match("^[a-z0-9][a-z0-9.%-]*[a-z0-9]$") or
      #epoch ~= 36 or not epoch:match(UUID) then return nil end
  local tenant_number = tonumber(tenant)
  if not tenant_number or tenant_number > 9007199254740991 then return nil end
  return tenant_number, extension, account, domain, epoch
end

local function message_seconds(value)
  if type(value) ~= "string" then return nil end
  local hours, minutes, seconds = value:match("^(%d+):(%d%d):(%d%d)$")
  if not hours then return nil end
  hours, minutes, seconds = tonumber(hours), tonumber(minutes), tonumber(seconds)
  if not hours or minutes > 59 or seconds > 59 then return nil end
  local total = hours * 3600 + minutes * 60 + seconds
  if total > 86400 then return nil end
  return total
end

if not ready() then return end
local pinned_source = os.getenv("PHONE11_VOICEMAIL_FALLBACK_KAM_IP")
local handoff_root = os.getenv("PHONE11_VOICEMAIL_FALLBACK_HANDOFF_ROOT")
local destination = variable("destination_number")
local source = variable("sip_received_ip")
local call_id = variable("sip_call_id")
local from_tag = variable("sip_from_tag")
local channel_uuid = variable("uuid")
local reference = type(destination) == "string" and destination:match("^phone11%-vm%-([0-9a-f]+)$") or nil
if variable("context") ~= CONTEXT or
    type(pinned_source) ~= "string" or not pinned_source:match("^[0-9.]+$") or
    source ~= pinned_source or type(handoff_root) ~= "string" or
    not handoff_root:match("^/[%w%._/%-]+$") or
    not reference or #reference ~= 64 or
    not call_id or #call_id > 160 or not call_id:match("^[A-Za-z0-9%._~+@:%-]+$") or
    not from_tag or #from_tag > 96 or not from_tag:match("^[A-Za-z0-9%._~+%-]+$") or
    not channel_uuid or #channel_uuid ~= 36 or not channel_uuid:match(UUID) then
  log_failure("invalid ingress identity")
  return
end

local redemption = '{"reference":' .. json_string(reference) ..
  ',"callId":' .. json_string(call_id) ..
  ',"fromTag":' .. json_string(from_tag) ..
  ',"channelUuid":' .. json_string(channel_uuid) .. '}'
if not fixed_stdin(INGRESS, redemption) then
  log_failure("redemption failed")
  return
end

-- CANCEL may arrive while the bounded HTTP request is in flight. A consumed
-- reference is never retried; no admission is made for a dead leg.
if not ready() then
  os.remove(handoff_root .. "/" .. channel_uuid .. ".ready")
  return
end
local tenant, extension, account, domain, epoch = canonical_handoff(handoff_root, channel_uuid)
if not tenant then
  log_failure("invalid redemption handoff")
  return
end
if not ready() then return end
local admission = '{"channelUuid":' .. json_string(channel_uuid) ..
  ',"tenantId":' .. string.format("%.0f", tenant) ..
  ',"extension":' .. json_string(extension) ..
  ',"expectedOwnerEpoch":' .. json_string(epoch) .. '}'
if not fixed_stdin(PRODUCER .. " admit", admission) then
  log_failure("admission failed")
  if ready() then pcall(function() session:hangup("NORMAL_TEMPORARY_FAILURE") end) end
  return
end
-- An orphan pre-record admission can remain if CANCEL races the producer;
-- the existing pending sweeper handles it. A cancelled leg never records.
if not ready() then return end
local invoked = pcall(function() session:execute("voicemail", "default " .. domain .. " " .. account) end)
if not invoked then
  log_failure("voicemail application failed; admission retained")
  return
end

local file_path = variable("voicemail_file_path")
if not file_path or file_path == "" then return end
if variable("voicemail_account") ~= account or variable("voicemail_domain") ~= domain then
  log_failure("completed mailbox identity mismatch")
  return
end
local seconds = message_seconds(variable("voicemail_message_len"))
if not seconds then
  log_failure("completed duration invalid; admission retained")
  return
end
local caller = variable("caller_id_number") or ""
if #caller > 64 or caller:find("[%z\1-\31\127]") then caller = "" end
local completion = '{"channelUuid":' .. json_string(channel_uuid) ..
  ',"voicemailFilePath":' .. json_string(file_path) ..
  ',"callerNumber":' .. json_string(caller) ..
  ',"durationSeconds":' .. string.format("%.0f", seconds) .. '}'
if not fixed_stdin(PRODUCER .. " complete", completion) then
  log_failure("completion failed; WAV and admission retained")
end
