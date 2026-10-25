"""Non-writing exact-source DID request renderer. No CLI, secret output or live I/O."""
from dataclasses import dataclass,field
import hashlib,hmac,json,re
EXPECTED_MAIN_SHA='92287d910a8886018a9f3207f127ff28953dee4b3c363732591b9fa5d0a89406'
EXPECTED_ROUTE_SHA='8e5f17e8b6ea695950babceeeac218bb0566e19418a9fe49d82e49749ed73f61'
EXPECTED_INCLUDE_SHA='fca9c21a827ee8ab0f3974cc298d86b5647a12ad589cb57d694e978634d50a4f'
class Refused(RuntimeError):pass
def need(value,code):
 if not value:raise Refused(code)
def sha(value):return hashlib.sha256(value).hexdigest()

# Exact comment normalization used by the accepted native projection's route SHA.
def code(text):
 out=[];quote=None;escape=False;line=False;comment=False;pos=0
 while pos<len(text):
  char=text[pos];pair=text[pos:pos+2]
  if line:
   out.append('\n'if char=='\n'else' ')
   if char=='\n':line=False
  elif comment:
   out.append(' ')
   if pair=='*/':out.append(' ');comment=False;pos+=1
  elif quote:
   out.append(char)
   if escape:escape=False
   elif char=='\\':escape=True
   elif char==quote:quote=None
  elif char=='#'or pair=='//':line=True;out.append(' ')
  elif pair=='/*':comment=True;out.extend((' ',' '));pos+=1
  else:
   out.append(char)
   if char in('"',"'"):quote=char
  pos+=1
 return ''.join(out)

def mask(text):
 out=list(text);quote=None;escape=False
 for i,char in enumerate(text):
  if quote:
   out[i]=' '
   if escape:escape=False
   elif char=='\\':escape=True
   elif char==quote:quote=None
  elif char in('"',"'"):quote=char;out[i]=' '
 need(quote is None,'DID_QUOTE_SHAPE');return ''.join(out)

def route_span(clean):
 masked=mask(clean);matches=list(re.finditer(r'\broute\s*\[\s*DID_ROUTE\s*\]\s*\{',masked));need(len(matches)==1,'DID_ROUTE_COUNT');match=matches[0];opening=masked.index('{',match.start(),match.end());depth=1
 for i in range(opening+1,len(masked)):
  if masked[i]=='{':depth+=1
  elif masked[i]=='}':
   depth-=1
   if depth==0:return match.start(),i+1
 raise Refused('DID_ROUTE_BRACES')

@dataclass(frozen=True)
class Rendered:
 private_source:bytes=field(repr=False)
 source_sha256:str
 only_did_contract_sections_changed:bool=True
 secret_values_compared:bool=True
 vendor_parse_proven:bool=False
 live_backend_binding_proven:bool=False
 target_consumer_compatibility_proven:bool=False
 execution_eligible:bool=False

