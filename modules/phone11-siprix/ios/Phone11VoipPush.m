#import <React/RCTEventEmitter.h>
#import <PushKit/PushKit.h>
#import <RNCallKeep/RNCallKeep.h>

// Deliberately closed in shipping builds. Opening this requires native launch
// integration, authenticated SIP wake-up, APNs commissioning and handset proof.
// This is not a remotely switchable feature flag.
#ifndef PHONE11_VOIP_WAKE_COMMISSIONED
#define PHONE11_VOIP_WAKE_COMMISSIONED 0
#endif

@interface Phone11VoipPush : RCTEventEmitter <PKPushRegistryDelegate>
@property(nonatomic, strong) PKPushRegistry *registry;
@property(nonatomic, copy) NSString *token;
@property(nonatomic, assign) BOOL observing;
@end

@implementation Phone11VoipPush
RCT_EXPORT_MODULE(Phone11VoipPush)
+ (BOOL)requiresMainQueueSetup { return YES; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }
- (NSArray<NSString *> *)supportedEvents { return @[@"Phone11VoipToken"]; }
- (void)startObserving { self.observing = YES; }
- (void)stopObserving { self.observing = NO; }

RCT_EXPORT_METHOD(getCapabilities:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  resolve(@{@"registrationAvailable": @(PHONE11_VOIP_WAKE_COMMISSIONED != 0),
            @"closedAppCalling": @NO, @"reason": @"native_wake_not_commissioned"});
}

RCT_EXPORT_METHOD(createDeviceId:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  resolve([[NSUUID UUID] UUIDString]);
}

RCT_EXPORT_METHOD(start:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  if (!PHONE11_VOIP_WAKE_COMMISSIONED) {
    reject(@"NOT_COMMISSIONED", @"Background calling is not commissioned", nil);
    return;
  }
  if (!self.registry) {
    self.registry = [[PKPushRegistry alloc] initWithQueue:dispatch_get_main_queue()];
    self.registry.delegate = self;
    self.registry.desiredPushTypes = [NSSet setWithObject:PKPushTypeVoIP];
  }
  resolve(self.token ?: (id)[NSNull null]);
}

RCT_EXPORT_METHOD(stop:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  self.registry.desiredPushTypes = [NSSet set];
  self.registry.delegate = nil;
  self.registry = nil;
  self.token = nil;
  resolve(nil);
}

- (void)pushRegistry:(PKPushRegistry *)registry didUpdatePushCredentials:(PKPushCredentials *)credentials forType:(PKPushType)type {
  if (registry != self.registry || ![type isEqualToString:PKPushTypeVoIP]) return;
  NSMutableString *token = [NSMutableString stringWithCapacity:credentials.token.length * 2];
  const unsigned char *bytes = credentials.token.bytes;
  for (NSUInteger i = 0; i < credentials.token.length; i++) [token appendFormat:@"%02x", bytes[i]];
  self.token = token.length ? token : nil;
  if (self.observing) [self sendEventWithName:@"Phone11VoipToken" body:@{@"token": self.token ?: (id)[NSNull null]}];
}

- (void)pushRegistry:(PKPushRegistry *)registry didInvalidatePushTokenForType:(PKPushType)type {
  if (registry != self.registry || ![type isEqualToString:PKPushTypeVoIP]) return;
  self.token = nil;
  if (self.observing) [self sendEventWithName:@"Phone11VoipToken" body:@{@"token": [NSNull null]}];
}

- (void)pushRegistry:(PKPushRegistry *)registry didReceiveIncomingPushWithPayload:(PKPushPayload *)payload forType:(PKPushType)type withCompletionHandler:(void (^)(void))completion {
  if (![type isEqualToString:PKPushTypeVoIP]) { completion(); return; }
  // Even an unexpected late/invalidated VoIP delivery must be reported natively.
  // No JS, keychain access, network, caller payload or SIP setup precedes CallKit.
  // A fresh UUID prevents an untrusted payload from ending an existing SIP call.
  NSUUID *uuid = [NSUUID UUID];
  // RNCallKeep owns the ONLY CXProvider. Supply its existing settings unchanged;
  // this fallback is only for a callback before JS has initialized CallKeep.
  NSDictionary *settings = [[NSUserDefaults standardUserDefaults] dictionaryForKey:@"RNCallKeepSettings"];
  RNCallKeep *callKeep = [RNCallKeep allocWithZone:nil];
  if (!callKeep.callKeepProvider) [RNCallKeep setup:settings ?: @{@"appName": @"Phone11", @"supportsVideo": @NO,
      @"maximumCallGroups": @1, @"maximumCallsPerCallGroup": @1}];
  CXProvider *provider = callKeep.callKeepProvider;
  CXCallUpdate *update = [CXCallUpdate new];
  update.remoteHandle = [[CXHandle alloc] initWithType:CXHandleTypeGeneric value:@"Phone11"];
  update.localizedCallerName = @"Phone11 call unavailable";
  update.hasVideo = NO;
  update.supportsHolding = NO;
  update.supportsDTMF = NO;
  update.supportsGrouping = NO;
  update.supportsUngrouping = NO;
  [provider reportNewIncomingCallWithUUID:uuid update:update completion:^(NSError *error) {
        // Wake-up credentials remain protected while locked. Until the complete
        // native SIP/CallKit handoff exists, truthfully fail this isolated call.
        if (!error) [provider reportCallWithUUID:uuid endedAtDate:[NSDate date] reason:CXCallEndedReasonFailed];
        completion();
      }];
}

- (void)invalidate {
  self.registry.desiredPushTypes = [NSSet set];
  self.registry.delegate = nil;
  self.registry = nil;
  self.token = nil;
  [super invalidate];
}
@end
