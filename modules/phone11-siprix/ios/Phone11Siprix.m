#import "Phone11Siprix.h"
#import <AVFoundation/AVFoundation.h>
#import <siprix/Siprix.h>
#import <limits.h>
#import <math.h>
#ifndef PHONE11_VOIP_WAKE_COMMISSIONED
#define PHONE11_VOIP_WAKE_COMMISSIONED 0
#endif
#if PHONE11_VOIP_WAKE_COMMISSIONED
#import "Phone11WakeCoordinator.h"
#endif

static NSString *const P11EventName = @"Phone11SiprixEvent";

// Native build configuration only. A configured string is not proof of a valid license;
// SDK errors and onTrialModeNotified remain authoritative. Never return/log this value.
static void P11ApplyBuildLicense(SiprixIniData *ini, id value) {
  if (![value isKindOfClass:NSString.class]) return;
  NSString *license = [value stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  if (license.length > 0) ini.license = license;
}

@interface Phone11Siprix ()
@property(nonatomic, copy) NSString *lease;
@property(nonatomic) BOOL observing;
@end

@class P11SiprixDelegate;

@interface P11SiprixRuntime : NSObject
@property(nonatomic, strong) SiprixModule *sdk;
@property(nonatomic, strong) P11SiprixDelegate *delegate;
@property(nonatomic, weak) Phone11Siprix *sink;
@property(nonatomic, copy) NSString *lease;
@property(nonatomic, copy) NSString *sdkVersion;
@property(nonatomic) NSUInteger generation;
@property(nonatomic) NSUInteger sequence;
@property(nonatomic) BOOL initialized;
@property(nonatomic) BOOL quarantined;
@property(nonatomic) BOOL audioSessionActive;
@property(nonatomic) BOOL trialNotified;
@property(nonatomic, strong) NSMutableDictionary<NSString *, NSMutableDictionary *> *accounts;
@property(nonatomic, strong) NSMutableDictionary<NSString *, NSMutableDictionary *> *calls;
@property(nonatomic, strong) NSMutableSet<NSString *> *pendingHolds;
@property(nonatomic, strong) NSMutableSet<NSString *> *acceptedCalls;
@property(nonatomic, strong) NSMutableSet<NSString *> *retiredCallIDs;
@property(nonatomic) BOOL accountCreated;
// These values are native RAM only; credentials are never included in a snapshot/event.
@property(nonatomic, copy) NSDictionary *accountConfig;
@property(nonatomic, copy) NSDictionary *wakeOwner;
@property(nonatomic, copy) NSDictionary *wakeContext;
@property(nonatomic, strong) Phone11Siprix *wakeBridge;
@property(nonatomic, copy) NSString *wakeCallId;
@property(nonatomic, copy) void (^wakeEvent)(NSDictionary *event);
@property(nonatomic, copy) void (^wakeReady)(NSError *error);
@property(nonatomic) BOOL wakeStartedRuntime;
@property(nonatomic) BOOL wakeEnding;
@property(nonatomic, copy) NSString *wakeAudioUUID;
@property(nonatomic, copy) NSDictionary *wakeAudioOwner;
@property(nonatomic) NSUInteger wakeAudioGeneration;
+ (instancetype)shared;
- (NSDictionary *)snapshot;
- (void)emit:(NSString *)type data:(NSDictionary *)data;
- (void)receive:(NSString *)type data:(NSDictionary *)data generation:(NSUInteger)generation;
- (int)shutdown;
- (void)clearWake:(BOOL)failed;
- (void)wakeNotify:(NSString *)type;
- (void)cleanupWake:(NSString *)uuid generation:(NSUInteger)generation;
@end

@interface P11SiprixDelegate : NSObject <SiprixEventDelegate>
@property(nonatomic, weak) P11SiprixRuntime *runtime;
@property(nonatomic) NSUInteger generation;
@end

static BOOL P11String(id value, NSUInteger maxLength) {
  return [value isKindOfClass:NSString.class] && [value length] > 0 &&
    [value length] <= maxLength &&
    [value rangeOfCharacterFromSet:NSCharacterSet.controlCharacterSet].location == NSNotFound;
}

static BOOL P11Integer(id value, int minimum, int maximum) {
  if (![value isKindOfClass:NSNumber.class]) return NO;
  double n = [value doubleValue];
  return isfinite(n) && floor(n) == n && n >= minimum && n <= maximum;
}

static void P11Reject(RCTPromiseRejectBlock reject, NSString *code, NSString *message) {
  reject(code, message, nil);
}

static BOOL P11PinnedSDKVersion(NSString *version) {
  if (![version isKindOfClass:NSString.class]) return NO;
  NSString *normalized = [version stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  // The checksum-pinned vendor binary returns its product name and build date.
  return [normalized isEqualToString:@"1.0.40"] ||
    [normalized isEqualToString:@"1.0.40 from 20260620_1419"] ||
    [normalized isEqualToString:@"siprix 1.0.40 from 20260620_1419"];
}

static NSString *P11ID(NSInteger value) {
  return [NSString stringWithFormat:@"%ld", (long)value];
}

static NSNumber *P11StatusCode(NSString *response) {
  if (![response isKindOfClass:NSString.class] || response.length > 4096) return nil;
  static NSDictionary *standard;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    standard = @{@"200 OK": @200, @"401 Unauthorized": @401, @"403 Forbidden": @403,
      @"404 Not Found": @404, @"407 Proxy Authentication Required": @407,
      @"408 Request Timeout": @408, @"423 Interval Too Brief": @423,
      @"480 Temporarily Unavailable": @480, @"500 Server Internal Error": @500,
      @"503 Service Unavailable": @503, @"504 Server Time-out": @504};
  });
  NSNumber *known = standard[response];
  if (known) return known;
  if (![response hasPrefix:@"SIP/2.0 "] || response.length < 11) return nil;
  NSString *digits = [response substringWithRange:NSMakeRange(8, 3)];
  if ([digits rangeOfCharacterFromSet:NSCharacterSet.decimalDigitCharacterSet.invertedSet].location != NSNotFound) return nil;
  if (response.length > 11 && [response characterAtIndex:11] != ' ') return nil;
  int code = digits.intValue;
  return code >= 100 && code <= 699 ? @(code) : nil;
}

// Never return SIP passwords, URI parameters, or raw server response/header text.
static NSString *P11RemoteURI(NSString *value) {
  NSRange start = [value rangeOfString:@"sip:" options:NSCaseInsensitiveSearch];
  if (start.location == NSNotFound) start = [value rangeOfString:@"sips:" options:NSCaseInsensitiveSearch];
  NSString *uri = start.location == NSNotFound ? value : [value substringFromIndex:start.location];
  NSCharacterSet *end = [NSCharacterSet characterSetWithCharactersInString:@";?<>\" \t\r\n"];
  NSRange endRange = [uri rangeOfCharacterFromSet:end];
  if (endRange.location != NSNotFound) uri = [uri substringToIndex:endRange.location];
  NSRange at = [uri rangeOfString:@"@" options:NSBackwardsSearch];
  if (at.location != NSNotFound) {
    NSString *user = [uri substringToIndex:at.location];
    NSString *scheme = @"";
    if ([user.lowercaseString hasPrefix:@"sip:"]) { scheme = @"sip:"; user = [user substringFromIndex:4]; }
    else if ([user.lowercaseString hasPrefix:@"sips:"]) { scheme = @"sips:"; user = [user substringFromIndex:5]; }
    user = [user componentsSeparatedByString:@":"][0];
    uri = [NSString stringWithFormat:@"%@%@%@", scheme, user, [uri substringFromIndex:at.location]];
  }
  return uri.length <= 512 ? uri : @"";
}

