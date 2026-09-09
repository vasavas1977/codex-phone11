// Runs the actual bridge implementation against a fake SDK, never a SIP service.
#import "../ios/Phone11Siprix.m"
#include <stdio.h>
#include <stdlib.h>

NSString *const AVAudioSessionPortBuiltInSpeaker = @"Speaker";
@implementation UIView
@end
@implementation AVAudioSessionPortDescription
@end
@implementation AVAudioSessionRouteDescription
@end
@implementation AVAudioSession
+ (instancetype)sharedInstance {
  static AVAudioSession *session;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    session = [AVAudioSession new];
    session.currentRoute = [AVAudioSessionRouteDescription new];
    session.currentRoute.outputs = @[];
  });
  return session;
}
@end
@implementation RCTEventEmitter
- (instancetype)init {
  if ((self = [super init])) self.testEvents = [NSMutableArray new];
  return self;
}
- (void)sendEventWithName:(NSString *)name body:(id)body { [self.testEvents addObject:body]; }
- (void)invalidate {}
@end

@implementation SiprixIniData
@end
@implementation SiprixAccData
@end
@implementation SiprixDestData
@end
@implementation SiprixHoldData
@end

static int sdkCode, initCode, shutdownCode, initializes, shutdowns, registrations;
static int invites, rejects, byes, accepts, holds, mutes, dtmfs, activations, deactivations;
static int nextAccount = 10, nextCall = 20;
static BOOL sdkInitialized, speakerOK = YES, callKitEnabled;
static HoldState mockHold = HoldStateNone;
static NSString *mockVersion = @"1.0.40";
static SiprixIniData *lastInit;
static id<SiprixEventDelegate> sdkDelegate;

@implementation SiprixModule
- (int)initialize:(id<SiprixEventDelegate>)delegate iniData:(SiprixIniData *)iniData {
  initializes++;
  lastInit = iniData;
  sdkDelegate = delegate;
  sdkInitialized = initCode == 0;
  return initCode;
}
- (int)unInitialize { shutdowns++; if (!shutdownCode) sdkInitialized = NO; return shutdownCode; }
- (BOOL)isInitialized { return sdkInitialized; }
- (NSString *)version { return mockVersion; }
- (void)enableCallKit:(BOOL)enabled { callKitEnabled = enabled; }
- (int)accountAdd:(SiprixAccData *)data {
  if (sdkCode) return sdkCode;
  if (data.expireTime.intValue != 0) abort();
  data.myAccId = nextAccount;
  return 0;
}
- (int)accountRegister:(int)accId expireTime:(int)expireTime { registrations++; return sdkCode; }
- (int)accountUnRegister:(int)accId { return sdkCode; }
- (int)accountDelete:(int)accId { return sdkCode; }
- (int)callInvite:(SiprixDestData *)data { invites++; if (!sdkCode) data.myCallId = nextCall++; return sdkCode; }
- (int)callAccept:(int)callId withVideo:(BOOL)video { accepts++; return sdkCode; }
- (int)callReject:(int)callId statusCode:(int)statusCode { rejects++; return sdkCode; }
- (int)callBye:(int)callId { byes++; return sdkCode; }
- (int)callMuteMic:(int)callId mute:(BOOL)mute { mutes++; return sdkCode; }
- (int)callGetHoldState:(int)callId holdState:(SiprixHoldData *)data { data.holdState = mockHold; return sdkCode; }
- (int)callHold:(int)callId { holds++; return sdkCode; }
- (int)callSendDtmf:(int)callId dtmfs:(NSString *)digits durationMs:(int)duration intertoneGapMs:(int)gap method:(DtmfMethod)method {
  dtmfs++; if (duration != 160 || gap != 80 || method != DtmfMethodRtp) abort(); return sdkCode;
}
- (void)activateSession:(AVAudioSession *)session { activations++; }
- (void)deactivateSession:(AVAudioSession *)session { deactivations++; }
- (BOOL)overrideAudioOutputToSpeaker:(BOOL)on { return speakerOK; }
@end

