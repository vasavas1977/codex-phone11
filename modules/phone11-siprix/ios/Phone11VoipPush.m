#import "Phone11VoipPush.h"
#import "Phone11WakeCoordinator.h"
#import <PushKit/PushKit.h>

@interface P11VoipRegistry : NSObject <PKPushRegistryDelegate>
@property(nonatomic, strong) PKPushRegistry *registry;
@property(nonatomic, copy) NSString *token;
@property(nonatomic, weak) Phone11VoipPush *sink;
+ (instancetype)shared;
- (void)start;
- (void)stop;
@end
@interface Phone11VoipPush ()
@property(nonatomic, assign) BOOL observing;
- (void)publishToken:(NSString *)token;
@end

@implementation P11VoipRegistry
+ (instancetype)shared { static P11VoipRegistry *value; static dispatch_once_t once; dispatch_once(&once, ^{ value = [self new]; }); return value; }
- (void)start {
  if (!PHONE11_VOIP_WAKE_COMMISSIONED || self.registry) return;
  self.registry = [[PKPushRegistry alloc] initWithQueue:dispatch_get_main_queue()];
  self.registry.delegate = self;
  self.registry.desiredPushTypes = [NSSet setWithObject:PKPushTypeVoIP];
}
- (void)stop {
  self.registry.desiredPushTypes = [NSSet set]; self.registry.delegate = nil;
  self.registry = nil; self.token = nil;
  [[Phone11WakeCoordinator shared] clearEnrollment];
}
- (void)pushRegistry:(PKPushRegistry *)registry didUpdatePushCredentials:(PKPushCredentials *)credentials forType:(PKPushType)type {
  if (registry != self.registry || ![type isEqualToString:PKPushTypeVoIP]) return;
  NSMutableString *token = [NSMutableString stringWithCapacity:credentials.token.length * 2];
  const unsigned char *bytes = credentials.token.bytes;
  for (NSUInteger i = 0; i < credentials.token.length; i++) [token appendFormat:@"%02x", bytes[i]];
  // Token refresh does not end an active call. Authenticated register-first
  // rotation atomically updates the server revision bound to the same grant.
  self.token = token.length ? token : nil; [self.sink publishToken:self.token];
}
- (void)pushRegistry:(PKPushRegistry *)registry didInvalidatePushTokenForType:(PKPushType)type {
  if (registry != self.registry || ![type isEqualToString:PKPushTypeVoIP]) return;
  self.token = nil; [[Phone11WakeCoordinator shared] clearEnrollment]; [self.sink publishToken:nil];
}
- (void)pushRegistry:(PKPushRegistry *)registry didReceiveIncomingPushWithPayload:(PKPushPayload *)payload forType:(PKPushType)type withCompletionHandler:(void (^)(void))completion {
  if (![type isEqualToString:PKPushTypeVoIP]) { completion(); return; }
  [[Phone11WakeCoordinator shared] receivePayload:payload.dictionaryPayload completion:completion];
}
@end

@implementation Phone11VoipPush
RCT_EXPORT_MODULE(Phone11VoipPush)
+ (BOOL)requiresMainQueueSetup { return YES; }
+ (void)bootstrap { if (PHONE11_VOIP_WAKE_COMMISSIONED) [[P11VoipRegistry shared] start]; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }
- (NSArray<NSString *> *)supportedEvents { return @[@"Phone11VoipToken"]; }
- (void)startObserving { self.observing = YES; }
- (void)stopObserving { self.observing = NO; }
- (void)publishToken:(NSString *)token {
  if (self.observing) [self sendEventWithName:@"Phone11VoipToken" body:@{@"token":token ?: (id)NSNull.null}];
}
RCT_EXPORT_METHOD(getCapabilities:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  resolve(@{@"registrationAvailable":@(PHONE11_VOIP_WAKE_COMMISSIONED != 0), @"closedAppCalling":@NO, @"reason":@"native_wake_not_commissioned"});
}
RCT_EXPORT_METHOD(createDeviceId:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) { resolve(NSUUID.UUID.UUIDString); }
RCT_EXPORT_METHOD(start:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  if (!PHONE11_VOIP_WAKE_COMMISSIONED) { reject(@"NOT_COMMISSIONED", @"Background calling is not commissioned", nil); return; }
  P11VoipRegistry *manager = [P11VoipRegistry shared]; manager.sink = self; [manager start]; resolve(manager.token ?: (id)NSNull.null);
}
RCT_EXPORT_METHOD(stop:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) { [[P11VoipRegistry shared] stop]; resolve(nil); }
RCT_EXPORT_METHOD(saveWakeEnrollment:(NSDictionary *)value resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  if ([[Phone11WakeCoordinator shared] saveEnrollment:value]) resolve(nil);
  else reject(@"WAKE_ENROLLMENT_UNAVAILABLE", @"Incoming call setup is unavailable", nil);
}
RCT_EXPORT_METHOD(getWakeBinding:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) { resolve([[Phone11WakeCoordinator shared] publicBinding] ?: (id)NSNull.null); }
- (void)invalidate {
  // The cold-launch registry belongs to the process, not a transient RN bridge.
  if ([P11VoipRegistry shared].sink == self) [P11VoipRegistry shared].sink = nil;
  [super invalidate];
}
@end
