#!/usr/bin/env bash
set -Eeuo pipefail

EC2_HOST="${EC2_HOST:-43.210.122.111}"
EC2_USER="${EC2_USER:-ubuntu}"
DOMAIN="sip.phone11.ai"
USER_NAME="1001"
START="2026-05-24T10:18:30Z"
END="2026-05-24T10:20:20Z"
KEY_PATH="${HOME}/.ssh/phone11_v49_key"

INSTANCE_JSON=$(aws ec2 describe-instances --filters "Name=ip-address,Values=${EC2_HOST}" "Name=instance-state-name,Values=running" --query 'Reservations[0].Instances[0]' --output json)
INSTANCE_ID=$(echo "$INSTANCE_JSON" | jq -r '.InstanceId // empty')
AZ=$(echo "$INSTANCE_JSON" | jq -r '.Placement.AvailabilityZone // empty')
test -n "$INSTANCE_ID" && test "$INSTANCE_ID" != null
mkdir -p ~/.ssh && chmod 700 ~/.ssh
ssh-keygen -t ed25519 -N '' -f "$KEY_PATH" -C phone11-github-actions >/dev/null 2>&1
aws ec2-instance-connect send-ssh-public-key --instance-id "$INSTANCE_ID" --availability-zone "$AZ" --instance-os-user "$EC2_USER" --ssh-public-key "file://${KEY_PATH}.pub" >/dev/null

ssh -i "$KEY_PATH" -o StrictHostKeyChecking=no -o ServerAliveInterval=15 -o ServerAliveCountMax=20 "$EC2_USER@$EC2_HOST" 'bash -s' <<'REMOTE'
set -Eeuo pipefail
DOMAIN="sip.phone11.ai"
USER_NAME="1001"
START="2026-05-24T10:18:30Z"
END="2026-05-24T10:20:20Z"
OUT=/tmp/phone11-v49-register.out

echo "===== V49 target ====="
echo "iphone_diag_build=6eb53e61-9d4d-4ec4-9f94-b371c6ff2ca6"
echo "iphone_diag_commit=2153eb90be1ac917cc4874dfc9beee79119555bf"
echo "iphone_401_time_utc=2026-05-24T10:19:18.677Z"
echo "server_window_start=$START"
echo "server_window_end=$END"
echo "domain=$DOMAIN"
echo "username=$USER_NAME"

echo "===== Containers ====="
docker ps --format '{{.Names}} {{.Status}}' | sort

echo "===== Kamailio config auth lines ====="
docker exec p11-kamailio sh -lc 'grep -nE "modparam\(\"auth_db\"|calculate_ha1|password_column|use_domain|auth_check|www_challenge|REGISTER|consume_credentials|realm" /etc/kamailio/kamailio.cfg | sed -n "1,260p"' || true
docker exec p11-kamailio kamailio -c -f /etc/kamailio/kamailio.cfg >/dev/null
echo "kamailio_config_syntax=pass"

PGUSER="$(docker exec cp11-postgres sh -lc 'printf %s "${POSTGRES_USER:-postgres}"')"
PGDATABASE="$(docker exec cp11-postgres sh -lc 'printf %s "${POSTGRES_DB:-${POSTGRES_USER:-postgres}}"')"
PGPASSWORD_VALUE="$(docker exec cp11-postgres sh -lc 'printf %s "${POSTGRES_PASSWORD:-}"')"

echo "===== Live DB rows for user 1001, redacted ====="
docker exec -i -e PGPASSWORD="$PGPASSWORD_VALUE" cp11-postgres psql -v ON_ERROR_STOP=1 -U "$PGUSER" -d "$PGDATABASE" <<SQL
SELECT 'subscriber' AS table_name, username, domain, length(coalesce(password,'')) AS password_len, length(coalesce(ha1,'')) AS ha1_len, length(coalesce(ha1b,'')) AS ha1b_len,
  (coalesce(ha1,'') = md5(username || ':' || domain || ':' || coalesce(password,''))) AS ha1_ok,
  (coalesce(ha1b,'') = md5(username || '@' || domain || ':' || domain || ':' || coalesce(password,''))) AS ha1b_ok
FROM subscriber WHERE username='1001' AND domain='sip.phone11.ai';
SELECT 'sip_accounts' AS table_name, username, domain, transport, active, length(coalesce(password,'')) AS password_len, secret_ciphertext IS NOT NULL AS has_secret_ciphertext
FROM sip_accounts WHERE username='1001' OR extension='1001' ORDER BY id DESC LIMIT 10;
SELECT 'extensions' AS table_name, extension_number, user_id, tenant_id, sip_username, sip_domain, transport, active
FROM extensions WHERE extension_number='1001' OR sip_username='1001' ORDER BY id DESC LIMIT 10;
SQL

PASS="$(docker exec -i -e PGPASSWORD="$PGPASSWORD_VALUE" cp11-postgres psql -At -v ON_ERROR_STOP=1 -U "$PGUSER" -d "$PGDATABASE" -c "SELECT coalesce(password,'') FROM subscriber WHERE username = '$USER_NAME' AND domain = '$DOMAIN' LIMIT 1;")"
if [ -z "$PASS" ]; then
  echo "V49_BLOCKER=no_subscriber_plaintext_password"
  exit 31
fi
echo "subscriber_password_present=yes"
echo "subscriber_password_not_printed=yes"

