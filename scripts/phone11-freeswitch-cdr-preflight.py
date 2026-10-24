"""Local static CDR configuration check. Never prints configuration or credentials.

The committed template is intentionally uncommissioned. A private mounted
configuration must be prepared and qualified by its own reviewed operator; this
check neither injects it into deployments nor proves live custody or delivery.
"""
import argparse
import json
import os
from pathlib import Path
import re
import stat
import xml.etree.ElementTree as ET

ENDPOINT = 'http://127.0.0.1:3000/api/freeswitch/cdr'
FIXED = {'retries': '0', 'timeout': '3', 'delay': '5', 'log-http-and-disk': 'false',
         'log-b-leg': 'true', 'prefix-a-leg': 'true', 'encode': 'true', 'auth-scheme': 'basic'}

class Refused(Exception):
    pass

def validate(raw):
    if not 0 < len(raw) <= 32768 or b'<!DOCTYPE' in raw or b'<!ENTITY' in raw:
        raise Refused('CDR_CONFIGURATION_SHAPE')
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        raise Refused('CDR_CONFIGURATION_SHAPE') from None
    if root.tag != 'configuration' or root.get('name') != 'xml_cdr.conf' or len(root) != 1 or root[0].tag != 'settings':
        raise Refused('CDR_CONFIGURATION_SHAPE')
    params = {}
    for node in root[0]:
        if node.tag != 'param' or set(node.attrib) != {'name', 'value'} or len(node) or node.get('name') in params:
            raise Refused('CDR_CONFIGURATION_SHAPE')
        params[node.get('name')] = node.get('value')
    if not params.get('url') or not params.get('cred'):
        raise Refused('CDR_UNCOMMISSIONED')
    if params['url'] != ENDPOINT or any(params.get(k) != v for k, v in FIXED.items()):
        raise Refused('CDR_DELIVERY_CONTRACT')
    if set(params) - set(FIXED) - {'url', 'cred', 'err-log-dir', 'encode-values'} or params.get('encode-values', 'true') != 'true':
        raise Refused('CDR_UNSUPPORTED_PARAMETER')
    credential = params['cred']
    if not credential.startswith('phone11-cdr:'):
        raise Refused('CDR_BASIC_CREDENTIAL_REQUIRED')
    secret = credential[len('phone11-cdr:'):]
    if len(secret.encode()) < 24 or len(secret.encode()) > 4096 or re.search(r'change[-_ ]?me|placeholder|example', secret, re.I) or any(ord(c) < 32 or ord(c) == 127 for c in secret):
        raise Refused('CDR_BASIC_CREDENTIAL_REQUIRED')
    spool = params.get('err-log-dir', '')
    if not re.fullmatch(r'/(?:etc|var/lib)/freeswitch/(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*', spool):
        raise Refused('CDR_PRIVATE_SPOOL_REQUIRED')
    return 'STATIC_CONFIG_PRESENT_RUNTIME_CUSTODY_UNPROVEN'

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, default=Path(__file__).resolve().parents[1] / 'infra/configs/freeswitch/autoload_configs/xml_cdr.conf.xml')
    args = parser.parse_args(argv)
    try:
        fd = os.open(args.config, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or not 0 < info.st_size <= 32768:
                raise Refused('CDR_CONFIGURATION_FILE')
            raw = os.read(fd, 32769)
            status = validate(raw)
            if info.st_uid not in (0, os.geteuid()) or stat.S_IMODE(info.st_mode) & 0o077:
                raise Refused('CDR_PRIVATE_CONFIG_REQUIRED')
        finally:
            os.close(fd)
        print(json.dumps({'schema': 'PHONE11_STATIC_CDR_PREFLIGHT_V1', 'status': status, 'liveDeliveryProven': False}))
        return 0
    except (Refused, OSError, UnicodeError) as error:
        code = str(error) if isinstance(error, Refused) else 'CDR_CONFIGURATION_FILE'
        print(json.dumps({'schema': 'PHONE11_STATIC_CDR_PREFLIGHT_V1', 'status': 'REFUSED', 'reason': code, 'liveDeliveryProven': False}))
        return 70

if __name__ == '__main__':
    raise SystemExit(main())
