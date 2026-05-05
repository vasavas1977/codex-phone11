--[[
  ============================================================================
  DID Routing Script — CloudPhone11
  ============================================================================
  Routes inbound DID calls to the correct extension, ring group, or IVR.
  Called from the dial plan when a DID inbound call arrives.

  DID routing table is stored in FreeSWITCH's internal DB or fetched
  from BillRun API for dynamic routing.
  ============================================================================
]]--

local did_number = session:getVariable("destination_number"):gsub("^did%-", "")
local api = freeswitch.API()

-- Log the inbound DID call
freeswitch.consoleLog("INFO", "[CloudPhone11] Inbound DID call to: " .. did_number .. "\n")

-- ─── DID Routing Table ─────────────────────────────────────────────────────
-- In production, this would query BillRun or a database.
-- For now, define static routes that match your DID inventory.

local did_routes = {
    -- US DIDs
    ["+12025551000"] = { type = "extension", dest = "1000" },
    ["+12025551001"] = { type = "ring_group", dest = "7001" },  -- Sales
    ["+12025551002"] = { type = "ring_group", dest = "7002" },  -- Support
    ["+18005551000"] = { type = "ivr", dest = "auto-attendant" },

    -- UK DIDs
    ["+442071234567"] = { type = "extension", dest = "1010" },

    -- Default catch-all
    ["default"] = { type = "ivr", dest = "auto-attendant" },
}

-- Normalize the DID number
local normalized = did_number
if not normalized:match("^%+") then
    normalized = "+" .. normalized
end

-- Look up the route
local route = did_routes[normalized] or did_routes["default"]

if route then
    freeswitch.consoleLog("INFO",
        "[CloudPhone11] DID " .. normalized ..
        " → " .. route.type .. ":" .. route.dest .. "\n")

    if route.type == "extension" then
        -- Direct to extension
        session:execute("set", "call_timeout=30")
        session:execute("set", "continue_on_fail=true")
        session:execute("bridge", "user/" .. route.dest .. "@${domain_name}")
        -- Fallback to voicemail
        session:execute("answer")
        session:execute("voicemail", "default ${domain_name} " .. route.dest)

    elseif route.type == "ring_group" then
        -- Transfer to ring group
        session:execute("transfer", route.dest .. " XML cloudphone11")

    elseif route.type == "ivr" then
        -- Transfer to IVR
        session:execute("transfer", route.dest .. " XML cloudphone11")

    elseif route.type == "external" then
        -- Forward to external number
        session:execute("bridge", "sofia/external/" .. route.dest .. "@KAMAILIO_IP:5060")
    end
else
    -- No route found — play error and hang up
    freeswitch.consoleLog("WARNING",
        "[CloudPhone11] No route found for DID: " .. normalized .. "\n")
    session:execute("answer")
    session:execute("playback", "ivr/ivr-invalid_number.wav")
    session:execute("hangup", "UNALLOCATED_NUMBER")
end
