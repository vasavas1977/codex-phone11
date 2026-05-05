# Kamailio Call Routing Analysis

## INVITE Route Flow for 66818333600:
1. Emergency check: NO (not 191/199/1669)
2. Local extension (4-digit): NO (66818333600 is 11 digits)
3. Ring groups/queues/IVR: NO (no * prefix)
4. PSTN regex: `^\+?[0-9]{9,15}$` → 66818333600 is 11 digits → YES, matches!
5. Goes to route[DID_ROUTE]

## DID_ROUTE Flow:
1. Check htable cache → likely empty
2. Call backend REST API: `http://127.0.0.1:3001/api/kamailio/route?secret=KAM_SECRET&number=66818333600`
3. If API returns 200 → use target
4. If API fails → route to FreeSWITCH

## Key Question: Does the backend have `/api/kamailio/route` endpoint?
- Backend is at 127.0.0.1:3001 on the VoIP server
- BUT the backend runs on 43.209.112.208 (backend server), NOT on the VoIP server!
- The BACKEND_URL is `http://127.0.0.1:3001` which won't work on the VoIP server

## WAIT - The error says 404 Not Found
- The DID_ROUTE has a fallback: if API fails (rc != 200), it routes to FreeSWITCH
- But the log showed "DID lookup failed for ... (rc=6), routing to FS"
- rc=6 means HTTP client connection refused/failed
- So it DOES fall back to FreeSWITCH
- The 404 must be coming from FreeSWITCH itself!

## FreeSWITCH Routing:
- route[TO_FREESWITCH] uses dispatcher set 1
- If dispatcher fails, falls back to sip:FS_IP:FS_PORT (10.0.1.69:5080)
- Need to check FreeSWITCH dialplan for outbound routing
