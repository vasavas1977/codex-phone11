#!/usr/bin/env bash
set -Eeuo pipefail

EC2_HOST="${EC2_HOST:-43.210.122.111}"
EC2_USER="${EC2_USER:-ubuntu}"
KEY_PATH="${HOME}/.ssh/phone11_v52_key"

INSTANCE_JSON=$(aws ec2 describe-instances --filters "Name=ip-address,Values=${EC2_HOST}" "Name=instance-state-name,Values=running" --query 'Reservations[0].Instances[0]' --output json)
INSTANCE_ID=$(echo "$INSTANCE_JSON" | jq -r '.InstanceId // empty')
AZ=$(echo "$INSTANCE_JSON" | jq -r '.Placement.AvailabilityZone // empty')
test -n "$INSTANCE_ID" && test "$INSTANCE_ID" != null
mkdir -p ~/.ssh && chmod 700 ~/.ssh
ssh-keygen -t ed25519 -N '' -f "$KEY_PATH" -C phone11-github-actions >/dev/null 2>&1
aws ec2-instance-connect send-ssh-public-key --instance-id "$INSTANCE_ID" --availability-zone "$AZ" --instance-os-user "$EC2_USER" --ssh-public-key "file://${KEY_PATH}.pub" >/dev/null

ssh -i "$KEY_PATH" -o StrictHostKeyChecking=no -o ServerAliveInterval=15 -o ServerAliveCountMax=20 "$EC2_USER@$EC2_HOST" 'bash -s' <<'REMOTE'
set -Eeuo pipefail
RAW=/tmp/phone11-v52-register-capture.raw
TXT=/tmp/phone11-v52-register-capture.txt
SUMMARY=/tmp/phone11-v52-register-summary.txt
rm -f "$RAW" "$TXT" "$SUMMARY"

echo "===== V52 live iPhone REGISTER capture ====="
echo "capture_target=udp_port_5060_all_interfaces"
echo "capture_duration_seconds=180"
echo "capture_armed_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "ACTION_REQUIRED=tap Start SIP Registration Test on the iPhone once while this job is running"

set +e
sudo timeout 180s tcpdump -i any -nn -s0 -A 'udp port 5060' > "$RAW" 2>&1
TCPDUMP_EXIT=$?
set -e
echo "capture_finished_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "tcpdump_exit=$TCPDUMP_EXIT"

tr -cd '\11\12\15\40-\176' < "$RAW" > "$TXT" || true

python3 - <<'PY' "$TXT" "$SUMMARY"
import re, sys
path, out = sys.argv[1], sys.argv[2]
text = open(path, errors='replace').read()
# Keep only SIP-ish blocks/lines around extension 1001 and Phone11 traffic.
lines = text.splitlines()
kept = []
for i, line in enumerate(lines):
    if re.search(r'REGISTER|SIP/2\.0|1001|phone11|Authorization|WWW-Authenticate|Call-ID|CSeq|From:|To:|Contact:|User-Agent|Via:', line, re.I):
        start=max(0,i-2); end=min(len(lines),i+3)
        kept.extend(lines[start:end])
kept_text='\n'.join(kept)
# Redact digest material but keep structure.
red = re.sub(r'(nonce=")[^"]+(")', r'\1<redacted>\2', kept_text, flags=re.I)
red = re.sub(r'(response=")[^"]+(")', r'\1<redacted>\2', red, flags=re.I)
red = re.sub(r'(cnonce=")[^"]+(")', r'\1<redacted>\2', red, flags=re.I)
red = re.sub(r'(opaque=")[^"]+(")', r'\1<redacted>\2', red, flags=re.I)

register_blocks = re.findall(r'REGISTER\s+sip:[^\s]+\s+SIP/2\.0.*?(?=\n\d{2}:\d{2}:\d{2}|\nIP |\Z)', text, flags=re.I|re.S)
auth_registers = [b for b in register_blocks if re.search(r'\n(?:Authorization|Proxy-Authorization):', b, re.I)]
noauth_registers = [b for b in register_blocks if not re.search(r'\n(?:Authorization|Proxy-Authorization):', b, re.I)]
status_401 = len(re.findall(r'SIP/2\.0\s+401', text, re.I))
status_200 = len(re.findall(r'SIP/2\.0\s+200', text, re.I))
call_ids = []
for m in re.finditer(r'Call-ID:\s*([^\r\n]+)', text, re.I):
    cid=m.group(1).strip()
    if cid not in call_ids:
        call_ids.append(cid)

with open(out,'w') as f:
    f.write('V52_REGISTER_TOTAL=%d\n' % len(register_blocks))
    f.write('V52_REGISTER_WITHOUT_AUTH=%d\n' % len(noauth_registers))
    f.write('V52_REGISTER_WITH_AUTH=%d\n' % len(auth_registers))
    f.write('V52_STATUS_401_COUNT=%d\n' % status_401)
    f.write('V52_STATUS_200_COUNT=%d\n' % status_200)
    f.write('V52_CALL_IDS=%s\n' % (','.join(call_ids[:10]) or 'none'))
    f.write('===== REDACTED SIP EVIDENCE =====\n')
    f.write(red[-12000:] if red else 'NO_MATCHING_SIP_LINES\n')
PY

cat "$SUMMARY"
echo "V52_CAPTURE_COMPLETE=yes"
REMOTE
