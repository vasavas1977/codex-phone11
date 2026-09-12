#define PHONE11_VOIP_WAKE_COMMISSIONED 1
#define main BaselineRuntimeMain
#import "native-runtime.m"
#undef main
static int delegateRestores;
@implementation Phone11WakeCoordinator
+ (void)restoreCallKitDelegate { delegateRestores++; }
+ (void)recordRegistrationState:(NSInteger)state fresh:(BOOL)fresh {}
+ (void)recordRegistrationFailureStatus:(NSNumber *)status {}
+ (void)recordRefreshResult:(NSInteger)code {}
- (void)providerDidReset:(CXProvider *)provider {}
@end

#import <objc/runtime.h>
static NSMutableArray *refreshTimers;
@interface P11TestRuntime : P11SiprixRuntime @end
@implementation P11TestRuntime
- (void)scheduleWakeRefreshAfter:(double)delay block:(dispatch_block_t)block {
  CHECK(delay==1.1); [refreshTimers addObject:[block copy]];
}
@end
int main(void) {
 @autoreleasepool {
  P11SiprixRuntime *runtime = P11SiprixRuntime.shared;
  object_setClass(runtime, P11TestRuntime.class); refreshTimers=[NSMutableArray new];
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
  [sdkDelegate onAccountRegState:10 regState:RegStateSuccess response:@"200 OK"]; flush();
  CHECK(readyCount==1 && !wakeError);
  [sdkDelegate onAccountRegState:10 regState:RegStateSuccess response:@"200 OK"]; flush(); CHECK(readyCount==1);
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
  // A recreated foreground runtime can retain the same SIP account but has no
  // verified wake owner. Credentials alone must never authorize the saved grant.
  runtime.wakeOwner=nil;
  [Phone11Siprix prepareIncomingWake:context sip:sip event:event completion:ready];
  CHECK([wakeError.localizedDescription isEqual:@"Incoming wake owner missing."] && !runtime.wakeContext && registrations==1);
  // A foreground owner must enroll the exact config; a different session cannot resume it.
  [js bindForegroundWakeContext:binding sip:sip resolver:resolve rejecter:reject]; CHECK(!error);
  context[@"sessionBinding"]=@"replacement-login";
  [Phone11Siprix prepareIncomingWake:context sip:sip event:event completion:ready]; CHECK(wakeError && initializes==1);
  CHECK([wakeError.localizedDescription isEqual:@"Incoming wake owner mismatch."]);
  context[@"sessionBinding"]=binding[@"sessionBinding"];
  // Guard reasons are fixed labels; the same rejected states never register.
  NSMutableDictionary *differentSip=[sip mutableCopy]; differentSip[@"sipPassword"]=@"different-private-test-password";
  [Phone11Siprix prepareIncomingWake:context sip:differentSip event:event completion:ready];
  CHECK([wakeError.localizedDescription isEqual:@"Incoming wake account configuration mismatch."] && !runtime.wakeContext && registrations==1);
  runtime.accounts[@"99"]=[NSMutableDictionary new];
  [Phone11Siprix prepareIncomingWake:context sip:sip event:event completion:ready];
  CHECK([wakeError.localizedDescription isEqual:@"Incoming wake account count mismatch."] && !runtime.wakeContext && registrations==1);
  [runtime.accounts removeObjectForKey:@"99"];
  runtime.sink=nil;
  [Phone11Siprix prepareIncomingWake:context sip:sip event:event completion:ready];
  CHECK([wakeError.localizedDescription isEqual:@"Incoming wake runtime sink missing."] && !runtime.wakeContext && registrations==1);
  runtime.sink=js;
  int pendingBefore=readyCount;
  [Phone11Siprix prepareIncomingWake:context sip:sip event:event completion:ready]; CHECK(runtime.wakeContext && initializes==1 && registrations==1);
  flush(); CHECK(readyCount==pendingBefore && runtime.wakeReady!=nil);
  [Phone11Siprix endIncomingWake:uuid]; CHECK(!runtime.wakeContext && runtime.initialized);
  // Real SDK ingress precedes arm, but main-queue delivery follows it.
  for (NSNumber *stale in @[@(RegStateFailed), @(RegStateSuccess)]) {
    int before=readyCount;
    [sdkDelegate onAccountRegState:10 regState:stale.intValue response:@"private-response"];
    [Phone11Siprix prepareIncomingWake:context sip:sip event:event completion:ready];
    flush(); CHECK(readyCount==before && runtime.wakeReady!=nil);
    RegState fresh=stale.intValue==RegStateFailed ? RegStateSuccess : RegStateFailed;
    [sdkDelegate onAccountRegState:10 regState:fresh response:@"private-response"];
    flush(); CHECK(readyCount==before+1 && (wakeError!=nil)==(fresh==RegStateFailed));
    [Phone11Siprix endIncomingWake:uuid];
  }
  // A callback from an old SDK generation is never accepted, even when fresh.
  int generationBefore=readyCount;
  [Phone11Siprix prepareIncomingWake:context sip:sip event:event completion:ready];
  runtime.delegate.generation=runtime.generation-1;
  [sdkDelegate onAccountRegState:10 regState:RegStateSuccess response:@"200 OK"];
  runtime.delegate.generation=runtime.generation;
  flush(); CHECK(readyCount==generationBefore && runtime.wakeReady!=nil);
  [sdkDelegate onAccountRegState:10 regState:RegStateSuccess response:@"200 OK"];
  flush(); CHECK(readyCount==generationBefore+1 && !wakeError);
  [Phone11Siprix endIncomingWake:uuid];
  // An inline SDK callback is fresh, despite deferred delivery.
  int before=readyCount; int registersBefore=registrations; pushRegistrationState=RegStateSuccess;
  [Phone11Siprix prepareIncomingWake:context sip:sip event:event completion:ready];
  pushRegistrationState=-1; flush(); CHECK(readyCount==before+1 && !wakeError && registrations==registersBefore);
  [Phone11Siprix endIncomingWake:uuid];
  // A genuine fresh failure from push recovery remains terminal without a retry.
  before=readyCount; pushRegistrationState=RegStateFailed;
  [Phone11Siprix prepareIncomingWake:context sip:sip event:event completion:ready];
  pushRegistrationState=-1; flush();
  CHECK(readyCount==before+1 && [wakeError.localizedDescription isEqual:@"Incoming wake registration failed."] && registrations==registersBefore);
  [Phone11Siprix endIncomingWake:uuid];
  // A fresh success delivered after the wake deadline cannot authorize ready.
  before=readyCount;
  [Phone11Siprix prepareIncomingWake:context sip:sip event:event completion:ready];
  [sdkDelegate onAccountRegState:10 regState:RegStateSuccess response:@"200 OK"];
  NSMutableDictionary *late=[runtime.wakeContext mutableCopy]; late[@"expiresAt"]=@1; runtime.wakeContext=late;
  flush(); CHECK(readyCount==before+1 && [wakeError.localizedDescription isEqual:@"Incoming wake expired."]);
  [Phone11Siprix endIncomingWake:uuid];
  [js destroy:resolve rejecter:reject]; CHECK(!runtime.initialized && shutdowns==1);
  CHECK(!runtime.accountConfig && !runtime.wakeOwner);
  // Immediate SDK End failure cannot retain a permanently busy wake runtime.
  [Phone11Siprix prepareIncomingWake:context sip:sip event:event completion:ready];
  CHECK(runtime.initialized && initializes==2 && registrations==registersBefore+1);
  [sdkDelegate onAccountRegState:10 regState:RegStateSuccess response:@"200 OK"]; flush();
  [runtime receive:@"callIncoming" data:incoming generation:runtime.generation];
  sdkCode=-10; [Phone11Siprix endIncomingWake:uuid]; sdkCode=0;
  CHECK(!runtime.initialized && !runtime.wakeContext && shutdowns==2);
  // Missing callback fallback is generation/UUID scoped; a stale timer is inert.
  [Phone11Siprix prepareIncomingWake:context sip:sip event:event completion:ready];
  [sdkDelegate onAccountRegState:10 regState:RegStateSuccess response:@"200 OK"]; flush();
  [runtime receive:@"callIncoming" data:incoming generation:runtime.generation];
  NSUInteger oldGeneration=runtime.generation;
  [Phone11Siprix endIncomingWake:uuid]; CHECK(runtime.initialized && runtime.wakeEnding);
  [runtime cleanupWake:@"22222222-2222-4222-8222-222222222222" generation:oldGeneration]; CHECK(runtime.initialized);
  [runtime cleanupWake:uuid generation:oldGeneration]; CHECK(!runtime.initialized && shutdowns==3);
  [Phone11Siprix prepareIncomingWake:context sip:sip event:event completion:ready];
  [runtime cleanupWake:uuid generation:oldGeneration]; CHECK(runtime.initialized && shutdowns==3);
  [Phone11Siprix endIncomingWake:uuid]; CHECK(!runtime.initialized);
  // Cold registration request errors still fail and release the new runtime.
  registrationCode=-10; before=readyCount;
  [Phone11Siprix prepareIncomingWake:context sip:sip event:event completion:ready];
  registrationCode=0;
  CHECK(readyCount==before+1 && [wakeError.localizedDescription isEqual:@"Incoming wake registration request failed."] && !runtime.initialized);
  context[@"expiresAt"]=@(P11NowMs()+60000);
  int count=initializes; [Phone11Siprix prepareIncomingWake:context sip:sip event:event completion:ready]; CHECK(wakeError && initializes==count);
  // Cold calls release their native-only runtime after termination, allowing
  // both another native wake and later foreground initialization without adoption.
  context[@"expiresAt"]=@(P11NowMs()+30000);
  __weak Phone11Siprix *nativeOwner;
  NSUInteger nativeGeneration=0;
  for (int attempt=0; attempt<2; attempt++) {
    @autoreleasepool {
      before=readyCount;
      [Phone11Siprix prepareIncomingWake:context sip:sip event:event completion:ready];
      CHECK(runtime.wakeContext && runtime.wakeBridge && runtime.sink==runtime.wakeBridge);
      CHECK(runtime.generation>nativeGeneration); nativeGeneration=runtime.generation;
      nativeOwner=runtime.wakeBridge;
      [sdkDelegate onAccountRegState:10 regState:RegStateSuccess response:@"200 OK"]; flush();
      CHECK(readyCount==before+1 && !wakeError);
      NSString *callId=attempt==0 ? @"41" : @"42";
      [runtime receive:@"callIncoming" data:@{@"callId":callId,@"accountId":@"10",@"remoteUri":@"sip:test@invalid.example"} generation:runtime.generation];
      [Phone11Siprix answerIncomingWake:uuid completion:ready]; CHECK(!wakeError);
      [runtime receive:@"callConnected" data:@{@"callId":callId} generation:runtime.generation];
      [runtime receive:@"callTerminated" data:@{@"callId":callId,@"statusCode":@200} generation:runtime.generation];
      CHECK(!runtime.wakeContext && !runtime.initialized && !runtime.wakeBridge && runtime.calls.count==0);
    }
    CHECK(!nativeOwner && !runtime.sink && !runtime.wakeOwner);
  }
  [js initialize:@{} resolver:resolve rejecter:reject];
  CHECK(!error && runtime.initialized && runtime.sink==js);
  [js destroy:resolve rejecter:reject]; CHECK(!runtime.initialized);
  void (^startNativeCall)(void (^)(NSDictionary *)) = ^(void (^notify)(NSDictionary *)) {
    [Phone11Siprix prepareIncomingWake:context sip:sip event:notify completion:ready];
    [sdkDelegate onAccountRegState:10 regState:RegStateSuccess response:@"200 OK"]; flush();
    [runtime receive:@"callIncoming" data:incoming generation:runtime.generation];
    [Phone11Siprix answerIncomingWake:uuid completion:ready];
    [runtime receive:@"callConnected" data:@{@"callId":@"30"} generation:runtime.generation];
  };
  // Same-generation authenticated adoption during notification preserves JS.
  @autoreleasepool {
    startNativeCall(^(NSDictionary *value) {
      if ([value[@"type"] isEqual:@"terminated"]) [js adoptIncomingWake:binding sip:sip resolver:resolve rejecter:reject];
    });
    nativeOwner=runtime.wakeBridge; nativeGeneration=runtime.generation;
    [runtime receive:@"callTerminated" data:@{@"callId":@"30",@"statusCode":@200} generation:runtime.generation];
    CHECK(!error && runtime.initialized && runtime.sink==js && !runtime.wakeContext && runtime.generation==nativeGeneration);
  }
  CHECK(!nativeOwner && !runtime.wakeBridge);
  [js destroy:resolve rejecter:reject];
  // Adoption during the earlier JS event emission is protected as well.
  startNativeCall(event); runtime.wakeBridge.observing=YES;
  nativeGeneration=runtime.generation;
  testEmitHook=^(id value) {
    if ([value[@"type"] isEqual:@"callTerminated"]) [js adoptIncomingWake:binding sip:sip resolver:resolve rejecter:reject];
  };
  [runtime receive:@"callTerminated" data:@{@"callId":@"30",@"statusCode":@200} generation:runtime.generation];
  testEmitHook=nil;
  CHECK(!error && runtime.initialized && runtime.sink==js && runtime.generation==nativeGeneration && !runtime.wakeContext);
  [js destroy:resolve rejecter:reject];
  // Coordinator-style synchronous End followed by a replacement wake must not
  // let the old terminal callback clear or shut down its successor.
  startNativeCall(^(NSDictionary *value) {
    if ([value[@"type"] isEqual:@"terminated"]) {
      [Phone11Siprix endIncomingWake:uuid];
      [Phone11Siprix prepareIncomingWake:context sip:sip event:event completion:ready];
    }
  });
  nativeGeneration=runtime.generation;
  [runtime receive:@"callTerminated" data:@{@"callId":@"30",@"statusCode":@200} generation:runtime.generation];
  CHECK(runtime.initialized && runtime.generation>nativeGeneration && runtime.wakeContext && runtime.wakeBridge);
  [Phone11Siprix endIncomingWake:uuid]; CHECK(!runtime.initialized);
  // Even an early terminal event can settle a pending prepare completion that
  // starts a replacement runtime. The outer cleanup must leave it intact.
  [Phone11Siprix prepareIncomingWake:context sip:sip event:event completion:^(NSError *failure) {
    if (failure) {
      [runtime shutdown];
      [Phone11Siprix prepareIncomingWake:context sip:sip event:event completion:ready];
    }
  }];
  [runtime receive:@"callIncoming" data:incoming generation:runtime.generation];
  nativeGeneration=runtime.generation;
  [runtime receive:@"callTerminated" data:@{@"callId":@"30",@"statusCode":@200} generation:runtime.generation];
  CHECK(runtime.initialized && runtime.generation>nativeGeneration && runtime.wakeContext && runtime.wakeBridge);
  [Phone11Siprix endIncomingWake:uuid];
  // Failed shutdown quarantines the only SDK and cannot create a second owner.
  startNativeCall(event); shutdownCode=-10;
  [runtime receive:@"callTerminated" data:@{@"callId":@"30",@"statusCode":@200} generation:runtime.generation];
  CHECK(runtime.quarantined && !runtime.wakeOwner && !runtime.wakeBridge);
  int beforeInit=initializes;
  [Phone11Siprix prepareIncomingWake:context sip:sip event:event completion:ready];
  CHECK(wakeError && initializes==beforeInit && runtime.quarantined);
  shutdownCode=0; [runtime shutdown]; CHECK(!runtime.initialized && !runtime.quarantined);
  // Exercise the actual push/claim gap using native-only monotonic ingress.
  [js initialize:@{} resolver:resolve rejecter:reject];
  [js createAccount:sip resolver:resolve rejecter:reject];
  [js bindForegroundWakeContext:binding sip:sip resolver:resolve rejecter:reject];
  NSTimeInterval pushAt=NSProcessInfo.processInfo.systemUptime;
  [sdkDelegate onAccountRegState:10 regState:RegStateSuccess response:@"200 OK"]; flush();
  before=readyCount; int refreshBefore=registrations;
  [Phone11Siprix prepareIncomingWake:context sip:sip receivedAt:pushAt event:event completion:ready];
  flush(); CHECK(readyCount==before+1 && !wakeError);
  dispatch_block_t timer=refreshTimers.lastObject; timer(); flush();
  CHECK(registrations==refreshBefore);
  [Phone11Siprix endIncomingWake:uuid];
  // Pre-push success is never sufficient; one delayed refresh must get a real
  // success callback, and an SDK return of zero alone cannot complete ready.
  pushAt=NSProcessInfo.processInfo.systemUptime;
  before=readyCount; refreshBefore=registrations;
  [Phone11Siprix prepareIncomingWake:context sip:sip receivedAt:pushAt event:event completion:ready];
  flush(); CHECK(readyCount==before);
  timer=refreshTimers.lastObject; timer(); flush();
  CHECK(registrations==refreshBefore+1 && readyCount==before);
  [sdkDelegate onAccountRegState:10 regState:RegStateSuccess response:@"200 OK"]; flush();
  CHECK(readyCount==before+1 && !wakeError);
  [Phone11Siprix endIncomingWake:uuid];
  // Newer states invalidate post-push success; in-progress waits for its own
  // completion, removed can refresh, and a genuine failure stays fatal.
  for (NSNumber *state in @[@(RegStateInProgress),@(RegStateRemoved),@(RegStateFailed)]) {
    pushAt=NSProcessInfo.processInfo.systemUptime;
    [sdkDelegate onAccountRegState:10 regState:RegStateSuccess response:@"200 OK"]; flush();
    [sdkDelegate onAccountRegState:10 regState:state.intValue response:@"private"];
    before=readyCount; refreshBefore=registrations;
    [Phone11Siprix prepareIncomingWake:context sip:sip receivedAt:pushAt event:event completion:ready];
    flush();
    CHECK(readyCount==before+(state.intValue==RegStateFailed ? 1 : 0));
    timer=refreshTimers.lastObject; timer(); flush();
    CHECK(registrations==refreshBefore+(state.intValue==RegStateRemoved ? 1 : 0));
    [Phone11Siprix endIncomingWake:uuid];
  }
  // Timer expiry/cancellation/adoption and SDK request errors are bounded.
  for (NSString *mode in @[@"expired",@"cancelled",@"adopted",@"request_error"]) {
    before=readyCount; refreshBefore=registrations;
    [Phone11Siprix prepareIncomingWake:context sip:sip receivedAt:NSProcessInfo.processInfo.systemUptime event:event completion:ready];
    timer=refreshTimers.lastObject;
    if ([mode isEqual:@"expired"]) { NSMutableDictionary *c=[runtime.wakeContext mutableCopy]; c[@"expiresAt"]=@1; runtime.wakeContext=c; }
    if ([mode isEqual:@"cancelled"]) [Phone11Siprix endIncomingWake:uuid];
    if ([mode isEqual:@"adopted"]) { runtime.wakeBridge=js; Phone11Siprix *otherJS=[Phone11Siprix new]; [otherJS adoptIncomingWake:binding sip:sip resolver:resolve rejecter:reject]; CHECK(!error); runtime.wakeBridge=otherJS; }
    if ([mode isEqual:@"request_error"]) registrationCode=-10;
    timer(); flush(); registrationCode=0;
    CHECK(registrations==refreshBefore+([mode isEqual:@"request_error"] ? 1 : 0));
    if ([mode isEqual:@"request_error"]) CHECK([wakeError.localizedDescription isEqual:@"Incoming wake registration request failed."]);
    [Phone11Siprix endIncomingWake:uuid];
    if ([mode isEqual:@"adopted"]) { [runtime shutdown]; [js initialize:@{} resolver:resolve rejecter:reject]; [js createAccount:sip resolver:resolve rejecter:reject]; [js bindForegroundWakeContext:binding sip:sip resolver:resolve rejecter:reject]; }
  }
  // A proof for an old owner/account/lease, or with a newer ingress still
  // unprocessed, cannot satisfy the deferred claim-gap completion.
  for (NSString *invalid in @[@"owner",@"account",@"lease",@"unprocessed"]) {
    pushAt=NSProcessInfo.processInfo.systemUptime;
    [sdkDelegate onAccountRegState:10 regState:RegStateSuccess response:@"200 OK"]; flush();
    NSMutableDictionary *proof=[runtime.registrationProof mutableCopy];
    if ([invalid isEqual:@"owner"]) { NSMutableDictionary *o=[runtime.wakeOwner mutableCopy]; o[@"sessionBinding"]=@"old-session"; proof[@"owner"]=o; }
    if ([invalid isEqual:@"account"]) proof[@"accountId"]=@"99";
    if ([invalid isEqual:@"lease"]) proof[@"lease"]=@"old-lease";
    if ([invalid isEqual:@"unprocessed"]) runtime.delegate.registrationIngress++;
    runtime.registrationProof=proof;
    before=readyCount;
    [Phone11Siprix prepareIncomingWake:context sip:sip receivedAt:pushAt event:event completion:ready];
    flush(); CHECK(readyCount==before && runtime.wakeReady);
    [Phone11Siprix endIncomingWake:uuid];
  }
  // Older delivery cannot overwrite a newer failed/in-progress proof.
  pushAt=NSProcessInfo.processInfo.systemUptime;
  NSUInteger latest=[runtime.delegate registrationBoundary]+2;
  NSDictionary *(^registrationData)(NSUInteger, NSInteger) = ^NSDictionary *(NSUInteger serial, NSInteger state) {
    return @{@"accountId":@"10",@"regState":@(state),@"registrationIngress":@(serial),
      @"registrationAt":@(NSProcessInfo.processInfo.systemUptime),@"registrationLease":runtime.lease,
      @"registrationOwner":runtime.wakeOwner};
  };
  runtime.delegate.registrationIngress=latest;
  [runtime receive:@"registration" data:registrationData(latest,RegStateInProgress) generation:runtime.generation];
  [runtime receive:@"registration" data:registrationData(latest-1,RegStateSuccess) generation:runtime.generation];
  CHECK([runtime.registrationProof[@"state"] intValue]==RegStateInProgress);
  before=readyCount; refreshBefore=registrations;
  [Phone11Siprix prepareIncomingWake:context sip:sip receivedAt:pushAt event:event completion:ready];
  timer=refreshTimers.lastObject; timer(); flush(); CHECK(readyCount==before && registrations==refreshBefore);
  [Phone11Siprix endIncomingWake:uuid];
  // Ingress assigned on a worker can precede enqueueing. The timer retains one
  // continuation, and a subsequently drained Removed event issues one refresh.
  [Phone11Siprix prepareIncomingWake:context sip:sip receivedAt:NSProcessInfo.processInfo.systemUptime event:event completion:ready];
  timer=refreshTimers.lastObject; refreshBefore=registrations;
  NSUInteger withheld=++runtime.delegate.registrationIngress;
  timer(); flush(); CHECK(registrations==refreshBefore && runtime.pendingWakeRefresh);
  [runtime receive:@"registration" data:registrationData(withheld,RegStateRemoved) generation:runtime.generation];
  CHECK(registrations==refreshBefore+1 && !runtime.pendingWakeRefresh && runtime.wakeReady);
  timer(); flush(); CHECK(registrations==refreshBefore+1);
  [sdkDelegate onAccountRegState:10 regState:RegStateSuccess response:@"200 OK"]; flush(); CHECK(!wakeError && !runtime.wakeReady);
  [Phone11Siprix endIncomingWake:uuid];
  // A saved timer cannot refresh a successor with the same public UUID.
  [Phone11Siprix prepareIncomingWake:context sip:sip receivedAt:NSProcessInfo.processInfo.systemUptime event:event completion:ready];
  timer=refreshTimers.lastObject; [Phone11Siprix endIncomingWake:uuid];
  [runtime shutdown]; [js initialize:@{} resolver:resolve rejecter:reject];
  [js createAccount:sip resolver:resolve rejecter:reject]; [js bindForegroundWakeContext:binding sip:sip resolver:resolve rejecter:reject];
  [Phone11Siprix prepareIncomingWake:context sip:sip receivedAt:NSProcessInfo.processInfo.systemUptime event:event completion:ready];
  refreshBefore=registrations; timer(); flush(); CHECK(registrations==refreshBefore && runtime.wakeReady);
  [Phone11Siprix endIncomingWake:uuid];
  // JS emission can synchronously replace the runtime during registration.
  [Phone11Siprix prepareIncomingWake:context sip:sip receivedAt:NSProcessInfo.processInfo.systemUptime event:event completion:ready];
  js.observing=YES; __block BOOL replaced=NO;
  testEmitHook=^(id value) {
    if (!replaced && [value[@"type"] isEqual:@"registration"]) {
      replaced=YES; [Phone11Siprix endIncomingWake:uuid]; [runtime shutdown];
      [js initialize:@{} resolver:resolve rejecter:reject]; [js createAccount:sip resolver:resolve rejecter:reject];
      [js bindForegroundWakeContext:binding sip:sip resolver:resolve rejecter:reject];
      [Phone11Siprix prepareIncomingWake:context sip:sip receivedAt:NSProcessInfo.processInfo.systemUptime event:event completion:ready];
    }
  };
  [sdkDelegate onAccountRegState:10 regState:RegStateSuccess response:@"200 OK"]; flush(); testEmitHook=nil;
  CHECK(replaced && runtime.wakeReady && runtime.wakeContext);
  [Phone11Siprix endIncomingWake:uuid];
  [runtime shutdown];
  printf("PASS: %d native wake runtime assertions\n", assertions);
 }
 return 0;
}
