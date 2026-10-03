-- Source-only Phone11 inbox hook. The dynamic dialplan invokes this only when
-- PHONE11_VOICEMAIL_HOOK_READY=true and the tenant-owned mailbox is enabled.
-- A deployment must provide the fixed Node producer command, its secret via
-- environment, a private WAV root, and a durable outbox before enabling it.

local PRODUCER = "/opt/phone11ai/voicemail/runner.sh"
local UUID = "^[0-9a-fA-F]+%-[0-9a-fA-F]+%-[0-9a-fA-F]+%-[0-9a-fA-F]+%-[0-9a-fA-F]+$"
local allowed_failure = {
  NO_ANSWER = true,
  USER_BUSY = true,
  USER_NOT_REGISTERED = true,
  NO_USER_RESPONSE = true,
  SUBSCRIBER_ABSENT = true,
}

local function safe_variable(name)
  local ok, value = pcall(function() return session:getVariable(name) end)
  if ok and type(value) == "string" then return value end
  return nil
end

local function json_string(value)
  return '"' .. value:gsub('[%z\1-\31\\"]', function(character)
    if character == "\\" then return "\\\\" end
    if character == '"' then return '\\"' end
    return string.format("\\u%04x", string.byte(character))
  end) .. '"'
end

local function run_producer(phase, body)
  -- The command is fixed: no caller, mailbox, UUID or WAV path enters a shell
  -- argument. JSON goes only through stdin. A nonzero exit keeps admission or
  -- the completed WAV for operator retry; it never starts an unadmitted inbox.
  local ok, pipe = pcall(io.popen, PRODUCER .. " " .. phase .. " >/dev/null", "w")
  if not ok or not pipe then return false end
  local wrote = pcall(function() pipe:write(body) end)
  local closed, status = pcall(function() return pipe:close() end)
  return wrote and closed and (status == true or status == 0)
end

local function log_failure(reason)
  -- Do not log callers, file paths, credentials, or tenant/user identifiers.
  freeswitch.consoleLog("ERR", "Phone11 voicemail deposit: " .. reason .. "\n")
end

local function message_seconds(value)
  -- mod_voicemail exposes a formatted HH:MM:SS value, not integer seconds.
  -- Reject missing or malformed metadata instead of publishing a misleading
  -- zero-duration message. The final WAV and admission remain for inspection.
  if type(value) ~= "string" then return nil end
  local hours, minutes, seconds = value:match("^(%d+):(%d%d):(%d%d)$")
  if not hours then return nil end
  hours, minutes, seconds = tonumber(hours), tonumber(minutes), tonumber(seconds)
  if not hours or minutes > 59 or seconds > 59 then return nil end
  local total = hours * 3600 + minutes * 60 + seconds
  if total > 86400 then return nil end
  return total
end

local tenant = tonumber(argv[1])
local extension = argv[2]
local account = argv[3]
local domain = argv[4]
-- Only trusted dynamic dialplans pass direct; it must never be a channel variable.
local entry = argv[5] or "bridge"
if not tenant or tenant < 1 or tenant > 9007199254740991 or tenant % 1 ~= 0 or
    type(extension) ~= "string" or not extension:match("^[1-9][0-9]*$") or #extension > 16 or
    account ~= extension or type(domain) ~= "string" or #domain > 253 or
    not domain:match("^[A-Za-z0-9][A-Za-z0-9.%-]*[A-Za-z0-9]$") then
  log_failure("invalid trusted route identity")
  return
end

if entry ~= "bridge" and entry ~= "direct" then
  log_failure("invalid trusted entry mode")
  return
end

if not session or not session:ready() then return end
-- Backend protected mode and the host's commissioned mode must agree. A new
-- backend must not start deposits on a host whose producer is still staged.
if os.getenv("PHONE11_VOICEMAIL_HOOK_READY") ~= "true" then
  log_failure("FreeSWITCH hook is not commissioned")
  session:hangup("NORMAL_TEMPORARY_FAILURE")
  return
end
local cause = safe_variable("bridge_hangup_cause")
if entry == "bridge" and not allowed_failure[cause or ""] then return end
local channel_uuid = safe_variable("uuid")
if not channel_uuid or #channel_uuid ~= 36 or not channel_uuid:match(UUID) then
  log_failure("invalid call identity")
  return
end

local admission = '{"channelUuid":' .. json_string(channel_uuid) ..
  ',"tenantId":' .. string.format("%.0f", tenant) ..
  ',"extension":' .. json_string(extension) .. '}'
if not run_producer("admit", admission) then
  log_failure("admission failed")
  pcall(function() session:hangup("NORMAL_TEMPORARY_FAILURE") end)
  return
end

local invoked = pcall(function()
  session:execute("voicemail", "default " .. domain .. " " .. account)
end)
if not invoked then
  log_failure("voicemail application failed; admission retained")
  return
end

-- mod_voicemail documents these output variables after the application. No
-- manifest is published when the host gives no final path (including an
-- abandoned or interrupted deposit). The Node producer independently checks
-- that the path is a stable private WAV under the admitted mailbox and fsyncs
-- its bytes before publishing a durable outbox manifest.
local file_path = safe_variable("voicemail_file_path")
if not file_path or file_path == "" then return end
if safe_variable("voicemail_account") ~= account or
    safe_variable("voicemail_domain") ~= domain then
  log_failure("completed mailbox identity mismatch")
  return
end

local seconds = message_seconds(safe_variable("voicemail_message_len"))
if not seconds then
  log_failure("completed duration is missing or invalid; WAV and admission retained")
  return
end
local caller = safe_variable("caller_id_number") or ""
if #caller > 64 or caller:find("[%z\1-\31\127]") then caller = "" end
local completion = '{"channelUuid":' .. json_string(channel_uuid) ..
  ',"voicemailFilePath":' .. json_string(file_path) ..
  ',"callerNumber":' .. json_string(caller) ..
  ',"durationSeconds":' .. string.format("%.0f", seconds) .. '}'
if not run_producer("complete", completion) then
  log_failure("completion failed; WAV and admission retained")
end
