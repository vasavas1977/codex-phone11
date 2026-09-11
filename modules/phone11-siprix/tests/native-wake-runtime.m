#define PHONE11_VOIP_WAKE_COMMISSIONED 1
#define main BaselineRuntimeMain
#import "native-runtime.m"
#undef main
static int delegateRestores;
@implementation Phone11WakeCoordinator
+ (void)restoreCallKitDelegate { delegateRestores++; }
- (void)providerDidReset:(CXProvider *)provider {}
@end

int main(void) {
 @autoreleasepool {
  P11SiprixRuntime *runtime = P11SiprixRuntime.shared;
  NSDictionary *sip = @{@"sipServer":@"invalid.example", @"sipExtension":@"test", @"sipPassword":@"fake-test-password", @"transport":@"TLS"};
  NSString *uuid = @"11111111-1111-4111-8111-111111111111";
  NSMutableDictionary *binding = [@{@"bindingId":@"binding-test", @"ownerUserId":@17, @"tenantId":@2, @"deviceId":@"device-test", @"sessionBinding":@"session-test", @"expiresAt":@(P11NowMs()+600000)} mutableCopy];
  NSMutableDictionary *context = [binding mutableCopy]; context[@"v"]=@1; context[@"callUUID"]=uuid;
  context[@"grantExpiresAt"] = binding[@"expiresAt"]; context[@"expiresAt"]=@(P11NowMs()+30000);
  __block int readyCount=0; __block NSError *wakeError;
  NSMutableArray *events = [NSMutableArray new];
  void (^ready)(NSError *) = ^(NSError *error) { readyCount++; wakeError=error; };
  void (^event)(NSDictionary *) = ^(NSDictionary *value) { [events addObject:value]; };
  [Phone11Siprix prepareIncomingWake:context sip:sip event:event completion:ready];
  CHECK(initializes==1 && registrations==1 && incomingPushes==1 && readyCount==0);
  CHECK(runtime.wakeBridge && runtime.accounts.count==1 && runtime.calls.count==0);
  CHECK(runtime.accountConfig[@"sipPassword"] && ![runtime snapshot][@"sipPassword"]);
  __block id result; __block NSString *error;
  RCTPromiseResolveBlock resolve=^(id value){ result=value; error=nil; };
  RCTPromiseRejectBlock reject=^(NSString *code,NSString *message,NSError *err){ error=code; result=nil; };
  Phone11Siprix *js=[Phone11Siprix new];
  [js getSnapshot:resolve rejecter:reject];
  CHECK(result[@"nativeWake"] && [result[@"calls"] count]==0);
  [js destroy:resolve rejecter:reject]; CHECK([error isEqual:@"E_WAKE_ADOPTION_REQUIRED"] && shutdowns==0);
  [js initialize:@{} resolver:resolve rejecter:reject]; CHECK([error isEqual:@"E_WAKE_ADOPTION_REQUIRED"] && initializes==1);
  NSMutableDictionary *other=[binding mutableCopy]; other[@"sessionBinding"]=@"replacement-login";
  [js adoptIncomingWake:other sip:sip resolver:resolve rejecter:reject]; CHECK([error isEqual:@"E_WAKE_OWNER"] && shutdowns==0);
  [runtime receive:@"registration" data:@{@"accountId":@"10", @"regState":@0} generation:runtime.generation];
  CHECK(readyCount==1 && !wakeError);
  [runtime receive:@"registration" data:@{@"accountId":@"10", @"regState":@0} generation:runtime.generation]; CHECK(readyCount==1);
  [Phone11Siprix prepareIncomingWake:context sip:sip event:event completion:ready]; CHECK(wakeError && initializes==1);
  NSDictionary *incoming=@{@"callId":@"30", @"accountId":@"10", @"remoteUri":@"sip:test@invalid.example"};
  wakeHeader=@"wrong"; [runtime receive:@"callIncoming" data:incoming generation:runtime.generation];
  CHECK(rejects==1 && headerReads==1 && !runtime.calls.count);
  wakeHeader=uuid; [runtime receive:@"callIncoming" data:incoming generation:runtime.generation];
  CHECK(headerReads==2 && runtime.calls.count==1 && [events.lastObject[@"type"] isEqual:@"incoming"]);
  [js adoptIncomingWake:binding sip:sip resolver:resolve rejecter:reject];
  CHECK(!error && runtime.sink==js && !runtime.wakeBridge && initializes==1 && shutdowns==0);
  CHECK([result[@"calls"][0][@"wakeCallUUID"] isEqual:uuid]);
  [js restoreIncomingWakeDelegate:resolve rejecter:reject]; CHECK(delegateRestores==1);
  [Phone11Siprix answerIncomingWake:@"22222222-2222-4222-8222-222222222222" completion:ready]; CHECK(wakeError && accepts==0);
  [Phone11Siprix answerIncomingWake:uuid completion:ready]; CHECK(!wakeError && accepts==1 && [runtime.calls[@"30"][@"wakeSystemAnswered"] boolValue]);
  [Phone11Siprix answerIncomingWake:uuid completion:ready]; CHECK(accepts==1);
  CHECK(activations==0 && !runtime.audioSessionActive);
  [Phone11Siprix setIncomingWakeAudioSession:AVAudioSession.sharedInstance active:YES];
  CHECK(activations==1 && runtime.audioSessionActive);
  [Phone11Siprix setIncomingWakeAudioSession:AVAudioSession.sharedInstance active:YES]; CHECK(activations==1);
  [runtime receive:@"callConnected" data:@{@"callId":@"30"} generation:runtime.generation];
  CHECK([events.lastObject[@"type"] isEqual:@"connected"]);
  NSMutableDictionary *expired=[runtime.wakeContext mutableCopy]; expired[@"expiresAt"]=@1; runtime.wakeContext=expired;
  [js adoptIncomingWake:binding sip:sip resolver:resolve rejecter:reject]; CHECK(!error); // TTL is for pending, not an answered call.
  [Phone11Siprix endIncomingWake:@"22222222-2222-4222-8222-222222222222"]; CHECK(byes==0);
  [Phone11Siprix endIncomingWake:uuid]; [Phone11Siprix endIncomingWake:uuid]; CHECK(byes==1);
  [runtime receive:@"callTerminated" data:@{@"callId":@"30", @"statusCode":@200} generation:runtime.generation];
  CHECK(!runtime.wakeContext && [events.lastObject[@"type"] isEqual:@"terminated"]);
  [Phone11Siprix setIncomingWakeAudioSession:AVAudioSession.sharedInstance active:NO]; CHECK(deactivations==1 && !runtime.audioSessionActive);
  [Phone11Siprix setIncomingWakeAudioSession:AVAudioSession.sharedInstance active:NO]; CHECK(deactivations==1);
  // A foreground owner must enroll the exact config; a different session cannot resume it.
  [js bindForegroundWakeContext:binding sip:sip resolver:resolve rejecter:reject]; CHECK(!error);
  context[@"sessionBinding"]=@"replacement-login";
  [Phone11Siprix prepareIncomingWake:context sip:sip event:event completion:ready]; CHECK(wakeError && initializes==1);
  context[@"sessionBinding"]=binding[@"sessionBinding"];
  [Phone11Siprix prepareIncomingWake:context sip:sip event:event completion:ready]; CHECK(runtime.wakeContext && initializes==1 && registrations==2);
  [Phone11Siprix endIncomingWake:uuid]; CHECK(!runtime.wakeContext && runtime.initialized);
  [js destroy:resolve rejecter:reject]; CHECK(!runtime.initialized && shutdowns==1);
  CHECK(!runtime.accountConfig && !runtime.wakeOwner);
  // Immediate SDK End failure cannot retain a permanently busy wake runtime.
  [Phone11Siprix prepareIncomingWake:context sip:sip event:event completion:ready];
  CHECK(runtime.initialized && initializes==2);
  [runtime receive:@"registration" data:@{@"accountId":@"10", @"regState":@0} generation:runtime.generation];
  [runtime receive:@"callIncoming" data:incoming generation:runtime.generation];
  sdkCode=-10; [Phone11Siprix endIncomingWake:uuid]; sdkCode=0;
  CHECK(!runtime.initialized && !runtime.wakeContext && shutdowns==2);
  // Missing callback fallback is generation/UUID scoped; a stale timer is inert.
  [Phone11Siprix prepareIncomingWake:context sip:sip event:event completion:ready];
  [runtime receive:@"registration" data:@{@"accountId":@"10", @"regState":@0} generation:runtime.generation];
  [runtime receive:@"callIncoming" data:incoming generation:runtime.generation];
  NSUInteger oldGeneration=runtime.generation;
  [Phone11Siprix endIncomingWake:uuid]; CHECK(runtime.initialized && runtime.wakeEnding);
  [runtime cleanupWake:@"22222222-2222-4222-8222-222222222222" generation:oldGeneration]; CHECK(runtime.initialized);
  [runtime cleanupWake:uuid generation:oldGeneration]; CHECK(!runtime.initialized && shutdowns==3);
  [Phone11Siprix prepareIncomingWake:context sip:sip event:event completion:ready];
  [runtime cleanupWake:uuid generation:oldGeneration]; CHECK(runtime.initialized && shutdowns==3);
  [Phone11Siprix endIncomingWake:uuid]; CHECK(!runtime.initialized);
  context[@"expiresAt"]=@(P11NowMs()+60000);
  int count=initializes; [Phone11Siprix prepareIncomingWake:context sip:sip event:event completion:ready]; CHECK(wakeError && initializes==count);
  printf("PASS: %d native wake runtime assertions\n", assertions);
 }
 return 0;
}
