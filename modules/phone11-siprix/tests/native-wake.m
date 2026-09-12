#import "../ios/Phone11Siprix.h"
#import <AVFoundation/AVFoundation.h>
// The fake implements the real facade; this declaration also permits the test
// to run while the SDK facade is being integrated in its separate source lane.
@interface Phone11Siprix (WakeTestContract)
+ (void)prepareIncomingWake:(NSDictionary *)context sip:(NSDictionary *)sip event:(void (^)(NSDictionary *))event completion:(void (^)(NSError *))completion;
+ (void)answerIncomingWake:(NSString *)uuid completion:(void (^)(NSError *))completion;
+ (void)endIncomingWake:(NSString *)uuid;
+ (void)setIncomingWakeAudioSession:(AVAudioSession *)session active:(BOOL)active;
@end
#import "../ios/Phone11WakeCoordinator.m"
#include <stdio.h>
#include <stdlib.h>
NSString *const AVAudioSessionCategoryPlayAndRecord=@"playAndRecord";
NSString *const AVAudioSessionModeVoiceChat=@"voiceChat";
static int checks, reports, ends, prepared, accepted, ordinaryAnswers, audioForwarded;
static BOOL audioError;
static BOOL delayReport, reportError;
static void (^reported)(NSError *);
static void (^sdkEvent)(NSDictionary *);
static void (^sdkReady)(NSError *);
static NSMutableArray *order;
static NSString *currentUUID, *endedWakeUUID;
static void check(BOOL ok) { checks++; if (!ok) { fprintf(stderr,"FAIL wake assertion %d\n",checks); exit(1); } }
@implementation AVAudioSession
+ (instancetype)sharedInstance { static AVAudioSession *value; if (!value) value=[self new]; return value; }
- (BOOL)setCategory:(NSString *)category mode:(NSString *)mode options:(AVAudioSessionCategoryOptions)options error:(NSError **)error {
 if (audioError && error) *error=[NSError errorWithDomain:@"fake" code:1 userInfo:nil]; return !audioError;
}
@end
@implementation RCTEventEmitter
- (void)sendEventWithName:(NSString *)name body:(id)body {}
- (void)invalidate {}
@end
@implementation Phone11Siprix
+ (void)prepareIncomingWake:(NSDictionary *)context sip:(NSDictionary *)sip event:(void (^)(NSDictionary *))event completion:(void (^)(NSError *))completion {
  prepared++; sdkEvent = [event copy]; sdkReady = [completion copy]; currentUUID = context[@"callUUID"];
  check(context[@"grant"] == nil && context[@"sipPassword"] == nil && context[@"grantExpiresAt"] != nil);
}
+ (void)answerIncomingWake:(NSString *)uuid completion:(void (^)(NSError *))completion { accepted++; completion(nil); }
+ (void)endIncomingWake:(NSString *)uuid { endedWakeUUID=uuid; }
+ (void)setIncomingWakeAudioSession:(AVAudioSession *)session active:(BOOL)active { audioForwarded++; }
@end
@implementation CXHandle
- (instancetype)initWithType:(CXHandleType)type value:(NSString *)value { if ((self = [super init])) self.value=value; return self; }
@end
@implementation CXCallUpdate
@end
@implementation CXAction
- (void)fulfill { self.testFulfilled=YES; }
- (void)fail { self.testFailed=YES; }
@end
@implementation CXCallAction
@end
@implementation CXAnswerCallAction
@end
@implementation CXEndCallAction
@end
@implementation CXProvider
- (void)setDelegate:(id<CXProviderDelegate>)delegate queue:(dispatch_queue_t)queue {}
- (void)reportNewIncomingCallWithUUID:(NSUUID *)uuid update:(CXCallUpdate *)update completion:(void (^)(NSError *))completion {
  reports++; [order addObject:@"report"]; check([update.remoteHandle.value isEqual:@"Phone11"]);
  if (delayReport) reported=[completion copy]; else completion(reportError ? [NSError errorWithDomain:@"fake" code:1 userInfo:nil] : nil);
}
- (void)reportCallWithUUID:(NSUUID *)uuid endedAtDate:(NSDate *)date reason:(CXCallEndedReason)reason { ends++; }
@end
@implementation RNCallKeep
+ (id)allocWithZone:(NSZone *)zone { static RNCallKeep *value; if (!value) value = [super allocWithZone:zone]; return value; }
+ (void)setup:(NSDictionary *)options { [self allocWithZone:nil].callKeepProvider=[CXProvider new]; }
- (void)provider:(CXProvider *)provider performAnswerCallAction:(CXAnswerCallAction *)action { ordinaryAnswers++; [action fulfill]; }
- (void)provider:(CXProvider *)provider performEndCallAction:(CXEndCallAction *)action { [action fulfill]; }
- (void)providerDidReset:(CXProvider *)provider {}
- (void)provider:(CXProvider *)provider didActivateAudioSession:(AVAudioSession *)session {}
- (void)provider:(CXProvider *)provider didDeactivateAudioSession:(AVAudioSession *)session {}
@end
@interface TestWake : Phone11WakeCoordinator
@property(nonatomic,strong) NSDictionary *saved;
@property(nonatomic,strong) NSMutableArray *requests;
@property(nonatomic,copy) void (^heldClaim)(NSDictionary *);
@property(nonatomic) BOOL hangClaim;
@property(nonatomic, strong) NSDictionary *heartbeatResponse;
@property(nonatomic, strong) NSMutableArray *timers;
@end
@implementation TestWake
- (double)now { return 1000000; }
- (void)scheduleAfter:(double)seconds block:(void (^)(void))block { [self.timers addObject:[block copy]]; }
- (NSDictionary *)readEnrollment { [order addObject:@"keychain"]; return self.saved; }
- (BOOL)writeEnrollment:(NSDictionary *)value { self.saved=value; return YES; }
- (void)request:(NSString *)operation completion:(void (^)(NSDictionary *))completion {
  [self.requests addObject:operation];
  if ([operation isEqual:@"claim"]) {
    if (self.hangClaim) self.heldClaim=completion;
    else { NSMutableDictionary *body=[self.saved mutableCopy]; body[@"status"]=@"pending"; body[@"sip"]=@{@"sipPassword":@"fake-only"}; completion(body); }
  } else if ([operation isEqual:@"ready"]) completion(self.connected ? self.heartbeatResponse : @{@"status":@"ready"});
  // Status intentionally pending: tests drive cancellation and SDK callbacks.
}
@end
static NSURLRequest *capturedRequest;
static int networkStarts;
@interface CaptureTask : NSURLSessionDataTask
@end
@implementation CaptureTask
- (void)resume { networkStarts++; }
- (void)cancel {}
@end
@interface CaptureSession : NSURLSession
@end
@implementation CaptureSession
- (NSURLSessionDataTask *)dataTaskWithRequest:(NSURLRequest *)request completionHandler:(void (^)(NSData *,NSURLResponse *,NSError *))completion {
 capturedRequest=request; return [CaptureTask new];
}
@end
@interface NetworkWake : Phone11WakeCoordinator
@property(nonatomic,copy) NSString *origin;
@end
@implementation NetworkWake
- (double)now { return 1000000; }
- (NSString *)apiOrigin { return self.origin; }
@end
static NSDictionary *enrollment(void) { return @{@"bindingId":@"11111111-1111-4111-8111-111111111111", @"sessionBinding":@"22222222-2222-4222-8222-222222222222", @"ownerUserId":@1, @"tenantId":@1, @"deviceId":@"device", @"expiresAt":@2000000, @"grant":@"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}; }
static NSDictionary *payload(void) { return @{@"v":@1,@"bindingId":enrollment()[@"bindingId"],@"callUUID":@"33333333-3333-4333-8333-333333333333",@"expiresAt":@1020000}; }
static TestWake *fresh(void) { TestWake *v=[TestWake new]; v.saved=enrollment(); v.requests=[NSMutableArray new]; v.timers=[NSMutableArray new]; order=[NSMutableArray new]; return v; }
static CXAnswerCallAction *answer(TestWake *v) { CXAnswerCallAction *a=[CXAnswerCallAction new]; a.callUUID=[[NSUUID alloc] initWithUUIDString:payload()[@"callUUID"]]; [v provider:v.provider performAnswerCallAction:a]; return a; }
int main(void) { @autoreleasepool {
  TestWake *v=fresh();
  if (!PHONE11_VOIP_WAKE_COMMISSIONED) {
    [v receivePayload:payload() completion:^{ [order addObject:@"complete"]; }];
    check(reports==1 && ends==1 && prepared==0 && v.requests.count==0);
    check([order isEqual:@[@"report",@"complete"]]); check(![v saveEnrollment:enrollment()] && [v publicBinding]==nil);
    printf("PASS: %d native wake assertions\n",checks); return 0;
  }
  [v receivePayload:payload() completion:^{ [order addObject:@"complete"]; }];
  check([[order subarrayWithRange:NSMakeRange(0,3)] isEqual:@[@"report",@"complete",@"keychain"]]);
  check(prepared==1 && [v.requests isEqual:@[@"claim"]]);
  CXAnswerCallAction *a=answer(v); check(!a.testFulfilled && !a.testFailed && accepted==0);
  sdkReady(nil); check([v.requests containsObject:@"ready"]);
  sdkEvent(@{@"type":@"incoming",@"callUUID":currentUUID}); check(accepted==1 && !a.testFulfilled);
  sdkEvent(@{@"type":@"connected",@"callUUID":currentUUID}); check(a.testFulfilled && v.connected);
  int before=prepared; [v receivePayload:payload() completion:^{}]; check(prepared==before && v.connected);
  CXAnswerCallAction *other=[CXAnswerCallAction new]; other.callUUID=NSUUID.UUID;
  [v provider:v.provider performAnswerCallAction:other]; check(other.testFulfilled && ordinaryAnswers==1);
  [v provider:v.provider didActivateAudioSession:nil]; check(audioForwarded==1);
  sdkEvent(@{@"type":@"terminated",@"callUUID":currentUUID}); check(v.active==nil && [v.requests containsObject:@"end"]);
  // End/clear before a hung claim resolves cannot start SDK work afterwards.
  v=fresh(); v.hangClaim=YES; [v receivePayload:payload() completion:^{}]; a=answer(v);
  void (^late)(NSDictionary *)=v.heldClaim; before=prepared; [v clearEnrollment];
  late(@{@"status":@"pending",@"sip":@{}}); check(prepared==before && a.testFailed && v.active==nil && v.saved==nil);
  // Reserve the UUID before delayed CallKit completion; early Answer is held,
  // second notification must not overwrite the first pending call.
  v=fresh(); delayReport=YES; [v receivePayload:payload() completion:^{}];
  void (^firstReport)(NSError *)=reported; a=answer(v); check(!a.testFulfilled && v.active!=nil);
  delayReport=NO; NSMutableDictionary *second=[payload() mutableCopy]; second[@"callUUID"]=NSUUID.UUID.UUIDString;
  [v receivePayload:second completion:^{}]; check([v.active[@"callUUID"] isEqual:payload()[@"callUUID"]]);
  firstReport(nil); check(!a.testFulfilled); [v clearEnrollment];
  // Logout while CallKit report is pending cannot resurrect the enrollment/call.
  v=fresh(); delayReport=YES; [v receivePayload:payload() completion:^{}]; firstReport=reported;
  before=prepared; [v clearEnrollment]; delayReport=NO; firstReport(nil); check(prepared==before && v.active==nil);
  // Invalid payload and locked/no grant still report, then fail without SDK work.
  v=fresh(); before=prepared; [v receivePayload:@{@"callUUID":@"bad",@"sipPassword":@"private"} completion:^{}]; check(v.active==nil && prepared==before);
  v.saved=nil; [v receivePayload:payload() completion:^{}]; check(v.active==nil && prepared==before);
  // Failed report must never end another UUID already known to CallKit.
  v=fresh(); reportError=YES; int endedBefore=ends; [v receivePayload:payload() completion:^{}];
  check(ends==endedBefore && v.active==nil); reportError=NO;
  v=fresh(); [v receivePayload:payload() completion:^{}]; audioError=YES; a=answer(v);
  check(a.testFailed && v.active==nil); audioError=NO;
  // Only actual connected calls heartbeat. Transient failure preserves SIP;
  // definitive authorization refusal ends that wake and clears the grant.
  v=fresh(); [v receivePayload:payload() completion:^{}]; sdkReady(nil);
  sdkEvent(@{@"type":@"connected",@"callUUID":currentUUID}); check(v.connected && v.active!=nil);
  v.heartbeatResponse=@{@"authorizationRejected":@YES}; [v heartbeat:v.generation];
  check(v.active==nil && v.saved==nil);
  for (NSString *terminal in @[@"cancelled",@"ended"]) {
    v=fresh(); [v receivePayload:payload() completion:^{}]; sdkReady(nil);
    sdkEvent(@{@"type":@"connected",@"callUUID":currentUUID});
    NSUInteger generation=v.generation, timers=v.timers.count; int ended=ends;
    v.heartbeatResponse=@{@"status":terminal}; [v heartbeat:generation];
    check(v.active==nil && ends==ended+1 && [endedWakeUUID isEqual:payload()[@"callUUID"]]);
    check(v.saved!=nil && ![v.requests containsObject:@"end"] && v.timers.count==timers);
    [v heartbeat:generation]; check(ends==ended+1); // No repeated teardown.
  }
  // Expired setup status is not proof that an actually connected SIP call ended.
  v=fresh(); [v receivePayload:payload() completion:^{}]; sdkReady(nil);
  sdkEvent(@{@"type":@"connected",@"callUUID":currentUUID});
  v.heartbeatResponse=@{@"status":@"expired"}; [v heartbeat:v.generation]; check(v.active!=nil && v.connected); [v clearEnrollment];
  // Setup timeout ends a pending call; the same old timer cannot end a call
  // that actually connected before its setup deadline.
  v=fresh(); [v receivePayload:payload() completion:^{}]; a=answer(v);
  void (^expire)(void)=v.timers.firstObject; expire(); check(v.active==nil && a.testFailed);
  v=fresh(); [v receivePayload:payload() completion:^{}]; expire=v.timers.firstObject;
  sdkEvent(@{@"type":@"connected",@"callUUID":currentUUID}); expire(); check(v.connected && v.active!=nil);
  [v clearEnrollment];
  // Strict enrollment validation; public snapshot never includes the wake grant.
  v=fresh(); check([v saveEnrollment:enrollment()]); check([v publicBinding][@"grant"]==nil);
  NSMutableDictionary *invalid=[enrollment() mutableCopy]; invalid[@"grant"]=@"wrong"; check(![v saveEnrollment:invalid]);
  // Exercise actual request construction without opening a network connection.
  NetworkWake *network=[NetworkWake new]; network.origin=@"https://api.example.test";
  network.active=payload(); network.enrollment=enrollment(); network.session=[CaptureSession new];
  [network request:@"claim" completion:^(NSDictionary *body) {}]; check(networkStarts==1);
  check([capturedRequest.URL.absoluteString isEqual:@"https://api.example.test/api/phone11/wake/claim"]);
  check([capturedRequest valueForHTTPHeaderField:@"Authorization"].length==48 && capturedRequest.timeoutInterval==5);
  NSDictionary *body=[NSJSONSerialization JSONObjectWithData:capturedRequest.HTTPBody options:0 error:nil];
  check(body.count==2 && body[@"grant"]==nil && body[@"sipPassword"]==nil);
  network.origin=@"https://private@api.example.test"; [network request:@"claim" completion:^(NSDictionary *body) { check(body==nil); }]; check(networkStarts==1);
  network.origin=@"https://api.example.test"; NSMutableDictionary *expired=[payload() mutableCopy];expired[@"expiresAt"]=@1;network.active=expired;
  [network request:@"claim" completion:^(NSDictionary *body) { check(body==nil); }]; check(networkStarts==1);
  network.connected=YES; [network request:@"ready" completion:^(NSDictionary *body) {}]; check(networkStarts==2 && capturedRequest.timeoutInterval==5);
  __block BOOL redirectCalled=NO; [network URLSession:nil task:nil willPerformHTTPRedirection:nil newRequest:[NSURLRequest new] completionHandler:^(NSURLRequest *request){ redirectCalled=YES;check(request==nil); }];check(redirectCalled);
  // Diagnostics are fixed-schema, bounded, and never persist raw error text.
  NSUserDefaults *defaults=NSUserDefaults.standardUserDefaults;
  [defaults removeObjectForKey:P11WakeDiagnosticKey];
  NSError *privateError=[NSError errorWithDomain:@"private-domain" code:123 userInfo:@{NSLocalizedDescriptionKey:@"token=private-secret"}];
  check([P11PrepareFailure(privateError) isEqual:@"other"]);
  check([P11PrepareFailure([NSError errorWithDomain:@"fake" code:1 userInfo:@{NSLocalizedDescriptionKey:@"The foreground phone session does not match this wake."}]) isEqual:@"owner_or_config_mismatch"]);
  NSDictionary *guardClasses=@{@"Incoming wake owner missing.":@"wake_owner_missing",@"Incoming wake owner mismatch.":@"wake_owner_mismatch",@"Incoming wake account configuration mismatch.":@"account_config_mismatch",@"Incoming wake account count mismatch.":@"account_count_mismatch",@"Incoming wake runtime sink missing.":@"runtime_sink_missing"};
  for (NSString *description in guardClasses) {
    NSString *classification=P11PrepareFailure([NSError errorWithDomain:@"fake" code:1 userInfo:@{NSLocalizedDescriptionKey:description}]);
    check([classification isEqual:guardClasses[description]]);
    [network recordStage:@"prepare_complete" code:1 classification:classification];
    check([[[defaults arrayForKey:P11WakeDiagnosticKey] lastObject][@"classification"] isEqual:classification]);
  }
  [Phone11WakeCoordinator recordRegistrationState:1 fresh:NO];
  NSDictionary *registrationEntry=[[defaults arrayForKey:P11WakeDiagnosticKey] lastObject];
  check([registrationEntry[@"stage"] isEqual:@"registration_stale"] && [registrationEntry[@"code"] intValue]==1);
  [Phone11WakeCoordinator recordRegistrationState:0 fresh:YES];
  registrationEntry=[[defaults arrayForKey:P11WakeDiagnosticKey] lastObject];
  check([registrationEntry[@"stage"] isEqual:@"registration_fresh"] && [registrationEntry[@"code"] intValue]==0);
  NSArray *beforeInvalid=[defaults arrayForKey:P11WakeDiagnosticKey];
  [Phone11WakeCoordinator recordRegistrationState:999 fresh:YES];
  check([[defaults arrayForKey:P11WakeDiagnosticKey] isEqual:beforeInvalid]);
  [defaults setObject:@[@{@"token":@"private-secret"}] forKey:P11WakeDiagnosticKey];
  for (int i=0;i<40;i++) [network recordStage:@"prepare_complete" code:1 classification:P11PrepareFailure(privateError)];
  NSArray *trail=[defaults arrayForKey:P11WakeDiagnosticKey];check(trail.count==32);
  NSData *safe=[NSJSONSerialization dataWithJSONObject:trail options:0 error:nil];
  NSString *encoded=[[NSString alloc] initWithData:safe encoding:NSUTF8StringEncoding];
  check([encoded rangeOfString:@"private-secret"].location==NSNotFound);
  for (NSDictionary *entry in trail) check(entry.count==4 && entry[@"timestamp"] && entry[@"stage"] && entry[@"code"] && entry[@"classification"]);
  [network recordStage:@"token=private-secret" code:1 classification:@"other"];
  [network recordStage:@"prepare_complete" code:1 classification:@"private-secret"];
  check([[defaults arrayForKey:P11WakeDiagnosticKey] isEqual:trail]);
  [defaults removeObjectForKey:P11WakeDiagnosticKey];
  printf("PASS: %d native wake assertions\n",checks);
} return 0; }