static NSError *P11WakeError(NSString *message) {
  return [NSError errorWithDomain:@"Phone11Wake" code:1 userInfo:@{NSLocalizedDescriptionKey: message}];
}
static double P11NowMs(void) { return NSDate.date.timeIntervalSince1970 * 1000; }
static BOOL P11WakeBinding(NSDictionary *binding) {
  if (![binding isKindOfClass:NSDictionary.class]) return NO;
  for (NSString *key in @[@"bindingId", @"deviceId", @"sessionBinding"]) if (!P11String(binding[key], 256)) return NO;
  if (!P11Integer(binding[@"ownerUserId"], 1, INT_MAX) || !P11Integer(binding[@"tenantId"], 1, INT_MAX)) return NO;
  id expiry = binding[@"expiresAt"];
  return [expiry isKindOfClass:NSNumber.class] && isfinite([expiry doubleValue]) && [expiry doubleValue] > P11NowMs();
}
static BOOL P11SameWakeOwner(NSDictionary *first, NSDictionary *second) {
  if (!first || !second) return NO;
  for (NSString *key in @[@"bindingId", @"ownerUserId", @"tenantId", @"deviceId", @"sessionBinding"]) {
    if (![first[key] isEqual:second[key]]) return NO;
  }
  return YES;
}
static NSDictionary *P11AccountIdentity(NSDictionary *config) {
  if (![config isKindOfClass:NSDictionary.class]) return @{};
  NSMutableDictionary *identity = [NSMutableDictionary new];
  for (NSString *key in @[@"sipServer", @"sipExtension", @"sipPassword", @"transport", @"sipProxy", @"stunServer", @"aCodecs"]) {
    if (config[key]) identity[key] = config[key];
  }
  identity[@"sipAuthId"] = config[@"sipAuthId"] ?: config[@"sipExtension"] ?: @"";
  identity[@"port"] = config[@"port"] ?: ([config[@"transport"] isEqual:@"TLS"] ? @5061 : @5060);
  identity[@"secureMedia"] = config[@"secureMedia"] ?: @0;
  for (NSString *key in @[@"iceEnabled", @"rtcpMuxEnabled", @"rewriteContactIp", @"verifyIncomingCall", @"forceSipProxy"]) {
    if (config[key]) identity[key] = config[key];
  }
  return identity;
}
static void P11OnMain(void (^block)(void)) {
  if (NSThread.isMainThread) block(); else dispatch_async(dispatch_get_main_queue(), block);
}

static BOOL P11Speaker(void) {
  for (AVAudioSessionPortDescription *output in AVAudioSession.sharedInstance.currentRoute.outputs) {
    if ([output.portType isEqualToString:AVAudioSessionPortBuiltInSpeaker]) return YES;
  }
  return NO;
}

static NSMutableDictionary *P11Call(NSString *callId, NSString *accountId, NSString *direction,
                                     NSString *state, NSString *remote) {
  return [@{@"id": callId, @"callId": callId, @"accountId": accountId,
            @"direction": direction, @"state": state, @"remoteUri": P11RemoteURI(remote),
            @"hasVideo": @NO, @"muted": @NO, @"held": @NO, @"holdState": @0} mutableCopy];
}

@implementation P11SiprixRuntime
+ (instancetype)shared {
  static P11SiprixRuntime *runtime;
  static dispatch_once_t once;
  dispatch_once(&once, ^{ runtime = [P11SiprixRuntime new]; });
  return runtime;
}

- (instancetype)init {
  if ((self = [super init])) {
    _accounts = [NSMutableDictionary new];
    _calls = [NSMutableDictionary new];
    _pendingHolds = [NSMutableSet new];
    _acceptedCalls = [NSMutableSet new];
    _retiredCallIDs = [NSMutableSet new];
  }
  return self;
}

- (NSDictionary *)snapshot {
  NSMutableArray *accounts = [NSMutableArray new];
  NSMutableArray *calls = [NSMutableArray new];
  for (NSDictionary *account in self.accounts.allValues) [accounts addObject:[account copy]];
  for (NSDictionary *call in self.calls.allValues) [calls addObject:[call copy]];
  NSMutableDictionary *snapshot = [@{@"initialized": @(self.initialized && !self.quarantined),
           @"generation": @(self.generation), @"sequence": @(self.sequence),
           @"sdkVersion": self.sdkVersion ?: NSNull.null, @"accounts": accounts, @"calls": calls,
           @"audioSessionActive": @(self.audioSessionActive), @"speaker": @(P11Speaker()),
           @"trialNotified": @(self.trialNotified)} mutableCopy];
  if (self.wakeContext) snapshot[@"nativeWake"] = self.wakeContext;
  return snapshot;
}
- (void)wakeNotify:(NSString *)type {
  if (self.wakeEvent && self.wakeContext) self.wakeEvent(@{@"type":type, @"callUUID":self.wakeContext[@"callUUID"]});
}
- (void)clearWake:(BOOL)failed {
  void (^event)(NSDictionary *) = self.wakeEvent;
  void (^ready)(NSError *) = self.wakeReady;
  NSString *uuid = self.wakeContext[@"callUUID"];
  self.wakeEvent = nil; self.wakeReady = nil; self.wakeContext = nil; self.wakeCallId = nil;
  self.wakeBridge = nil; self.wakeStartedRuntime = NO; self.wakeEnding = NO;
  if (ready) ready(P11WakeError(@"Incoming wake ended before registration completed."));
  if (event && uuid && failed) event(@{@"type":@"failed", @"callUUID":uuid});
}

- (void)emit:(NSString *)type data:(NSDictionary *)data {
  self.sequence += 1;
  NSMutableDictionary *event = [data mutableCopy];
  event[@"type"] = type;
  event[@"generation"] = @(self.generation);
  event[@"sequence"] = @(self.sequence);
  if (self.sink.observing) [self.sink sendEventWithName:P11EventName body:event];
}