def render(main:bytes,backend_secret:str,include:bytes)->Rendered:
 """Caller must privately bind backend_secret; this function proves equality only."""
 need(type(include)is bytes and 0<len(include)<=262144 and sha(include)==EXPECTED_INCLUDE_SHA,'DID_INCLUDE_SHA')
 need(type(main)is bytes and 0<len(main)<=262144 and b'\0'not in main,'DID_MAIN_BOUND');need(sha(main)==EXPECTED_MAIN_SHA,'DID_MAIN_SHA')
 try:text=main.decode('utf8')
 except UnicodeError:raise Refused('DID_MAIN_ENCODING')from None
 clean=code(text);start,end=route_span(clean);body=clean[start:end];need(sha(body.encode())==EXPECTED_ROUTE_SHA,'DID_ROUTE_SHA')
 # Fixed currently observed substitution style; never fall back to another source.
 definitions=list(re.finditer(r'(?m)^[ \t]*#!substdef[ \t]+"(?P<d>[^A-Za-z0-9\s"\\])KAM_SECRET(?P=d)(?P<value>[^"\r\n]*?)(?P=d)g"[ \t]*$',text))
 all_definitions=re.findall(r'(?m)^[ \t]*#!(?:define[ \t]+KAM_SECRET\b|substdef[ \t]+".KAM_SECRET.)',text)
 need(len(definitions)==len(all_definitions)==1,'DID_SECRET_DEFINITION');secret=definitions[0]['value']
 # Dedicated receiver mode: this is captured source syntax, not a live credential.
 need(type(backend_secret)is str and re.fullmatch(r'[A-Za-z0-9._~+/-]{1,256}={0,2}',secret),'DID_SOURCE_LITERAL_BOUND')
 need(hmac.compare_digest(hashlib.sha256(secret.encode()).digest(),hashlib.sha256(backend_secret.encode()).digest()),'DID_BACKEND_SECRET_MISMATCH')
 # The direct caller must constrain raw JSON interpolation to numeric DID input.
 guard=r'if\s*\(\s*\$rU\s*=~\s*"\^\\{1,2}\+\?\[0-9\]\{9,15\}\$"\s*\)\s*\{\s*route\s*\(\s*DID_ROUTE\s*\)\s*;\s*exit\s*;\s*\}'
 need(len(re.findall(r'\broute\s*\(\s*DID_ROUTE\s*\)',mask(clean+'\n'+code(include.decode('utf8')))))==1 and len(re.findall(guard,clean))==1,'DID_NUMERIC_CALLSITE_UNPROVEN')
 # No variable collision; exactly one literal URL assignment and known 3-arg call.
 need(not re.search(r'\$var\(api_(?:body|headers)\)',body),'DID_NEW_VARIABLE_COLLISION')
 url_matches=list(re.finditer(r'\$var\(api_url\)\s*=\s*("(?:[^"\\]|\\.)*")\s*\+\s*\$rU\s*;',body));need(len(url_matches)==1,'DID_URL_ASSIGNMENT')
 try:url=json.loads(url_matches[0][1])
 except ValueError:raise Refused('DID_URL_LITERAL')from None
 prefix='/api/kamailio/route?secret=';suffix='&number=';need(url.startswith(prefix)and url.endswith(suffix),'DID_OLD_URL_CONTRACT');old_secret=url[len(prefix):-len(suffix)]
 need(old_secret=='KAM_SECRET'or hmac.compare_digest(old_secret.encode(),secret.encode()),'DID_URL_SECRET_MISMATCH')
 call_matches=list(re.finditer(r'http_connect\s*\(\s*("[A-Za-z_][A-Za-z0-9_-]{0,63}")\s*,\s*"\$var\(api_url\)"\s*,\s*"\$var\(api_result\)"\s*\)',body));need(len(call_matches)==1 and len(re.findall(r'\bhttp_connect\s*\(',mask(body)))==1,'DID_HTTP_CONNECT_SHAPE');call=call_matches[0]
 connection=json.loads(call[1]);bindings=list(re.finditer(r'modparam\s*\(\s*"http_client"\s*,\s*"httpcon"\s*,\s*("(?:[^"\\]|\\.)*")\s*\)',clean));matching=[json.loads(m[1])for m in bindings if json.loads(m[1]).partition('=>')[0]==connection]
 need(len(matching)==1 and matching[0]in(connection+'=>BACKEND_URL',connection+'=>http://127.0.0.1:3000',connection+'=>http://localhost:3000'),'DID_CONNECTION_BINDING')
 urls=list(re.finditer(r'(?m)^[ \t]*#!substdef[ \t]+"(?P<d>[^A-Za-z0-9\s"\\])BACKEND_URL(?P=d)(?P<value>[^"\r\n]*?)(?P=d)g"[ \t]*$',text));need(len(urls)==1 and urls[0]['value']in('http://127.0.0.1:3000','http://localhost:3000'),'DID_BACKEND_BASE')
 need(not re.search(r'\bhttp_client_query\s*\(',mask(body)),'DID_ALREADY_CONVERGED')
 url_text='$var(api_url) = "BACKEND_URL/api/kamailio/route";\n        $var(api_body) = "{\\"ruri_user\\":\\"" + $rU + "\\"}";\n        $var(api_headers) = "Content-Type: application/json\\r\\nx-kam-secret: KAM_SECRET";'
 call_text='http_client_query("$var(api_url)", "$var(api_body)", "$var(api_headers)", "$var(api_result)")'
 # HTTP200 is not authority: maintained reject responses intentionally have no target.
 lhs=re.search(r'\$var\(([A-Za-z_][A-Za-z0-9_]*)\)\s*=\s*$',body[:call.start()]);need(lhs is not None,'DID_STATUS_ASSIGNMENT');status_name=lhs[1]
 success=list(re.finditer(r'if\s*\(\s*\$var\('+re.escape(status_name)+r'\)\s*==\s*200\s*\)\s*\{',body));need(len(success)==1,'DID_SUCCESS_BRANCH');branch=success[0];opening=body.index('{',branch.start(),branch.end());masked=mask(body);depth=1;closing=None
 for i in range(opening+1,len(body)):
  if masked[i]=='{':depth+=1
  elif masked[i]=='}':
   depth-=1
   if depth==0:closing=i;break
 need(closing is not None,'DID_SUCCESS_BRACES');need(not re.search(r'\$var\(phone11_did_(?:action|code)\)',clean),'DID_RESPONSE_VARIABLE_COLLISION')
 old_success=body[opening+1:closing];need(len(re.findall(r'jansson_get\s*\(\s*"target"',old_success))==1 and len(re.findall(r'\$sht\(did_cache\s*=>\s*\$rU\)\s*=',old_success))==1,'DID_SUCCESS_SHAPE')
 # Preserve the original cache/log statements only after response admission.
 guard="""
            $var(phone11_did_action) = $null;
            $var(phone11_did_code) = $null;
            $var(did_target) = $null;
            jansson_get("action", $var(api_result), "$var(phone11_did_action)");
            jansson_get("target", $var(api_result), "$var(did_target)");
            if ($var(phone11_did_action) == "reject") {
                jansson_get("code", $var(api_result), "$var(phone11_did_code)");
                if ($var(phone11_did_code) == 403) { sl_send_reply("403", "Forbidden"); exit; }
                if ($var(phone11_did_code) == 500) { sl_send_reply("500", "Routing Failed"); exit; }
                sl_send_reply("404", "Not Found");
                exit;
            }
            if (($var(phone11_did_action) != "bridge" &&
                 $var(phone11_did_action) != "freeswitch" &&
                 $var(phone11_did_action) != "ring_all") ||
                $var(did_target) == $null || $var(did_target) == "") {
                sl_send_reply("404", "Not Found");
                exit;
            }
"""
 # Remove only the old unconditional target extraction (new guard already does it).
 admitted=re.sub(r'jansson_get\s*\(\s*"target"\s*,\s*\$var\(api_result\)\s*,\s*"\$var\(did_target\)"\s*\)\s*;', '',text[start+opening+1:start+closing],count=1)
 replacements=[(start+url_matches[0].start(),start+url_matches[0].end(),url_text),(start+call.start(),start+call.end(),call_text),(start+opening+1,start+closing,guard+admitted)]
 candidate=text
 for left,right,value in sorted(replacements,reverse=True):candidate=candidate[:left]+value+candidate[right:]
 # Only request construction and HTTP200 admission change; transport else/consumer stay exact.
 new_clean=code(candidate);new_start,new_end=route_span(new_clean);need(new_start==start,'DID_REPLACEMENT_SCOPE');need(candidate[:start]==text[:start]and candidate[new_end:]==text[end:],'DID_OUTSIDE_ROUTE_DRIFT')
 new_body=new_clean[new_start:new_end];need('?secret='not in new_body and '&number='not in new_body,'DID_QUERY_SECRET_REMAINED');need(mask(new_body).count('http_client_query')==1,'DID_NEW_QUERY_COUNT')
 return Rendered(candidate.encode(),sha(candidate.encode()))
