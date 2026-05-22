# Phone11 post public media fix capture

Trigger a fresh SIP/media capture after deploying the Kamailio public media/backend route fix.

Expected live config evidence:
- BACKEND_URL uses http://127.0.0.1:3000
- native rtpengine_answer includes media-address=43.210.122.111
- p11-kamailio is running and not restarting