- (void)receive:(NSString *)type data:(NSDictionary *)data generation:(NSUInteger)generation {
  if (!self.initialized || self.quarantined || generation != self.generation) return;
  NSString *callId = data[@"callId"];
  NSMutableDictionary *call = self.calls[callId ?: @""];
  if ([type isEqualToString:@"registration"]) {
    NSMutableDictionary *account = self.accounts[data[@"accountId"]];
    if (!account) return;
    NSInteger state = [data[@"regState"] integerValue];
    switch (state) {
      case RegStateSuccess: account[@"registrationState"] = @"registered"; break;
      case RegStateFailed: account[@"registrationState"] = @"failed"; break;
      case RegStateRemoved: account[@"registrationState"] = @"unregistered"; break;
      case RegStateInProgress: account[@"registrationState"] = @"registering"; break;
      default: return;
    }
    account[@"regState"] = @(state);
    [account removeObjectForKey:@"sipStatusCode"];
    if (data[@"sipStatusCode"]) account[@"sipStatusCode"] = data[@"sipStatusCode"];
    [self emit:type data:@{@"account": [account copy]}];
    if (self.wakeReady && state == RegStateSuccess) {
      void (^ready)(NSError *) = self.wakeReady; self.wakeReady = nil;
      ready([self.wakeContext[@"expiresAt"] doubleValue] > P11NowMs() ? nil : P11WakeError(@"Incoming wake expired."));
    } else if (self.wakeReady && state == RegStateFailed) {
      void (^ready)(NSError *) = self.wakeReady; self.wakeReady = nil;
      ready(P11WakeError(@"Incoming wake registration failed."));
    }
  } else if ([type isEqualToString:@"callIncoming"]) {
    if (call) return;
    if ([self.retiredCallIDs containsObject:callId]) {
      self.quarantined = YES;
      [self emit:@"error" data:@{@"operation": @"reusedCallId", @"code": @-1}];
      return;
    }
    if (!self.accounts[data[@"accountId"]] || self.calls.count > 0) {
      int code = [self.sdk callReject:callId.intValue statusCode:486];
      if (code != kErrorCodeEOK) [self emit:@"error" data:@{@"operation": @"rejectExtraIncoming", @"code": @(code)}];
      return;
    }
    if (self.wakeContext) {
      NSString *header = [self.sdk callGetSipHeader:callId.intValue hdrName:@"X-Phone11-Wake-ID"];
      if (![header isEqualToString:self.wakeContext[@"callUUID"]] || [self.wakeContext[@"expiresAt"] doubleValue] <= P11NowMs()) {
        [self.sdk callReject:callId.intValue statusCode:403];
        [self emit:@"error" data:@{@"operation":@"wakeCorrelation", @"code":@-1}];
        return;
      }
    }
    call = P11Call(callId, data[@"accountId"], @"incoming", @"ringing", data[@"remoteUri"]);
    if (self.wakeContext) {
      self.wakeCallId = callId; call[@"wakeCallUUID"] = self.wakeContext[@"callUUID"];
      call[@"wakeSystemAnswered"] = @NO;
    }
    self.calls[callId] = call;
    [self emit:type data:@{@"call": [call copy]}];
    if (self.wakeCallId) [self wakeNotify:@"incoming"];
  } else if ([type isEqualToString:@"callProceeding"] || [type isEqualToString:@"callConnected"] ||
             [type isEqualToString:@"callTerminated"] || [type isEqualToString:@"callHeld"]) {
    if (!call) return;
    if ([type isEqualToString:@"callProceeding"]) {
      if (![call[@"state"] isEqualToString:@"dialing"] && ![call[@"state"] isEqualToString:@"proceeding"]) return;
      call[@"state"] = @"proceeding";
    } else if ([type isEqualToString:@"callConnected"]) {
      call[@"state"] = [call[@"held"] boolValue] ? @"held" : @"connected";
    } else if ([type isEqualToString:@"callTerminated"]) {
      call[@"state"] = @"terminated";
      call[@"statusCode"] = data[@"statusCode"];
      [self.calls removeObjectForKey:callId];
      [self.pendingHolds removeObject:callId];
      [self.acceptedCalls removeObject:callId];
      [self.retiredCallIDs addObject:callId];
    } else {
      NSInteger state = [data[@"holdState"] integerValue];
      call[@"held"] = @(state != HoldStateNone);
      call[@"holdState"] = @(state);
      call[@"state"] = state == HoldStateNone ? @"connected" : @"held";
      [self.pendingHolds removeObject:callId];
    }
    [self emit:type data:@{@"call": [call copy]}];
    if ([self.wakeCallId isEqualToString:callId]) {
      if ([type isEqualToString:@"callConnected"]) [self wakeNotify:@"connected"];
      if ([type isEqualToString:@"callTerminated"]) { [self wakeNotify:@"terminated"]; [self clearWake:NO]; }
    }
  } else if ([type isEqualToString:@"devicesAudioChanged"]) {
    [self emit:type data:@{@"audioSessionActive": @(self.audioSessionActive), @"speaker": @(P11Speaker())}];
  } else if ([type isEqualToString:@"trial"]) {
    self.trialNotified = YES;
    [self emit:type data:@{}];
  } else if ([type isEqualToString:@"network"]) {
    [self emit:type data:data];
  } else if ([type isEqualToString:@"dtmf"] && call) {
    [self emit:type data:data];
  }
}

- (void)cleanupWake:(NSString *)uuid generation:(NSUInteger)generation {
  // The fallback never tears down a replacement runtime or another call. The
  // single-call invariant keeps this cleanup restricted to the canceled wake.
  if (generation != self.generation || !self.wakeEnding || ![self.wakeContext[@"callUUID"] isEqual:uuid]) return;
  [self emit:@"error" data:@{@"operation":@"wakeCleanup", @"code":@-1}];
  [self shutdown]; // Existing shutdown quarantines SDK resources on failure.
}

- (int)shutdown {
  self.generation += 1;
  [self clearWake:YES];
  self.wakeOwner = nil; self.accountConfig = nil; self.wakeAudioUUID = nil; self.wakeAudioOwner = nil;
  if (self.audioSessionActive) {
    [self.sdk deactivateSession:AVAudioSession.sharedInstance];
    self.audioSessionActive = NO;
  }
  int code = (self.sdk && [self.sdk isInitialized]) ? [self.sdk unInitialize] : kErrorCodeEOK;
  if (code != kErrorCodeEOK) {
    // Retain SDK and delegate until cleanup succeeds. No second runtime may start.
    self.quarantined = YES;
    return code;
  }
  self.initialized = NO;
  self.quarantined = NO;
  self.sdk = nil;
  self.delegate = nil;
  self.lease = nil;
  self.sink = nil;
  self.sdkVersion = nil;
  self.trialNotified = NO;
  self.accountCreated = NO;
  [self.accounts removeAllObjects];
  [self.calls removeAllObjects];
  [self.pendingHolds removeAllObjects];
  [self.acceptedCalls removeAllObjects];
  [self.retiredCallIDs removeAllObjects];
  return kErrorCodeEOK;
}
@end

