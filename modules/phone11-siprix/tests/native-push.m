#import "../ios/Phone11VoipPush.m"
#include <stdio.h>
#include <stdlib.h>
PKPushType const PKPushTypeVoIP = @"voip";
static int allocations, setups, reports, ends, checks;
static NSUUID *reportedUUID;
static BOOL reportError;
static NSMutableArray *order;
static void check(BOOL ok) { checks++; if (!ok) { fprintf(stderr, "FAIL assertion %d\n", checks); exit(1); } }
@implementation PKPushRegistry
- (instancetype)initWithQueue:(dispatch_queue_t)queue { allocations++; return [super init]; }
@end
@implementation PKPushCredentials
@end
@implementation PKPushPayload
@end
@implementation RCTEventEmitter
- (instancetype)init { if ((self = [super init])) self.testEvents = [NSMutableArray new]; return self; }
- (void)sendEventWithName:(NSString *)name body:(id)body { [self.testEvents addObject:body]; }
- (void)invalidate {}
@end
@implementation CXHandle
- (instancetype)initWithType:(CXHandleType)type value:(NSString *)value { if ((self = [super init])) self.value = value; return self; }
@end
@implementation CXCallUpdate
@end
@implementation CXProvider
- (void)reportNewIncomingCallWithUUID:(NSUUID *)uuid update:(CXCallUpdate *)update completion:(void (^)(NSError *error))completion {
  reports++; reportedUUID = uuid; [order addObject:@"report"];
  check([uuid isKindOfClass:[NSUUID class]]);
  check([update.remoteHandle.value isEqual:@"Phone11"] && !update.hasVideo);
  completion(reportError ? [NSError errorWithDomain:@"CallKit" code:2 userInfo:nil] : nil);
}
- (void)reportCallWithUUID:(NSUUID *)uuid endedAtDate:(NSDate *)date reason:(CXCallEndedReason)reason { ends++; [order addObject:@"end"]; check([uuid isEqual:reportedUUID] && reason == CXCallEndedReasonFailed); }
@end
@implementation RNCallKeep
+ (id)allocWithZone:(NSZone *)zone { static RNCallKeep *instance; static dispatch_once_t once; dispatch_once(&once, ^{ instance = [super allocWithZone:zone]; }); return instance; }
+ (void)setup:(NSDictionary *)options { setups++; RNCallKeep *instance = [self allocWithZone:nil]; instance.callKeepProvider = [CXProvider new]; [[NSUserDefaults standardUserDefaults] setObject:options forKey:@"RNCallKeepSettings"]; }
@end
int main(void) { @autoreleasepool {
  Phone11VoipPush *module = [Phone11VoipPush new];
  __block BOOL rejected = NO;
  [module getCapabilities:^(id value) { check(![value[@"closedAppCalling"] boolValue]); check([value[@"registrationAvailable"] boolValue] == (PHONE11_VOIP_WAKE_COMMISSIONED != 0)); } rejecter:nil];
  [module start:^(id value) {} rejecter:^(NSString *code, NSString *message, NSError *error) { rejected = YES; }];
  check(rejected == !PHONE11_VOIP_WAKE_COMMISSIONED);
  check(allocations == (PHONE11_VOIP_WAKE_COMMISSIONED ? 1 : 0));
  if (PHONE11_VOIP_WAKE_COMMISSIONED) {
    [module start:^(id value) {} rejecter:nil]; check(allocations == 1);
    PKPushRegistry *registry = module.registry;
    [module startObserving];
    PKPushCredentials *credentials = [PKPushCredentials new];
    unsigned char bytes[] = {0, 1, 127, 255}; credentials.token = [NSData dataWithBytes:bytes length:4];
    [module pushRegistry:registry didUpdatePushCredentials:credentials forType:PKPushTypeVoIP];
    check([module.token isEqual:@"00017fff"]); check(module.testEvents.count == 1);
    [module pushRegistry:registry didInvalidatePushTokenForType:PKPushTypeVoIP]; check(module.token == nil);
    check(module.testEvents.lastObject[@"token"] == [NSNull null]);
    [module stop:^(id value) {} rejecter:nil]; check(!module.registry && !registry.delegate && registry.desiredPushTypes.count == 0);
    [module pushRegistry:registry didUpdatePushCredentials:credentials forType:PKPushTypeVoIP]; check(module.token == nil);
  }
  // Unexpected delivery still reports and ends with JS absent and the gate shut.
  order = [NSMutableArray new];
  [[NSUserDefaults standardUserDefaults] setObject:@{@"appName": @"Existing"} forKey:@"RNCallKeepSettings"];
  [RNCallKeep allocWithZone:nil].callKeepProvider = [CXProvider new];
  PKPushPayload *payload = [PKPushPayload new]; payload.dictionaryPayload = @{@"callId": @"existing-sip-call", @"callerName": @"PRIVATE"};
  [module pushRegistry:nil didReceiveIncomingPushWithPayload:payload forType:PKPushTypeVoIP withCompletionHandler:^{ [order addObject:@"complete"]; }];
  check(reports == 1 && ends == 1 && setups == 0);
  check([order isEqual:@[@"report", @"end", @"complete"]]);
  check(![reportedUUID.UUIDString isEqual:@"existing-sip-call"]);
  reportError = YES; order = [NSMutableArray new];
  [module pushRegistry:nil didReceiveIncomingPushWithPayload:payload forType:PKPushTypeVoIP withCompletionHandler:^{ [order addObject:@"complete"]; }];
  check(reports == 2 && ends == 1); check([order isEqual:@[@"report", @"complete"]]);
  [module invalidate]; check(module.registry == nil);
  printf("PASS: %d native push assertions\n", checks);
} return 0; }