static int assertions;
#define CHECK(condition) do { assertions++; if (!(condition)) { fprintf(stderr, "FAIL line %d: %s\n", __LINE__, #condition); exit(1); } } while (0)

static void flush(void) {
  __block BOOL done = NO;
  dispatch_async(dispatch_get_main_queue(), ^{ done = YES; });
  while (!done) [[NSRunLoop mainRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.001]];
}

int main(void) {
  @autoreleasepool {
    __block id result;
    __block NSString *error;
    __block int resolved = 0;
    RCTPromiseResolveBlock resolve = ^(id value) { result = value; error = nil; resolved++; };
    RCTPromiseRejectBlock reject = ^(NSString *code, NSString *message, NSError *err) { error = code; result = nil; };
    NSDictionary *config = @{@"sipServer": @"invalid.example", @"sipExtension": @"test", @"sipPassword": @"test-only-secret", @"transport": @"TLS"};
    Phone11Siprix *bridge = [Phone11Siprix new];
    [bridge startObserving];
    [bridge getSnapshot:resolve rejecter:reject];
    CHECK(![result[@"initialized"] boolValue]);
    [bridge registerAccount:@"10" expireTime:@300 resolver:resolve rejecter:reject];
    CHECK([error isEqualToString:@"E_NOT_INITIALIZED"]);
    [bridge initialize:@{@"license": @"not-allowed"} resolver:resolve rejecter:reject];
    CHECK([error isEqualToString:@"E_INVALID_ARGUMENT"] && initializes == 0);
    [bridge initialize:@{} resolver:resolve rejecter:reject];
    CHECK(!error && [result[@"initialized"] boolValue] && initializes == 1);
    CHECK([result[@"sdkVersion"] isEqualToString:@"1.0.40"] && callKitEnabled);
    CHECK(lastInit.logLevelFile.intValue == LogLevelNoLog && lastInit.logLevelIde.intValue == LogLevelNoLog);
    CHECK(lastInit.tlsVerifyServer.boolValue && lastInit.singleCallMode.boolValue && !lastInit.enableVideoCall.boolValue);
    CHECK(lastInit.license == nil && lastInit.homeFolder == nil);
    NSUInteger generation = [result[@"generation"] unsignedIntegerValue];
    [bridge initialize:@{} resolver:resolve rejecter:reject];
    CHECK(initializes == 1 && [result[@"generation"] unsignedIntegerValue] == generation);
    Phone11Siprix *other = [Phone11Siprix new];
    [other initialize:@{} resolver:resolve rejecter:reject];
    CHECK([error isEqualToString:@"E_RUNTIME_IN_USE"] && initializes == 1);
    [other destroy:resolve rejecter:reject];
    CHECK([error isEqualToString:@"E_RUNTIME_IN_USE"] && shutdowns == 0);
    [bridge createAccount:config resolver:resolve rejecter:reject];
    CHECK(!error && [result[@"id"] isEqualToString:@"10"] && [result[@"registrationState"] isEqualToString:@"unregistered"]);
    CHECK(!result[@"sipPassword"] && !result[@"sipAuthId"]);
    [bridge makeCall:@"10" destination:@"123" resolver:resolve rejecter:reject];
    CHECK([error isEqualToString:@"E_NOT_REGISTERED"] && invites == 0);
    [bridge registerAccount:@"10" expireTime:@0 resolver:resolve rejecter:reject];
    CHECK([error isEqualToString:@"E_INVALID_ARGUMENT"] && registrations == 0);
    [bridge registerAccount:@"10" expireTime:@300 resolver:resolve rejecter:reject];
    CHECK(!error && registrations == 1);
    [bridge getSnapshot:resolve rejecter:reject];
    CHECK([result[@"accounts"][0][@"registrationState"] isEqualToString:@"unregistered"]);
    [sdkDelegate onAccountRegState:10 regState:RegStateFailed response:@"401 Unauthorized"];
    flush();
    CHECK([bridge.testEvents.lastObject[@"account"][@"sipStatusCode"] intValue] == 401);
    CHECK([bridge.testEvents.lastObject[@"account"][@"regState"] intValue] == RegStateFailed);
    CHECK([bridge.testEvents.lastObject[@"account"][@"registrationState"] isEqualToString:@"failed"]);
    [sdkDelegate onAccountRegState:10 regState:RegStateFailed response:@"408 Request Timeout"];
    flush();
    CHECK([bridge.testEvents.lastObject[@"account"][@"sipStatusCode"] intValue] == 408);
    [sdkDelegate onAccountRegState:10 regState:RegStateSuccess response:@"200 OK"];
    flush();
    CHECK([bridge.testEvents.lastObject[@"account"][@"registrationState"] isEqualToString:@"registered"]);
    sdkCode = -77;
    [bridge makeCall:@"10" destination:@"123" resolver:resolve rejecter:reject];
    CHECK([error isEqualToString:@"E_SIPRIX_-77"] && P11SiprixRuntime.shared.calls.count == 0);
    sdkCode = 0;
    [bridge makeCall:@"10" destination:@"sip:123:private@invalid.example;password=secret" resolver:resolve rejecter:reject];
    CHECK(!error && [result[@"remoteUri"] isEqualToString:@"sip:123@invalid.example"]);
    NSString *callId = result[@"id"];
    CHECK([result[@"state"] isEqualToString:@"dialing"]);
    [bridge makeCall:@"10" destination:@"456" resolver:resolve rejecter:reject];
    CHECK([error isEqualToString:@"E_CALL_ACTIVE"]);
    [bridge deleteAccount:@"10" resolver:resolve rejecter:reject];
    CHECK([error isEqualToString:@"E_CALL_ACTIVE"]);
    [sdkDelegate onCallProceeding:callId.intValue response:@"180 Ringing sensitive text"];
    flush();
    CHECK([bridge.testEvents.lastObject[@"call"][@"state"] isEqualToString:@"proceeding"]);
    [sdkDelegate onCallConnected:callId.intValue hdrFrom:@"" hdrTo:@"" withVideo:NO];
    flush();
    CHECK([bridge.testEvents.lastObject[@"call"][@"state"] isEqualToString:@"connected"]);
    sdkCode = -33;
    [bridge setMute:callId muted:YES resolver:resolve rejecter:reject];
    CHECK([error isEqualToString:@"E_SIPRIX_-33"] && ![P11SiprixRuntime.shared.calls[callId][@"muted"] boolValue]);
    sdkCode = 0;
    [bridge setMute:callId muted:YES resolver:resolve rejecter:reject];
    CHECK(!error && [bridge.testEvents.lastObject[@"call"][@"muted"] boolValue]);
    mockHold = HoldStateRemote;
    [bridge setHold:callId held:NO resolver:resolve rejecter:reject];
    CHECK(!error && holds == 0);
    [bridge setHold:callId held:YES resolver:resolve rejecter:reject];
    CHECK(!error && holds == 1 && ![P11SiprixRuntime.shared.calls[callId][@"held"] boolValue]);
    [bridge setHold:callId held:YES resolver:resolve rejecter:reject];
    CHECK([error isEqualToString:@"E_HOLD_PENDING"] && holds == 1);
    mockHold = HoldStateLocalAndRemote;
    [sdkDelegate onCallHeld:callId.intValue holdState:mockHold];
    flush();
    CHECK([bridge.testEvents.lastObject[@"call"][@"holdState"] intValue] == 3);
    [bridge setHold:callId held:YES resolver:resolve rejecter:reject];
    CHECK(!error && holds == 1);
    [bridge setHold:callId held:NO resolver:resolve rejecter:reject];
    CHECK(!error && holds == 2);
    [bridge sendDtmf:callId digits:@"12;private" resolver:resolve rejecter:reject];
    CHECK([error isEqualToString:@"E_INVALID_ARGUMENT"] && dtmfs == 0);
    [bridge sendDtmf:callId digits:@"12*#ABCD" resolver:resolve rejecter:reject];
    CHECK(!error && dtmfs == 1);
    [bridge setSpeaker:YES resolver:resolve rejecter:reject];
    CHECK([error isEqualToString:@"E_AUDIO_INACTIVE"]);
    [bridge handleNativeAudioSession:YES resolver:resolve rejecter:reject];
    [bridge handleNativeAudioSession:YES resolver:resolve rejecter:reject];
    CHECK(!error && activations == 1);
    speakerOK = NO;
    [bridge setSpeaker:YES resolver:resolve rejecter:reject];
    CHECK([error isEqualToString:@"E_AUDIO_ROUTE"]);
    speakerOK = YES;
    [bridge setSpeaker:YES resolver:resolve rejecter:reject];
    CHECK(!error);
    [bridge getSnapshot:resolve rejecter:reject];
    CHECK(![result[@"speaker"] boolValue]); // Route request is not physical route proof.
    [bridge hangupCall:callId resolver:resolve rejecter:reject];
    CHECK(!error && byes == 1 && P11SiprixRuntime.shared.calls.count == 1);
    [sdkDelegate onCallTerminated:callId.intValue statusCode:200];
    flush();
    CHECK(P11SiprixRuntime.shared.calls.count == 0 && [bridge.testEvents.lastObject[@"call"][@"state"] isEqualToString:@"terminated"]);
    [sdkDelegate onCallIncoming:50 accId:10 withVideo:NO hdrFrom:@"Test <sip:caller:password@invalid.example>" hdrTo:@""];
    flush();
    CHECK([bridge.testEvents.lastObject[@"call"][@"remoteUri"] isEqualToString:@"sip:caller@invalid.example"]);
    [sdkDelegate onCallIncoming:51 accId:10 withVideo:NO hdrFrom:@"sip:extra@invalid.example" hdrTo:@""];
    flush();
    CHECK(rejects == 1 && P11SiprixRuntime.shared.calls.count == 1);
    [bridge answerCall:@"50" resolver:resolve rejecter:reject];
    CHECK(!error && accepts == 1 && [P11SiprixRuntime.shared.calls[@"50"][@"state"] isEqualToString:@"ringing"]);
    [bridge answerCall:@"50" resolver:resolve rejecter:reject];
    CHECK([error isEqualToString:@"E_CALL_STATE"] && accepts == 1);
    [bridge hangupCall:@"50" resolver:resolve rejecter:reject];
    CHECK(!error && byes == 2 && rejects == 1);
    [sdkDelegate onCallTerminated:50 statusCode:200];
    flush();
    [sdkDelegate onCallIncoming:52 accId:10 withVideo:NO hdrFrom:@"sip:caller@invalid.example" hdrTo:@""];
    flush();
    [bridge hangupCall:@"52" resolver:resolve rejecter:reject];
    CHECK(!error && rejects == 2 && byes == 2);
    [sdkDelegate onCallTerminated:52 statusCode:486];
    flush();
    [bridge unregisterAccount:@"10" resolver:resolve rejecter:reject];
    CHECK(!error && [P11SiprixRuntime.shared.accounts[@"10"][@"registrationState"] isEqualToString:@"registered"]);
    [sdkDelegate onAccountRegState:10 regState:RegStateRemoved response:@"200 OK"];
    flush();
    CHECK([P11SiprixRuntime.shared.accounts[@"10"][@"registrationState"] isEqualToString:@"unregistered"]);
    sdkCode = -14;
    [bridge deleteAccount:@"10" resolver:resolve rejecter:reject];
    CHECK([error isEqualToString:@"E_SIPRIX_-14"] && P11SiprixRuntime.shared.accounts.count == 1);
    sdkCode = 0;
    [bridge deleteAccount:@"10" resolver:resolve rejecter:reject];
    CHECK(!error && P11SiprixRuntime.shared.accounts.count == 0);
    [bridge createAccount:config resolver:resolve rejecter:reject];
    CHECK([error isEqualToString:@"E_ACCOUNT_EXISTS"]);
    id<SiprixEventDelegate> oldDelegate = sdkDelegate;
    [oldDelegate onAccountRegState:10 regState:RegStateSuccess response:@"200 OK"];
    shutdownCode = -55;
    [bridge destroy:resolve rejecter:reject];
    CHECK([error isEqualToString:@"E_SIPRIX_-55"] && P11SiprixRuntime.shared.quarantined);
    CHECK(deactivations == 1 && P11SiprixRuntime.shared.sdk != nil);
    [bridge getSnapshot:resolve rejecter:reject];
    CHECK([error isEqualToString:@"E_CLEANUP_REQUIRED"]);
    shutdownCode = 0;
    [bridge destroy:resolve rejecter:reject];
    CHECK(!error && !P11SiprixRuntime.shared.sdk && !P11SiprixRuntime.shared.lease);
    [bridge initialize:@{} resolver:resolve rejecter:reject];
    CHECK(!error && [result[@"generation"] unsignedIntegerValue] > generation);
    [bridge createAccount:config resolver:resolve rejecter:reject];
    CHECK(!error);
    NSUInteger events = bridge.testEvents.count;
    [oldDelegate onCallIncoming:80 accId:10 withVideo:NO hdrFrom:@"sip:old@invalid.example" hdrTo:@""];
    flush();
    CHECK(bridge.testEvents.count == events && P11SiprixRuntime.shared.calls.count == 0);
    CHECK([P11SiprixRuntime.shared.accounts[@"10"][@"registrationState"] isEqualToString:@"unregistered"]);
    [bridge stopObserving];
    [sdkDelegate onAccountRegState:10 regState:RegStateSuccess response:@"200 OK"];
    flush();
    CHECK(bridge.testEvents.count == events);
    [bridge getSnapshot:resolve rejecter:reject];
    CHECK([result[@"accounts"][0][@"registrationState"] isEqualToString:@"registered"]);
    [bridge startObserving];
    [sdkDelegate onTrialModeNotified];
    flush();
    [bridge getSnapshot:resolve rejecter:reject];
    CHECK([result[@"trialNotified"] boolValue]);
    NSUInteger lastSequence = 0;
    for (NSDictionary *event in bridge.testEvents) {
      CHECK([event[@"sequence"] unsignedIntegerValue] > lastSequence);
      lastSequence = [event[@"sequence"] unsignedIntegerValue];
    }
    NSData *json = [NSJSONSerialization dataWithJSONObject:bridge.testEvents options:0 error:nil];
    NSString *text = [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
    CHECK(![text containsString:@"test-only-secret"] && ![text containsString:@"sensitive text"] && ![text containsString:@"password"]);
    [bridge invalidate];
    flush();
    CHECK(!P11SiprixRuntime.shared.initialized && !P11SiprixRuntime.shared.lease);
    initCode = -12;
    [bridge initialize:@{} resolver:resolve rejecter:reject];
    CHECK([error isEqualToString:@"E_SIPRIX_-12"] && !P11SiprixRuntime.shared.quarantined);
    initCode = 0;
    mockVersion = @"1.0.41";
    [bridge initialize:@{} resolver:resolve rejecter:reject];
    CHECK([error isEqualToString:@"E_SDK_VERSION"] && !P11SiprixRuntime.shared.sdk);
    mockVersion = @"1.0.40";
    [bridge initialize:@{} resolver:resolve rejecter:reject];
    CHECK(!error);
    [bridge destroy:resolve rejecter:reject];
    int count = shutdowns;
    [bridge destroy:resolve rejecter:reject];
    CHECK(!error && shutdowns == count);
    CHECK([P11StatusCode(@"SIP/2.0 401 Unauthorized\r\nAuthorization: private") intValue] == 401);
    CHECK([P11StatusCode(@"408 Request Timeout") intValue] == 408);
    CHECK(P11StatusCode(@"private password 401") == nil);
    CHECK(P11StatusCode(@"401 Unauthorized; private") == nil);
    CHECK(P11StatusCode(@"SIP/2.0 4011") == nil);
    CHECK(P11StatusCode(@"SIP/2.0 999 Bad") == nil);
    printf("PASS: %d native bridge assertions (mock SDK; no iOS runtime or SIP traffic)\n", assertions);
  }
  return 0;
}