@implementation P11SiprixDelegate
- (void)post:(NSString *)type data:(NSDictionary *)data {
  // SDK callbacks may arrive on worker threads or inline in an SDK method.
  // Always enqueue so account/call IDs are recorded before callbacks are applied.
  NSUInteger generation = self.generation;
  __weak P11SiprixRuntime *runtime = self.runtime;
  dispatch_async(dispatch_get_main_queue(), ^{
    [runtime receive:type data:data generation:generation];
  });
}
- (void)onTrialModeNotified { [self post:@"trial" data:@{}]; }
- (void)onDevicesAudioChanged { [self post:@"devicesAudioChanged" data:@{}]; }
- (void)onAccountRegState:(NSInteger)accId regState:(RegState)state response:(NSString *)response {
  NSMutableDictionary *data = [@{@"accountId": P11ID(accId), @"regState": @(state)} mutableCopy];
  NSNumber *statusCode = P11StatusCode(response);
  if (statusCode) data[@"sipStatusCode"] = statusCode;
  [self post:@"registration" data:data];
}
- (void)onNetworkState:(NSString *)name netState:(NetworkState)state {
  [self post:@"network" data:@{@"networkState": @(state)}];
}
- (void)onCallIncoming:(NSInteger)callId accId:(NSInteger)accId withVideo:(BOOL)video
               hdrFrom:(NSString *)from hdrTo:(NSString *)to {
  [self post:@"callIncoming" data:@{@"callId": P11ID(callId), @"accountId": P11ID(accId), @"remoteUri": P11RemoteURI(from)}];
}
- (void)onCallProceeding:(NSInteger)callId response:(NSString *)response {
  [self post:@"callProceeding" data:@{@"callId": P11ID(callId)}];
}
- (void)onCallConnected:(NSInteger)callId hdrFrom:(NSString *)from hdrTo:(NSString *)to withVideo:(BOOL)video {
  [self post:@"callConnected" data:@{@"callId": P11ID(callId)}];
}
- (void)onCallTerminated:(NSInteger)callId statusCode:(NSInteger)code {
  [self post:@"callTerminated" data:@{@"callId": P11ID(callId), @"statusCode": @(code)}];
}
- (void)onCallHeld:(NSInteger)callId holdState:(HoldState)state {
  [self post:@"callHeld" data:@{@"callId": P11ID(callId), @"holdState": @(state)}];
}
- (void)onCallDtmfReceived:(NSInteger)callId tone:(NSInteger)tone {
  [self post:@"dtmf" data:@{@"callId": P11ID(callId), @"tone": @(tone)}];
}
// Required SDK callbacks outside this audio-only bridge's advertised capabilities.
- (void)onSubscriptionState:(NSInteger)subscrId subscrState:(SubscrState)state response:(NSString *)response {}
- (void)onPlayerState:(NSInteger)playerId playerState:(PlayerState)state {}
- (void)onRingerState:(BOOL)started {}
- (void)onCallSwitched:(NSInteger)callId {}
- (void)onCallTransferred:(NSInteger)callId statusCode:(NSInteger)code {}
- (void)onCallRedirected:(NSInteger)callId relatedCallId:(NSInteger)relatedId referTo:(NSString *)to {}
- (void)onCallVideoUpgraded:(NSInteger)callId withVideo:(BOOL)video {}
- (void)onCallVideoUpgradeRequested:(NSInteger)callId {}
- (void)onMessageSentState:(NSInteger)messageId success:(BOOL)success response:(NSString *)response {}
- (void)onMessageIncoming:(NSInteger)messageId accId:(NSInteger)accId hdrFrom:(NSString *)from body:(NSString *)body {}
- (void)onSipNotify:(NSInteger)accId hdrEvent:(NSString *)event body:(NSString *)body {}
- (void)onVuMeterLevel:(NSInteger)micLevel spkLevel:(NSInteger)spkLevel {}
@end

@implementation Phone11Siprix
RCT_EXPORT_MODULE(Phone11Siprix)

+ (BOOL)requiresMainQueueSetup { return YES; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }
- (NSArray<NSString *> *)supportedEvents { return @[P11EventName]; }
- (instancetype)init {
  if ((self = [super init])) _lease = NSUUID.UUID.UUIDString;
  return self;
}
- (void)startObserving { self.observing = YES; }
- (void)stopObserving { self.observing = NO; }
- (void)invalidate {
  NSString *lease = self.lease;
  dispatch_async(dispatch_get_main_queue(), ^{
    P11SiprixRuntime *runtime = P11SiprixRuntime.shared;
    if ([runtime.lease isEqualToString:lease]) {
      runtime.sink = nil;
      if (runtime.wakeContext) runtime.lease = nil;
      else [runtime shutdown];
    }
  });
  [super invalidate];
}

- (BOOL)checkSDK:(int)code operation:(NSString *)operation reject:(RCTPromiseRejectBlock)reject {
  if (code == kErrorCodeEOK) return YES;
  // Numeric SDK code is actionable without echoing arbitrary SIP response text.
  P11Reject(reject, [NSString stringWithFormat:@"E_SIPRIX_%d", code],
            [NSString stringWithFormat:@"Siprix %@ failed (SDK code %d).", operation, code]);
  return NO;
}
- (P11SiprixRuntime *)ready:(RCTPromiseRejectBlock)reject {
  P11SiprixRuntime *runtime = P11SiprixRuntime.shared;
  if (runtime.quarantined) {
    P11Reject(reject, @"E_CLEANUP_REQUIRED", @"Siprix cleanup failed. Retry destroy before initialization.");
    return nil;
  }
  if (!runtime.initialized) {
    P11Reject(reject, @"E_NOT_INITIALIZED", @"Initialize Siprix before using this operation.");
    return nil;
  }
  if (![runtime.lease isEqualToString:self.lease]) {
    P11Reject(reject, @"E_RUNTIME_IN_USE", @"Another native bridge owns the Siprix runtime.");
    return nil;
  }
  return runtime;
}
- (BOOL)hasID:(NSString *)identifier in:(NSDictionary *)items reject:(RCTPromiseRejectBlock)reject {
  if (!P11String(identifier, 10) || !items[identifier]) {
    P11Reject(reject, @"E_UNKNOWN_ID", @"The account or call ID is not owned by this runtime.");
    return NO;
  }
  return YES;
}

