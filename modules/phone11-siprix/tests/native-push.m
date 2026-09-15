#import "../ios/Phone11VoipPush.m"
#include <stdio.h>
#include <stdlib.h>
PKPushType const PKPushTypeVoIP = @"voip";
static int allocations, clears, deliveries, checks;
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
@implementation Phone11WakeCoordinator
+ (instancetype)shared { static Phone11WakeCoordinator *value; if (!value) value = [self new]; return value; }
+ (void)restoreCallKitDelegate {}
- (BOOL)saveEnrollment:(NSDictionary *)value { return NO; }
- (NSDictionary *)publicBinding { return nil; }
- (void)clearEnrollment { clears++; }
- (void)receivePayload:(NSDictionary *)payload completion:(void (^)(void))completion { deliveries++; completion(); }
- (void)providerDidReset:(CXProvider *)provider {}
@end
int main(void) { @autoreleasepool {
  // Early bootstrap has no dependency on an RCTEventEmitter allocation.
  [Phone11VoipPush bootstrap];
  check(allocations == (PHONE11_VOIP_WAKE_COMMISSIONED ? 1 : 0));
  Phone11VoipPush *module = [Phone11VoipPush new]; __block BOOL rejected = NO;
  [module getCapabilities:^(id value) { check(![value[@"closedAppCalling"] boolValue]); check([value[@"registrationAvailable"] boolValue] == (PHONE11_VOIP_WAKE_COMMISSIONED != 0)); } rejecter:nil];
  [module start:^(id value) {} rejecter:^(NSString *code, NSString *message, NSError *error) { rejected = YES; }];
  check(rejected == !PHONE11_VOIP_WAKE_COMMISSIONED);
  P11VoipRegistry *manager = [P11VoipRegistry shared];
  if (PHONE11_VOIP_WAKE_COMMISSIONED) {
    [module start:^(id value) {} rejecter:nil]; check(allocations == 1);
    PKPushRegistry *registry = manager.registry; [module startObserving];
    PKPushCredentials *credentials = [PKPushCredentials new];
    unsigned char bytes[] = {0, 1, 127, 255}; credentials.token = [NSData dataWithBytes:bytes length:4];
    [manager pushRegistry:registry didUpdatePushCredentials:credentials forType:PKPushTypeVoIP];
    check([manager.token isEqual:@"00017fff"]); check(module.testEvents.count == 1);
    [module invalidate]; check(manager.registry == registry && manager.sink == nil);
    [manager pushRegistry:registry didInvalidatePushTokenForType:PKPushTypeVoIP]; check(manager.token == nil && clears == 1);
    [module stop:^(id value) {} rejecter:nil]; check(!manager.registry && !registry.delegate && registry.desiredPushTypes.count == 0);
    [manager pushRegistry:registry didUpdatePushCredentials:credentials forType:PKPushTypeVoIP]; check(manager.token == nil);
  }
  PKPushPayload *payload = [PKPushPayload new]; payload.dictionaryPayload = @{@"callId":@"untrusted"};
  __block BOOL completed = NO;
  [manager pushRegistry:nil didReceiveIncomingPushWithPayload:payload forType:PKPushTypeVoIP withCompletionHandler:^{ completed = YES; }];
  check(completed && deliveries == 1);
  printf("PASS: %d native push assertions\n", checks);
} return 0; }
