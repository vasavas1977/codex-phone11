"""V2 exact-consumer convergence layered on immutable non-executable V1."""
from dataclasses import dataclass,field
import hashlib,importlib.util,json,re,sys
from pathlib import Path
P=Path(__file__).resolve().parent
V1=P/'request_transform.py'
V1_SHA='a1b4a6ca1c7c26ab292410c23e8deb4f6cdf676ce8f6f67f0cb26e4fcf699a0c'
raw=V1.read_bytes()
if hashlib.sha256(raw).hexdigest()!=V1_SHA:raise RuntimeError('DID_V1_SOURCE_DRIFT')
spec=importlib.util.spec_from_file_location('phone11_did_caller_v1_pinned',V1);v1=importlib.util.module_from_spec(spec);sys.modules[spec.name]=v1;spec.loader.exec_module(v1)
Refused=v1.Refused;need=v1.need
CONSUMER_SHA='39a93f6d6454c94ec0bcb96f291a552d6f6b5587bd2a5f238ea6d5220543a692'
# Exact existing maintained wakeOfferSchema URI grammar; supports nonnumeric identities.
SIP_PATTERN=r'^sip:[A-Za-z0-9_.+-]{1,128}@[A-Za-z0-9.-]{1,253}$'
INTERNAL_PATTERN=r'^phone11pbx-(ivr|ringgroup|queue|timecondition)-[1-9][0-9]{0,9}-[1-9][0-9]{0,9}$'
RINGALL_PATTERN=r'^phone11pbx-ringall-[1-9][0-9]{0,9}-0$'
CACHE_NAMESPACE='phone11_did_v2:'
CACHE_VAR='phone11_did_cache_key'
OLD_CACHE_RE=r'\$sht\(did_cache\s*=>\s*\$rU\)'
NEW_CACHE='$sht(did_cache=>$var('+CACHE_VAR+'))'

def consumer_span(clean):
 start,end=v1.route_span(clean);body=clean[start:end];matches=list(re.finditer(r'\bif\s*\(\s*\$var\(did_target\)\s*=~',v1.mask(body)));need(len(matches)==1,'DID_V2_CONSUMER_COUNT');return start+matches[0].start(),end-1

def first_branch(consumer):
 masked=v1.mask(consumer);opening=masked.index('{');depth=1
 for i in range(opening+1,len(masked)):
  if masked[i]=='{':depth+=1
  elif masked[i]=='}':
   depth-=1
   if depth==0:return opening,i
 raise Refused('DID_V2_CONSUMER_BRACES')

@dataclass(frozen=True)
class Rendered:
 private_source:bytes=field(repr=False)
 source_sha256:str
 source_target_mapping_converged:bool=True
 cache_namespace:str=CACHE_NAMESPACE
 vendor_parse_proven:bool=False
 live_backend_binding_proven:bool=False
 live_target_consumer_compatibility_proven:bool=False
 execution_eligible:bool=False

def render(main:bytes,backend_secret:str,include:bytes)->Rendered:
 # V1 enforces exact source/route/include, header-secret equality, numeric caller
 # and rejects HTTP200 reject/no-target before cache. It performs no live I/O.
 candidate=v1.render(main,backend_secret,include).private_source.decode()
 original=main.decode();clean=v1.code(original);left,right=consumer_span(clean);old_consumer=clean[left:right];need(v1.sha(old_consumer.encode())==CONSUMER_SHA,'DID_V2_CONSUMER_SHA')
 new_clean=v1.code(candidate);a,b=consumer_span(new_clean);need(new_clean[a:b]==old_consumer,'DID_V2_V1_CONSUMER_DRIFT')
 opening,closing=first_branch(old_consumer)
 need(re.fullmatch(r'if\s*\(\s*\$var\(did_target\)\s*=~\s*"\^\[1-9\]\[0-9\]\{3\}\$"\s*\)\s*',old_consumer[:opening])is not None,'DID_V2_OLD_PREDICATE')
 # Preserve every private/native lookup, Flexisip and RTP/relay byte in the
 # observed SIP branch, except the single user-only assignment now becomes URI.
 inner=candidate[a+opening+1:a+closing]
 assigns=list(re.finditer(r'\$rU\s*=\s*\$var\(did_target\)\s*;',v1.code(inner)));need(len(assigns)==1,'DID_V2_URI_ASSIGNMENT_COUNT');assign=assigns[0];inner=inner[:assign.start()]+'$ru = $var(did_target);'+inner[assign.end():]
 tail=candidate[a+closing+1:b]
 need(re.fullmatch(r'\s*\$rU\s*=\s*\$var\(did_target\)\s*;\s*route\s*\(\s*TO_FREESWITCH\s*\)\s*;\s*exit\s*;\s*',v1.code(tail))is not None,'DID_V2_INTERNAL_TAIL')
 consumer='if ($var(did_target) =~ '+json.dumps(SIP_PATTERN)+') {'+inner+'}\n    if ($var(did_target) =~ '+json.dumps(INTERNAL_PATTERN)+' ||\n        $var(did_target) =~ '+json.dumps(RINGALL_PATTERN)+') {'+tail+'}\n    '+NEW_CACHE+' = $null;\n    sl_send_reply("404", "Not Found");\n    exit;\n'
 candidate=candidate[:a]+consumer+candidate[b:]
 # Ignore all legacy cache keys without flushing any table or unrelated value.
 start,end=v1.route_span(v1.code(candidate));body=candidate[start:end];need(CACHE_VAR not in v1.code(original),'DID_V2_CACHE_VARIABLE_COLLISION');need(len(re.findall(OLD_CACHE_RE,v1.code(body)))==3,'DID_V2_OLD_CACHE_COUNT');body=re.sub(OLD_CACHE_RE,lambda _:NEW_CACHE,body)
 cache_assign=list(re.finditer(re.escape(NEW_CACHE)+r'\s*=\s*\$var\(did_target\)\s*;',v1.code(body)));need(len(cache_assign)==1,'DID_V2_CACHE_WRITE_COUNT');point=cache_assign[0].start()
 # Fresh replies bind action to target shape before caching; cache hits carry
 # only a shape-validated capability in this new namespace.
 response_guard='''if (($var(phone11_did_action) == "bridge" && !($var(did_target) =~ SIP_RE)) ||
                ($var(phone11_did_action) == "freeswitch" && !($var(did_target) =~ INTERNAL_RE)) ||
                ($var(phone11_did_action) == "ring_all" && !($var(did_target) =~ RINGALL_RE))) {
                sl_send_reply("404", "Not Found");
                exit;
            }
            '''.replace('SIP_RE',json.dumps(SIP_PATTERN)).replace('INTERNAL_RE',json.dumps(INTERNAL_PATTERN)).replace('RINGALL_RE',json.dumps(RINGALL_PATTERN))
 body=body[:point]+response_guard+body[point:];opening=body.index('{');body=body[:opening+1]+'\n    $var('+CACHE_VAR+') = '+json.dumps(CACHE_NAMESPACE)+' + $rU;'+body[opening+1:]
 result=candidate[:start]+body+candidate[end:]
 need(result[:start]==original[:start]and result[start+len(body):]==original[v1.route_span(clean)[1]:],'DID_V2_OUTSIDE_ROUTE_DRIFT')
 need(re.search(OLD_CACHE_RE,v1.code(body))is None,'DID_V2_LEGACY_CACHE_REFERENCE')
 return Rendered(result.encode(),v1.sha(result.encode()))