// Native-only facade: the coordinator has already verified the grant and reported
// the existing RNCallKeep provider's call UUID before invoking these methods.
+ (void)prepareIncomingWake:(NSDictionary *)context sip:(NSDictionary *)sip
                     event:(void (^)(NSDictionary *))event completion:(void (^)(NSError *))completion {
  P11OnMain(^{
#if !PHONE11_VOIP_WAKE_COMMISSIONED
    completion(P11WakeError(@"Background calling is not commissioned."));
#else
    if (![context isKindOfClass:NSDictionary.class] || ![sip isKindOfClass:NSDictionary.class]) {
      completion(P11WakeError(@"Invalid incoming wake configuration.")); return;
    }
    NSString *uuid = context[@"callUUID"];
    NSNumber *grantExpiry = context[@"grantExpiresAt"];
    if (!P11WakeBinding(context) || !P11String(uuid, 36) || ![[NSUUID alloc] initWithUUIDString:uuid] ||
        [context[@"v"] integerValue] != 1 || [context[@"expiresAt"] doubleValue] > P11NowMs()+30000 ||
        ![grantExpiry isKindOfClass:NSNumber.class] || !isfinite([grantExpiry doubleValue]) || [grantExpiry doubleValue] <= P11NowMs()) {
      completion(P11WakeError(@"Invalid or expired incoming wake.")); return;
    }
    P11SiprixRuntime *runtime = P11SiprixRuntime.shared;
    if (runtime.wakeContext || runtime.calls.count || runtime.quarantined) {
      completion(P11WakeError(@"The phone runtime is already busy.")); return;
    }
    NSMutableDictionary *publicContext = [NSMutableDictionary new];
    for (NSString *key in @[@"v", @"callUUID", @"bindingId", @"ownerUserId", @"tenantId", @"deviceId", @"sessionBinding", @"expiresAt", @"grantExpiresAt"]) publicContext[key] = context[key];
    NSMutableDictionary *owner = [publicContext mutableCopy];
    [owner removeObjectForKey:@"callUUID"]; owner[@"expiresAt"] = grantExpiry;
    void (^arm)(Phone11Siprix *, NSString *) = ^(Phone11Siprix *bridge, NSString *accountId) {
      runtime.wakeContext = publicContext; runtime.wakeOwner = owner;
      runtime.wakeEvent = event; runtime.wakeReady = completion;
      runtime.accounts[accountId][@"registrationState"] = @"registering";
      [runtime.sdk handleIncomingPush];
      int code = [runtime.sdk accountRegister:accountId.intValue expireTime:300];
      if (code != kErrorCodeEOK) {
        void (^ready)(NSError *) = runtime.wakeReady; runtime.wakeReady = nil;
        if (ready) ready(P11WakeError(@"Incoming wake registration request failed."));
        [self endIncomingWake:uuid];
      }
    };
    if (runtime.initialized) {
      if (!P11SameWakeOwner(runtime.wakeOwner, owner) ||
          ![runtime.accountConfig isEqual:P11AccountIdentity(sip)] || runtime.accounts.count != 1 || !runtime.sink) {
        completion(P11WakeError(@"The foreground phone session does not match this wake.")); return;
      }
      arm(runtime.sink, runtime.accounts.allKeys.firstObject); return;
    }
    Phone11Siprix *bridge = [Phone11Siprix new];
    // The bridge owns no second SDK; all work uses P11SiprixRuntime.shared.
    void (^failure)(NSString *, NSString *, NSError *) = ^(NSString *code, NSString *message, NSError *error) {
      if ([runtime.lease isEqualToString:bridge.lease]) [runtime shutdown];
      completion(P11WakeError(@"Could not prepare the incoming phone runtime."));
    };
    [bridge initialize:@{} resolver:^(id snapshot) {
      runtime.wakeBridge = bridge;
      [bridge createAccount:sip resolver:^(id account) {
        runtime.wakeStartedRuntime = YES;
        arm(bridge, account[@"accountId"]);
      } rejecter:failure];
    } rejecter:failure];
#endif
  });
}

+ (void)answerIncomingWake:(NSString *)callUUID completion:(void (^)(NSError *))completion {
  P11OnMain(^{
#if !PHONE11_VOIP_WAKE_COMMISSIONED
    completion(P11WakeError(@"Background calling is not commissioned."));
#else
    P11SiprixRuntime *runtime = P11SiprixRuntime.shared;
    NSDictionary *call = runtime.calls[runtime.wakeCallId ?: @""];
    if (!runtime.initialized || runtime.quarantined || ![runtime.wakeContext[@"callUUID"] isEqual:callUUID] ||
        ![call[@"state"] isEqual:@"ringing"] || [runtime.wakeContext[@"expiresAt"] doubleValue] <= P11NowMs()) {
      completion(P11WakeError(@"This incoming wake is no longer ringing.")); return;
    }
    if ([runtime.acceptedCalls containsObject:runtime.wakeCallId]) { completion(nil); return; }
    int code = [runtime.sdk callAccept:runtime.wakeCallId.intValue withVideo:NO];
    if (code != kErrorCodeEOK) { completion(P11WakeError(@"The SDK did not accept the incoming wake.")); return; }
    [runtime.acceptedCalls addObject:runtime.wakeCallId];
    runtime.calls[runtime.wakeCallId][@"wakeSystemAnswered"] = @YES;
    completion(nil); // Connected event and actual CallKit audio activation remain separate.
#endif
  });
}

+ (void)endIncomingWake:(NSString *)callUUID {
  P11OnMain(^{
#if PHONE11_VOIP_WAKE_COMMISSIONED
    P11SiprixRuntime *runtime = P11SiprixRuntime.shared;
    if (![runtime.wakeContext[@"callUUID"] isEqual:callUUID] || runtime.wakeEnding) return;
    runtime.wakeEnding = YES;
    NSDictionary *call = runtime.calls[runtime.wakeCallId ?: @""];
    if (call) {
      BOOL ringing = [call[@"state"] isEqual:@"ringing"] && ![runtime.acceptedCalls containsObject:runtime.wakeCallId];
      NSUInteger generation = runtime.generation;
      int code = ringing ? [runtime.sdk callReject:runtime.wakeCallId.intValue statusCode:486] : [runtime.sdk callBye:runtime.wakeCallId.intValue];
      if (code != kErrorCodeEOK) [runtime cleanupWake:callUUID generation:generation];
      else dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
        [runtime cleanupWake:callUUID generation:generation];
      });
    } else {
      BOOL cold = runtime.wakeStartedRuntime;
      [runtime clearWake:NO];
      if (cold) [runtime shutdown];
    }
#endif
  });
}

+ (void)setIncomingWakeAudioSession:(AVAudioSession *)session active:(BOOL)active {
  P11OnMain(^{
#if PHONE11_VOIP_WAKE_COMMISSIONED
    P11SiprixRuntime *runtime = P11SiprixRuntime.shared;
    if (!runtime.initialized || runtime.quarantined || session != AVAudioSession.sharedInstance) return;
    if (active) {
      if (!runtime.wakeContext) return;
      runtime.wakeAudioUUID = runtime.wakeContext[@"callUUID"];
      runtime.wakeAudioOwner = runtime.wakeOwner; runtime.wakeAudioGeneration = runtime.generation;
    } else {
      if (!runtime.wakeAudioUUID || runtime.wakeAudioGeneration != runtime.generation ||
          !P11SameWakeOwner(runtime.wakeAudioOwner, runtime.wakeOwner) ||
          (runtime.wakeContext && ![runtime.wakeContext[@"callUUID"] isEqual:runtime.wakeAudioUUID]) ||
          (!runtime.wakeContext && runtime.calls.count)) return;
      runtime.wakeAudioUUID = nil; runtime.wakeAudioOwner = nil;
    }
    if (runtime.audioSessionActive == active) return;
    if (active) [runtime.sdk activateSession:session]; else [runtime.sdk deactivateSession:session];
    runtime.audioSessionActive = active;
    [runtime emit:@"audioSession" data:@{@"audioSessionActive":@(active), @"speaker":@(P11Speaker())}];
#endif
  });
}

