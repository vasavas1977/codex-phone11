-- Static routes have no authenticated personal-mailbox mapping. The flag comes
-- only from the FreeSWITCH process environment, never a SIP/channel variable.
-- Install before loading cloudphone11.xml, with the flag still off.
if not session or not session:ready() then return end
if os.getenv("PHONE11_VOICEMAIL_HOOK_READY") == "true" then
  freeswitch.consoleLog("ERR", "Phone11 legacy voicemail refused: commissioned routes require trusted admission\n")
  session:hangup("NORMAL_TEMPORARY_FAILURE")
  return
end

local account, domain, answer = argv[1], argv[2], argv[3]
if type(account) ~= "string" or not account:match("^[A-Za-z0-9_.%-]+$") or #account > 64 or
    type(domain) ~= "string" or #domain > 253 or
    not domain:match("^[A-Za-z0-9][A-Za-z0-9.%-]*[A-Za-z0-9]$") or
    (answer ~= nil and answer ~= "answer" and answer ~= "loopback") then
  session:hangup("NORMAL_TEMPORARY_FAILURE")
  return
end
-- Preserve the legacy internal answer and group-fallback application order.
if answer == "loopback" then
  -- The shipped default/demo dialplan historically used a loopback B-leg.
  session:execute("answer", "")
  session:execute("sleep", "1000")
  session:execute("bridge", "loopback/app=voicemail:default " .. domain .. " " .. account)
else
  if answer == "answer" then session:execute("answer", "") end
  session:execute("voicemail", "default " .. domain .. " " .. account)
end
