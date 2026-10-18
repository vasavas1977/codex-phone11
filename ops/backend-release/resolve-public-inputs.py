"""Anonymous fixed primary public registry metadata GETs only; no pull/install/build."""
import base64,hashlib,json,os,re,urllib.request
from pathlib import Path
HERE=Path(__file__).absolute().parent;OUT=HERE/'public-inputs'
H=lambda raw:hashlib.sha256(raw).hexdigest()
def get(url,headers=None):
 req=urllib.request.Request(url,headers=headers or {},method='GET')
 with urllib.request.urlopen(req,timeout=15) as response:
  raw=response.read(262145);assert len(raw)<=262144;return raw,dict(response.headers)
def put(name,raw):
 p=OUT/name;fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 try:os.write(fd,raw);os.fsync(fd)
 finally:os.close(fd)
 return {'path':str(p.relative_to(HERE)),'sha256':H(raw),'bytes':len(raw)}
def main():
 OUT.mkdir(mode=0o700,exist_ok=True)
 token_raw,_=get('https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/node:pull');token=json.loads(token_raw)['token']
 headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json'}
 def manifest(reference):
  raw,meta=get('https://registry-1.docker.io/v2/library/node/manifests/'+reference,headers);digest=next(v for k,v in meta.items() if k.lower()=='docker-content-digest');assert digest=='sha256:'+H(raw);return raw,digest
 raw,index_digest=manifest('22-alpine');index=json.loads(raw);files={'nodeIndex':put('node22-alpine-index.json',raw)};platforms={}
 for arch in ('amd64','arm64'):
  matches=[v for v in index['manifests'] if v['platform'].get('os')=='linux' and v['platform'].get('architecture')==arch];assert len(matches)==1;descriptor=matches[0];body,digest=manifest(descriptor['digest']);assert digest==descriptor['digest'];m=json.loads(body);files['node-'+arch]=put('node22-alpine-'+arch+'-manifest.json',body);config_digest=m['config']['digest'];config,_=get('https://registry-1.docker.io/v2/library/node/blobs/'+config_digest,headers);assert config_digest=='sha256:'+H(config);v=json.loads(config);assert v['os']=='linux' and v['architecture']==arch;files['node-'+arch+'-config']=put('node22-alpine-'+arch+'-config.json',config);platforms[arch]={'manifestDigest':digest,'configDigest':config_digest,'configOnBuildValue':v['config'].get('OnBuild'),'configOnBuildKeyPresent':'OnBuild' in v['config'],'configVolumeValue':v['config'].get('Volumes'),'configVolumeKeyPresent':'Volumes' in v['config'],'publicNodeVersion':next(x.split('=',1)[1] for x in v['config']['Env'] if x.startswith('NODE_VERSION=')),'rootfsDiffIdsSha256':H(json.dumps(v['rootfs']['diff_ids'],separators=(',',':')).encode())}
 npm={}
 for package,version in [('pnpm','9.12.0'),('esbuild','0.25.12'),('@esbuild/linux-x64','0.25.12'),('@esbuild/linux-arm64','0.25.12')]:
  raw,_=get('https://registry.npmjs.org/'+package.replace('/','%2f')+'/'+version);v=json.loads(raw);assert v['name']==package and v['version']==version and v['dist']['integrity'].startswith('sha512-');name=package.replace('@','').replace('/','-');files[name]=put(name+'-'+version+'-metadata.json',raw);npm[package]={'version':version,'integrity':v['dist']['integrity'],'tarball':v['dist']['tarball'],'sha1':v['dist']['shasum']}
 result={'schema':'phone11-backend-primary-public-registry-inputs/v1','nodeTagQueried':'docker.io/library/node:22-alpine','nodeImmutableIndex':'docker.io/library/node@'+index_digest,'nodePlatforms':platforms,'npm':npm,'pnpmCorepackSpec':'pnpm@9.12.0+sha512.'+base64.b64decode(npm['pnpm']['integrity'].split('-',1)[1]).hex(),'files':files,'targetPlatformSelected':None,'anonymousPublicMetadataGETOnly':True,'userDockerConfigOrCredentialsRead':False,'packageTarballsFetched':False,'imagePulled':False,'buildExecuted':False,'targetQueried':False};f=put('PUBLIC-INPUT-PINS.json',(json.dumps(result,sort_keys=True,indent=2)+'\n').encode());print(json.dumps({'pins':f,'nodeImmutableIndex':result['nodeImmutableIndex'],'platforms':{k:v['publicNodeVersion'] for k,v in platforms.items()},'pnpm':npm['pnpm']['version'],'buildExecuted':False}))
if __name__=='__main__':main()