RCT_EXPORT_METHOD(bindForegroundWakeContext:(NSDictionary *)binding sip:(NSDictionary *)config resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
#if !PHONE11_VOIP_WAKE_COMMISSIONED
  P11Reject(reject, @"E_WAKE_DISABLED", @"Background calling is not commissioned.");
#else
  P11SiprixRuntime *runtime = [self ready:reject]; if (!runtime) return;
  if (!P11WakeBinding(binding) || ![runtime.accountConfig isEqual:P11AccountIdentity(config)] ||
      (runtime.wakeContext && !P11SameWakeOwner(runtime.wakeContext, binding))) {
    P11Reject(reject, @"E_WAKE_OWNER", @"The verified wake binding does not match this phone session."); return;
  }
  NSMutableDictionary *owner = [NSMutableDictionary new];
  for (NSString *key in @[@"bindingId", @"ownerUserId", @"tenantId", @"deviceId", @"sessionBinding", @"expiresAt"]) owner[key] = binding[key];
  runtime.wakeOwner = owner; resolve(nil);
#endif
}

RCT_EXPORT_METHOD(adoptIncomingWake:(NSDictionary *)binding sip:(NSDictionary *)config resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
#if !PHONE11_VOIP_WAKE_COMMISSIONED
  P11Reject(reject, @"E_WAKE_DISABLED", @"Background calling is not commissioned.");
#else
  P11SiprixRuntime *runtime = P11SiprixRuntime.shared;
  if (!runtime.initialized || runtime.quarantined || !P11WakeBinding(binding) ||
      !P11SameWakeOwner(runtime.wakeContext, binding) || ![runtime.accountConfig isEqual:P11AccountIdentity(config)]) {
    P11Reject(reject, @"E_WAKE_OWNER", @"The incoming wake belongs to another phone session."); return;
  }
  if (runtime.sink && runtime.sink != runtime.wakeBridge && runtime.sink != self) {
    P11Reject(reject, @"E_RUNTIME_IN_USE", @"Another JavaScript bridge owns this phone runtime."); return;
  }
  runtime.lease = self.lease; runtime.sink = self; runtime.wakeBridge = nil;
  runtime.wakeStartedRuntime = NO;
  resolve([runtime snapshot]);
#endif
}

RCT_EXPORT_METHOD(restoreIncomingWakeDelegate:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
#if PHONE11_VOIP_WAKE_COMMISSIONED
  P11SiprixRuntime *runtime = [self ready:reject]; if (!runtime) return;
  if (runtime.wakeContext) [Phone11WakeCoordinator restoreCallKitDelegate];
#endif
  resolve(nil);
}

RCT_EXPORT_METHOD(initialize:(NSDictionary *)options resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  if (![options isKindOfClass:NSDictionary.class] || options.count != 0) {
    P11Reject(reject, @"E_INVALID_ARGUMENT", @"This pinned trial accepts an empty initialization options object."); return;
  }
  P11SiprixRuntime *runtime = P11SiprixRuntime.shared;
  if (runtime.wakeContext && ![runtime.lease isEqualToString:self.lease]) {
    P11Reject(reject, @"E_WAKE_ADOPTION_REQUIRED", @"Validate the phone session before adopting this incoming wake."); return;
  }
  if (runtime.lease && ![runtime.lease isEqualToString:self.lease] && runtime.sink) {
    P11Reject(reject, @"E_RUNTIME_IN_USE", @"Another native bridge owns the Siprix runtime."); return;
  }
  if (runtime.quarantined || (runtime.sdk && !runtime.sink)) {
    if (![self checkSDK:[runtime shutdown] operation:@"cleanup" reject:reject]) return;
  }
  if (runtime.initialized) { runtime.sink = self; resolve([runtime snapshot]); return; }
  runtime.generation += 1;
  runtime.lease = self.lease;
  runtime.sink = self;
  runtime.sdk = [SiprixModule new];
  runtime.delegate = [P11SiprixDelegate new];
  runtime.delegate.runtime = runtime;
  runtime.delegate.generation = runtime.generation;
  SiprixIniData *ini = [SiprixIniData new];
  P11ApplyBuildLicense(ini, [NSBundle.mainBundle objectForInfoDictionaryKey:@"Phone11SiprixLicense"]);
  ini.logLevelFile = @(LogLevelNoLog);
  ini.logLevelIde = @(LogLevelNoLog);
  ini.tlsVerifyServer = @YES;
  ini.singleCallMode = @YES;
  ini.enableVideoCall = @NO;
  ini.unregOnDestroy = @YES;
  int code = [runtime.sdk initialize:runtime.delegate iniData:ini];
  if (code != kErrorCodeEOK) {
    // SDK may retain native resources even after failed initialize.
    [runtime shutdown];
    [self checkSDK:code operation:@"initialize" reject:reject]; return;
  }
  runtime.initialized = YES;
  runtime.sdkVersion = [runtime.sdk version];
  if (!P11PinnedSDKVersion(runtime.sdkVersion)) {
    [runtime shutdown];
    P11Reject(reject, @"E_SDK_VERSION", @"This bridge requires pinned Siprix SDK 1.0.40."); return;
  }
  // Enables external CallKit-managed audio; it does not create an OS provider.
  [runtime.sdk enableCallKit:YES];
  resolve([runtime snapshot]);
}

RCT_EXPORT_METHOD(getSnapshot:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  P11SiprixRuntime *runtime = P11SiprixRuntime.shared;
  if (runtime.wakeContext && ![runtime.lease isEqualToString:self.lease]) {
    NSMutableDictionary *snapshot = [[runtime snapshot] mutableCopy]; snapshot[@"calls"] = @[];
    resolve(snapshot); return;
  }
  if (runtime.lease && ![runtime.lease isEqualToString:self.lease] && runtime.sink) {
    P11Reject(reject, @"E_RUNTIME_IN_USE", @"Another native bridge owns the Siprix runtime."); return;
  }
  if (runtime.quarantined) {
    P11Reject(reject, @"E_CLEANUP_REQUIRED", @"Siprix cleanup failed. Retry destroy before reading state."); return;
  }
  resolve([runtime snapshot]);
}