echo "===== Kamailio logs around iPhone failure window ====="
docker logs --since "$START" --until "$END" --timestamps p11-kamailio 2>&1 \
  | grep -Eia 'REGISTER|1001|401|407|200 OK|Unauthorized|auth|nonce|digest|error|warning|failed|received|reply' \
  | sed -E 's/(nonce=")[^"]+(".*response=")[^"]+(".*)/\1<redacted>\2<redacted>\3/g; s/(response=")[^"]+(".*)/\1<redacted>\2/g; s/(password=)[^ ,;]+/\1<redacted>/g' \
  | tail -n 500 || true

echo "===== Synthetic REGISTER from EC2 to Kamailio using current live password ====="
set +e
PHONE11_TEST_PASS="$PASS" python3 - <<'PY' | tee "$OUT"
import hashlib, os, random, re, secrets, select, socket, sys, time
DOMAIN='sip.phone11.ai'
USER='1001'
PASS=os.environ['PHONE11_TEST_PASS']
SERVER=('10.0.1.69',5060)
IP='10.0.1.69'
def md5(v): return hashlib.md5(v.encode()).hexdigest()
def header(txt,n):
    m=re.search(rf'^{re.escape(n)}:\s*(.+)$',txt,re.I|re.M)
    return m.group(1).strip() if m else ''
def code(txt):
    first=txt.splitlines()[0] if txt.splitlines() else ''
    m=re.match(r'SIP/2.0\s+(\d+)\s*(.*)', first)
    return (int(m.group(1)), m.group(2).strip()) if m else (0, first)
def parse_challenge(ch):
    return {k.lower():(q or b) for k,q,b in re.findall(r'(\w+)=(?:"([^"]*)"|([^,\s]+))', ch.replace('Digest','',1))}
def digest(ch, method, uri):
    d=parse_challenge(ch)
    realm=d.get('realm', DOMAIN)
    nonce=d['nonce']
    qop='auth' if 'auth' in d.get('qop','') else ''
    nc='00000001'
    cnonce=secrets.token_hex(8)
    ha1=md5(f'{USER}:{realm}:{PASS}')
    ha2=md5(f'{method}:{uri}')
    resp=md5(f'{ha1}:{nonce}:{nc}:{cnonce}:{qop}:{ha2}') if qop else md5(f'{ha1}:{nonce}:{ha2}')
    print(f'V49_CHALLENGE_REALM={realm}')
    print(f'V49_CHALLENGE_QOP={qop or "none"}')
    parts=[f'username="{USER}"', f'realm="{realm}"', f'nonce="{nonce}"', f'uri="{uri}"', f'response="{resp}"', 'algorithm=MD5']
    if qop:
        parts += [f'qop={qop}', f'nc={nc}', f'cnonce="{cnonce}"']
    return 'Digest ' + ', '.join(parts)
sock=socket.socket(socket.AF_INET,socket.SOCK_DGRAM)
sock.bind((IP, random.randint(28000,28999)))
sock.setblocking(False)
sport=sock.getsockname()[1]
cid=f'phone11-v49-{secrets.token_hex(8)}@ec2'
uri=f'sip:{DOMAIN}'
tag=secrets.token_hex(6)
def send(cseq, auth=''):
    lines=[
        f'REGISTER {uri} SIP/2.0',
        f'Via: SIP/2.0/UDP {IP}:{sport};branch=z9hG4bKv49{secrets.token_hex(6)};rport',
        'Max-Forwards: 70',
        f'From: <sip:{USER}@{DOMAIN}>;tag={tag}',
        f'To: <sip:{USER}@{DOMAIN}>',
        f'Call-ID: {cid}',
        f'CSeq: {cseq} REGISTER',
        f'Contact: <sip:{USER}@{IP}:{sport};transport=udp>;expires=300',
        'Expires: 300',
        'User-Agent: Phone11V49AuthEvidence',
    ]
    if auth:
        lines.append(auth)
    msg='\r\n'.join(lines+['Content-Length: 0','',''])
    sock.sendto(msg.encode(), SERVER)
def recv(timeout=10):
    end=time.time()+timeout
    while time.time()<end:
        r,_,_=select.select([sock],[],[],0.2)
        if r:
            data,_=sock.recvfrom(65535)
            txt=data.decode(errors='replace')
            if cid in txt:
                return txt
    raise TimeoutError(cid)
print(f'V49_SYNTH_CALL_ID={cid}')
send(1)
first=recv()
c,r=code(first)
print(f'V49_FIRST_STATUS={c}')
print(f'V49_FIRST_REASON={r}')
ch=header(first,'WWW-Authenticate') or header(first,'Proxy-Authenticate')
print(f'V49_HAS_CHALLENGE={bool(ch)}')
if c not in (401,407) or not ch:
    sys.exit(41)
auth_name='Proxy-Authorization' if c==407 else 'Authorization'
send(2, auth_name + ': ' + digest(ch,'REGISTER',uri))
second=recv()
c,r=code(second)
print(f'V49_FINAL_STATUS={c}')
print(f'V49_FINAL_REASON={r}')
print('V49_SYNTH_REGISTER_RESULT=' + ('pass' if c==200 else 'fail'))
sys.exit(0 if c==200 else 42)
PY
PY_EXIT=${PIPESTATUS[0]}
set -e
echo "synthetic_exit=$PY_EXIT"
echo "===== Synthetic summary ====="
cat "$OUT" || true
echo "V49_POSTMORTEM_COMPLETE=yes"
exit "$PY_EXIT"
REMOTE
