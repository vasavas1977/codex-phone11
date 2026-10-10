"""Configuration semantic checks, not a FreeSWITCH/RTP runtime substitute."""
import re,xml.etree.ElementTree as ET
from pathlib import Path
base=Path('/work/infra/configs/freeswitch/phone11-recording-anchor-candidate')
entry=ET.parse(base/'public-entry.xml');context=ET.parse(base/'context.xml')
conditions=entry.findall('.//condition')
assert re.fullmatch(conditions[0].attrib['expression'],'phone11-recording-3001')
assert not re.fullmatch(conditions[0].attrib['expression'],'191')
assert re.fullmatch(conditions[1].attrib['expression'],'10.0.1.69:ingress-v1')
for bad in ['103.35.99.1:ingress-v1','10x0x1x69:ingress-v1','10.0.1.69:returned-v1']:
 assert not re.fullmatch(conditions[1].attrib['expression'],bad)
assert conditions[1].find('anti-action').attrib['application']=='hangup'
actions=context.findall('.//action')
settings={a.attrib['data'].split('=',1)[0]:a.attrib['data'].split('=',1)[1] for a in actions if a.attrib['application']=='set'}
assert all(settings[k]=='false' for k in ['bypass_media','bypass_media_after_bridge','proxy_media'])
assert settings['absolute_codec_string']=='PCMA'
assert not any(a.attrib['application']=='answer' for a in actions)
bridges=[a.attrib['data'] for a in actions if a.attrib['application']=='bridge']
assert bridges==['[sip_h_X-Phone11-Recording-Anchor=returned-v1]sofia/external/3001@10.0.1.69:5060']
assert context.find('.//context').attrib['name']=='phone11_recording_anchor'
print('PASS: fixed FS destination, source/marker refusal, media anchor and PCMA semantics')