RCT_EXPORT_METHOD(createAccount:(NSDictionary *)config resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  P11SiprixRuntime *runtime = [self ready:reject]; if (!runtime) return;
  if (![config isKindOfClass:NSDictionary.class] ||
      !P11String(config[@"sipServer"], 512) || !P11String(config[@"sipExtension"], 256) ||
      !P11String(config[@"sipPassword"], 4096) || !P11String(config[@"transport"], 3)) {
    P11Reject(reject, @"E_INVALID_ARGUMENT", @"Account requires SIP server, extension, password, and UDP/TCP/TLS transport."); return;
  }
  if (runtime.accountCreated) {
    P11Reject(reject, @"E_ACCOUNT_EXISTS", @"Destroy and reinitialize before replacing the trial account."); return;
  }
  NSSet *keys = [NSSet setWithArray:@[@"sipServer", @"sipExtension", @"sipPassword", @"sipAuthId", @"sipProxy", @"stunServer",
    @"displName", @"transport", @"port", @"expireTime", @"secureMedia", @"iceEnabled", @"rtcpMuxEnabled", @"rewriteContactIp",
    @"verifyIncomingCall", @"forceSipProxy", @"aCodecs"]];
  for (NSString *key in config) {
    if (![keys containsObject:key]) {
      P11Reject(reject, @"E_INVALID_ARGUMENT", @"Unsupported account configuration field."); return;
    }
  }
  NSString *transport = config[@"transport"];
  if (![@[@"UDP", @"TCP", @"TLS"] containsObject:transport]) {
    P11Reject(reject, @"E_INVALID_ARGUMENT", @"Transport must be UDP, TCP, or TLS."); return;
  }
  for (NSString *key in @[@"sipAuthId", @"sipProxy", @"stunServer", @"displName"]) {
    if (config[key] && !P11String(config[key], 512)) {
      P11Reject(reject, @"E_INVALID_ARGUMENT", @"Optional account strings must be nonempty text."); return;
    }
  }
  for (NSString *key in @[@"iceEnabled", @"rtcpMuxEnabled", @"rewriteContactIp", @"verifyIncomingCall", @"forceSipProxy"]) {
    if (config[key] && !P11Integer(config[key], 0, 1)) {
      P11Reject(reject, @"E_INVALID_ARGUMENT", @"Account boolean options must be true or false."); return;
    }
  }
  if ((config[@"port"] && !P11Integer(config[@"port"], 1, 65535)) ||
      (config[@"expireTime"] && !P11Integer(config[@"expireTime"], 0, 86400)) ||
      (config[@"secureMedia"] && !P11Integer(config[@"secureMedia"], 0, 2))) {
    P11Reject(reject, @"E_INVALID_ARGUMENT", @"Invalid account port, expiry, or media security mode."); return;
  }
  if (config[@"aCodecs"]) {
    if (![config[@"aCodecs"] isKindOfClass:NSArray.class] || [config[@"aCodecs"] count] == 0) {
      P11Reject(reject, @"E_INVALID_ARGUMENT", @"Audio codecs must be a nonempty array of SDK codec IDs."); return;
    }
    for (id codec in config[@"aCodecs"]) {
      if (!P11Integer(codec, AudioCodecsOpus, AudioCodecsG729)) {
        P11Reject(reject, @"E_INVALID_ARGUMENT", @"Invalid pinned SDK audio codec ID."); return;
      }
    }
  }
  SiprixAccData *account = [SiprixAccData new];
  account.sipServer = config[@"sipServer"];
  account.sipExtension = config[@"sipExtension"];
  account.sipPassword = config[@"sipPassword"];
  account.sipAuthId = config[@"sipAuthId"];
  account.sipProxy = config[@"sipProxy"];
  account.stunServer = config[@"stunServer"];
  account.displName = config[@"displName"];
  account.transport = [transport isEqualToString:@"TLS"] ? SipTransportTls :
                      [transport isEqualToString:@"TCP"] ? SipTransportTcp : SipTransportUdp;
  account.port = config[@"port"];
  account.expireTime = @0;
  account.secureMedia = config[@"secureMedia"];
  account.iceEnabled = config[@"iceEnabled"];
  account.rtcpMuxEnabled = config[@"rtcpMuxEnabled"];
  account.rewriteContactIp = config[@"rewriteContactIp"];
  account.verifyIncomingCall = config[@"verifyIncomingCall"];
  account.forceSipProxy = config[@"forceSipProxy"];
  account.aCodecs = config[@"aCodecs"];
  int code = [runtime.sdk accountAdd:account];
  account.sipPassword = @"";
  account.sipAuthId = nil;
  if (![self checkSDK:code operation:@"accountAdd" reject:reject]) return;
  if (account.myAccId <= kInvalidId) {
    runtime.quarantined = YES;
    P11Reject(reject, @"E_SDK_INVALID_ID", @"SDK accountAdd returned an invalid ID. Destroy is required."); return;
  }
  NSString *accountId = P11ID(account.myAccId);
  NSMutableDictionary *state = [@{@"id": accountId, @"accountId": accountId, @"registrationState": @"unregistered"} mutableCopy];
  runtime.accounts[accountId] = state;
  runtime.accountCreated = YES;
#if PHONE11_VOIP_WAKE_COMMISSIONED
  runtime.accountConfig = P11AccountIdentity(config);
#endif
  resolve([state copy]);
}

RCT_EXPORT_METHOD(registerAccount:(NSString *)accountId expireTime:(NSNumber *)expireTime resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  P11SiprixRuntime *runtime = [self ready:reject]; if (!runtime || ![self hasID:accountId in:runtime.accounts reject:reject]) return;
  if (!P11Integer(expireTime, 1, 86400)) {
    P11Reject(reject, @"E_INVALID_ARGUMENT", @"Registration expiry must be between 1 and 86400 seconds."); return;
  }
  if ([self checkSDK:[runtime.sdk accountRegister:accountId.intValue expireTime:expireTime.intValue] operation:@"accountRegister" reject:reject]) resolve(nil);
}

RCT_EXPORT_METHOD(unregisterAccount:(NSString *)accountId resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  P11SiprixRuntime *runtime = [self ready:reject]; if (!runtime || ![self hasID:accountId in:runtime.accounts reject:reject]) return;
  if ([self checkSDK:[runtime.sdk accountUnRegister:accountId.intValue] operation:@"accountUnRegister" reject:reject]) resolve(nil);
}

RCT_EXPORT_METHOD(deleteAccount:(NSString *)accountId resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  P11SiprixRuntime *runtime = [self ready:reject]; if (!runtime || ![self hasID:accountId in:runtime.accounts reject:reject]) return;
  if (runtime.calls.count) { P11Reject(reject, @"E_CALL_ACTIVE", @"End calls before deleting the SIP account."); return; }
  if (![self checkSDK:[runtime.sdk accountDelete:accountId.intValue] operation:@"accountDelete" reject:reject]) return;
  [runtime.accounts removeObjectForKey:accountId];
  resolve(nil);
}

RCT_EXPORT_METHOD(makeCall:(NSString *)accountId destination:(NSString *)destination resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  if (P11SiprixRuntime.shared.wakeContext) { P11Reject(reject, @"E_WAKE_PENDING", @"An incoming wake owns the phone runtime."); return; }
  P11SiprixRuntime *runtime = [self ready:reject]; if (!runtime || ![self hasID:accountId in:runtime.accounts reject:reject]) return;
  if (!P11String(destination, 512)) { P11Reject(reject, @"E_INVALID_ARGUMENT", @"Destination must be nonempty SIP destination text."); return; }
  if (runtime.calls.count) { P11Reject(reject, @"E_CALL_ACTIVE", @"This trial supports one active call."); return; }
  if (![runtime.accounts[accountId][@"registrationState"] isEqualToString:@"registered"]) {
    P11Reject(reject, @"E_NOT_REGISTERED", @"Wait for SDK-confirmed SIP registration before calling."); return;
  }
  SiprixDestData *dest = [SiprixDestData new];
  dest.fromAccId = accountId.intValue;
  dest.toExt = destination;
  dest.withVideo = @NO;
  if (![self checkSDK:[runtime.sdk callInvite:dest] operation:@"callInvite" reject:reject]) return;
  if (dest.myCallId <= kInvalidId) {
    runtime.quarantined = YES;
    P11Reject(reject, @"E_SDK_INVALID_ID", @"SDK callInvite returned an invalid ID. Destroy is required."); return;
  }
  NSString *callId = P11ID(dest.myCallId);
  if ([runtime.retiredCallIDs containsObject:callId]) {
    runtime.quarantined = YES;
    P11Reject(reject, @"E_SDK_INVALID_ID", @"SDK reused a retired call ID. Destroy is required."); return;
  }
  NSMutableDictionary *call = P11Call(callId, accountId, @"outgoing", @"dialing", destination);
  runtime.calls[callId] = call;
  resolve([call copy]);
}

