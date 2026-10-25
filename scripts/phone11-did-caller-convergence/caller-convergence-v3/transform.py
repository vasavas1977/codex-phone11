"""Pure dedicated-receiver rendering; never claims old backend secret equality."""
from dataclasses import dataclass, field
import hashlib
import importlib.util
import re
import sys
from pathlib import Path

V2 = Path(__file__).resolve().parent / 'consumer_transform.py'
V2_SHA = '0d2d9a38507a573b80935b5981067c18fe402b21a5318806a690fac7a8529557'
if hashlib.sha256(V2.read_bytes()).hexdigest() != V2_SHA:
    raise RuntimeError('DID_V2_SOURCE_DRIFT')
spec = importlib.util.spec_from_file_location('phone11_did_dedicated_v2', V2)
v2 = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = v2
spec.loader.exec_module(v2)
Refused = v2.Refused
need = v2.need
# Proposed dedicated loopback receiver, not an assertion that this port is free.
ENDPOINT = 'http://127.0.0.1:3032/api/kamailio/route'


@dataclass(frozen=True)
class Rendered:
    private_source: bytes = field(repr=False)
    source_sha256: str
    dedicated_receiver_binding_required: bool = True
    old_backend_secret_equality_proven: bool = False
    vendor_parse_proven: bool = False
    execution_eligible: bool = False


def render(main: bytes, receiver_secret: str, include: bytes) -> Rendered:
    """Use an explicit new private receiver secret, not legacy process environment.

    The pinned predecessor validates the captured source's internal consistency.
    Passing its own source literal is NOT evidence of the old backend's effective
    JavaScript environment. The new secret must separately bind the new receiver.
    """
    need(type(receiver_secret) is str and re.fullmatch(r'[a-f0-9]{64}', receiver_secret),
         'DID_DEDICATED_SECRET_SHAPE')
    need(type(main) is bytes and 0 < len(main) <= 262144
         and v2.v1.sha(main) == v2.v1.EXPECTED_MAIN_SHA, 'DID_MAIN_SHA')
    try:
        original = main.decode('utf8')
    except UnicodeError:
        raise Refused('DID_MAIN_ENCODING') from None
    definitions = list(re.finditer(
        r'(?m)^[ \t]*#!substdef[ \t]+"(?P<d>[^A-Za-z0-9\s"\\])KAM_SECRET(?P=d)(?P<value>[^"\r\n]*?)(?P=d)g"[ \t]*$',
        original))
    need(len(definitions) == 1, 'DID_SECRET_DEFINITION')
    source_literal = definitions[0]['value']
    need(receiver_secret != source_literal, 'DID_DEDICATED_SECRET_REUSE')
    candidate = v2.render(main, source_literal, include).private_source.decode()
    start, end = v2.v1.route_span(v2.v1.code(candidate))
    body = candidate[start:end]
    old_url = '$var(api_url) = "BACKEND_URL/api/kamailio/route";'
    old_header = '$var(api_headers) = "Content-Type: application/json\\r\\nx-kam-secret: KAM_SECRET";'
    need(body.count(old_url) == body.count(old_header) == 1, 'DID_DEDICATED_REPLACEMENT_SCOPE')
    body = body.replace(old_url, '$var(api_url) = "' + ENDPOINT + '";')
    body = body.replace(old_header, '$var(api_headers) = "Content-Type: application/json\\r\\nx-kam-secret: ' + receiver_secret + '";')
    # A new receiver must not accept targets cached by the predecessor generation.
    need(body.count('"phone11_did_v2:"') == 1, 'DID_DEDICATED_CACHE_SCOPE')
    body = body.replace('"phone11_did_v2:"', '"phone11_did_v3:"')
    need('KAM_SECRET' not in body and 'BACKEND_URL' not in body, 'DID_LEGACY_BINDING_REMAINED')
    result = candidate[:start] + body + candidate[end:]
    old_start, old_end = v2.v1.route_span(v2.v1.code(original))
    need(result[:start] == original[:old_start] and result[start + len(body):] == original[old_end:],
         'DID_DEDICATED_OUTSIDE_ROUTE_DRIFT')
    return Rendered(result.encode(), v2.v1.sha(result.encode()))