RCT_EXPORT_METHOD(answerCall:(NSString *)callId resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  P11SiprixRuntime *runtime = [self ready:reject]; if (!runtime || ![self hasID:callId in:runtime.calls reject:reject]) return;
  NSDictionary *call = runtime.calls[callId];
  if ([runtime.wakeCallId isEqual:callId]) {
    P11Reject(reject, @"E_WAKE_SYSTEM_ANSWER", @"The native wake coordinator owns this system answer action."); return;
  }
  if (![call[@"direction"] isEqualToString:@"incoming"] || ![call[@"state"] isEqualToString:@"ringing"] ||
      [runtime.acceptedCalls containsObject:callId]) {
    P11Reject(reject, @"E_CALL_STATE", @"Only a ringing incoming call can be answered."); return;
  }
  if ([self checkSDK:[runtime.sdk callAccept:callId.intValue withVideo:NO] operation:@"callAccept" reject:reject]) {
    [runtime.acceptedCalls addObject:callId];
    resolve(nil);
  }
}

RCT_EXPORT_METHOD(hangupCall:(NSString *)callId resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  P11SiprixRuntime *runtime = [self ready:reject]; if (!runtime || ![self hasID:callId in:runtime.calls reject:reject]) return;
  NSDictionary *call = runtime.calls[callId];
  if ([runtime.wakeCallId isEqual:callId] && runtime.wakeEnding) { resolve(nil); return; }
  BOOL ringing = [call[@"direction"] isEqualToString:@"incoming"] && [call[@"state"] isEqualToString:@"ringing"] &&
                 ![runtime.acceptedCalls containsObject:callId];
  int code = ringing ? [runtime.sdk callReject:callId.intValue statusCode:486] : [runtime.sdk callBye:callId.intValue];
  if ([self checkSDK:code operation:ringing ? @"callReject" : @"callBye" reject:reject]) {
    if ([runtime.wakeCallId isEqual:callId]) {
      runtime.wakeEnding = YES;
      NSUInteger generation = runtime.generation; NSString *uuid = runtime.wakeContext[@"callUUID"];
      dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{ [runtime cleanupWake:uuid generation:generation]; });
    }
    resolve(nil);
  }
}

RCT_EXPORT_METHOD(setMute:(NSString *)callId muted:(BOOL)muted resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  P11SiprixRuntime *runtime = [self ready:reject]; if (!runtime || ![self hasID:callId in:runtime.calls reject:reject]) return;
  if (![self checkSDK:[runtime.sdk callMuteMic:callId.intValue mute:muted] operation:@"callMuteMic" reject:reject]) return;
  runtime.calls[callId][@"muted"] = @(muted);
  [runtime emit:@"callMuted" data:@{@"call": [runtime.calls[callId] copy]}];
  resolve(nil);
}

RCT_EXPORT_METHOD(setHold:(NSString *)callId held:(BOOL)held resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  P11SiprixRuntime *runtime = [self ready:reject]; if (!runtime || ![self hasID:callId in:runtime.calls reject:reject]) return;
  if ([runtime.pendingHolds containsObject:callId]) {
    P11Reject(reject, @"E_HOLD_PENDING", @"Wait for the SDK hold callback before another hold command."); return;
  }
  SiprixHoldData *data = [SiprixHoldData new];
  if (![self checkSDK:[runtime.sdk callGetHoldState:callId.intValue holdState:data] operation:@"callGetHoldState" reject:reject]) return;
  BOOL localHeld = (data.holdState & HoldStateLocal) != 0;
  if (localHeld == held) { resolve(nil); return; }
  if (![self checkSDK:[runtime.sdk callHold:callId.intValue] operation:@"callHold" reject:reject]) return;
  [runtime.pendingHolds addObject:callId];
  resolve(nil);
}

RCT_EXPORT_METHOD(sendDtmf:(NSString *)callId digits:(NSString *)digits resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  P11SiprixRuntime *runtime = [self ready:reject]; if (!runtime || ![self hasID:callId in:runtime.calls reject:reject]) return;
  if (!P11String(digits, 32) || [digits rangeOfCharacterFromSet:
      [[NSCharacterSet characterSetWithCharactersInString:@"0123456789*#ABCD"] invertedSet]].location != NSNotFound) {
    P11Reject(reject, @"E_INVALID_ARGUMENT", @"DTMF requires 1-32 digits from 0-9, *, #, A-D."); return;
  }
  if ([self checkSDK:[runtime.sdk callSendDtmf:callId.intValue dtmfs:digits durationMs:160 intertoneGapMs:80 method:DtmfMethodRtp]
          operation:@"callSendDtmf" reject:reject]) resolve(nil);
}

RCT_EXPORT_METHOD(setSpeaker:(BOOL)enabled resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  P11SiprixRuntime *runtime = [self ready:reject]; if (!runtime) return;
  if (!runtime.audioSessionActive) {
    P11Reject(reject, @"E_AUDIO_INACTIVE", @"Wait for CallKeep audio-session activation before changing speaker."); return;
  }
  if (![runtime.sdk overrideAudioOutputToSpeaker:enabled]) {
    P11Reject(reject, @"E_AUDIO_ROUTE", @"Siprix rejected the speaker audio-route request."); return;
  }
  resolve(nil);
}

RCT_EXPORT_METHOD(handleNativeAudioSession:(BOOL)active resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  P11SiprixRuntime *runtime = [self ready:reject]; if (!runtime) return;
  if (active && !runtime.wakeContext) { runtime.wakeAudioUUID = nil; runtime.wakeAudioOwner = nil; }
  if (runtime.audioSessionActive == active) { resolve(nil); return; }
  if (active) [runtime.sdk activateSession:AVAudioSession.sharedInstance];
  else [runtime.sdk deactivateSession:AVAudioSession.sharedInstance];
  runtime.audioSessionActive = active;
  [runtime emit:@"audioSession" data:@{@"audioSessionActive": @(active), @"speaker": @(P11Speaker())}];
  resolve(nil);
}

RCT_EXPORT_METHOD(destroy:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  P11SiprixRuntime *runtime = P11SiprixRuntime.shared;
  if (runtime.wakeContext && ![runtime.lease isEqualToString:self.lease]) {
    P11Reject(reject, @"E_WAKE_ADOPTION_REQUIRED", @"This incoming wake belongs to its validated native owner."); return;
  }
  if (runtime.lease && ![runtime.lease isEqualToString:self.lease] && runtime.sink) {
    P11Reject(reject, @"E_RUNTIME_IN_USE", @"Another native bridge owns the Siprix runtime."); return;
  }
  if (!runtime.sdk) { resolve(nil); return; }
  if ([self checkSDK:[runtime shutdown] operation:@"unInitialize" reject:reject]) resolve(nil);
}
@end
