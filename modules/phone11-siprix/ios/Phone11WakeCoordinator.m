#import "Phone11WakeCoordinator.h"
#import "Phone11Siprix.h"
#import <RNCallKeep/RNCallKeep.h>
#import <Security/Security.h>

// A bounded device-local trail contains only fixed labels and numeric outcomes.
static NSString *const P11WakeDiagnosticKey = @"ai.phone11.native.wake-diagnostics.v1";
static NSString *P11PrepareFailure(NSError *error) {
  NSDictionary *known = @{@"Incoming wake owner mismatch.":@"wake_owner_mismatch",
    @"Incoming wake account configuration mismatch.":@"account_config_mismatch",
    @"Incoming wake account count mismatch.":@"account_count_mismatch",
    @"Incoming wake runtime sink missing.":@"runtime_sink_missing",@"The foreground phone session does not match this wake.":@"owner_or_config_mismatch",
    @"The phone runtime is already busy.":@"runtime_busy",
    @"Incoming wake registration failed.":@"registration_failed",
    @"Incoming wake registration request failed.":@"registration_request_failed",
    @"Incoming wake expired.":@"expired",
    @"Invalid or expired incoming wake.":@"invalid_or_expired",
    @"Could not prepare the incoming phone runtime.":@"runtime_setup_failed"};
  return known[error.localizedDescription ?: @""] ?: @"other";
}
static NSString *const P11WakeKey = @"ai.phone11.native.incoming-wake.v1";
static BOOL P11UUID(id value) { return [value isKindOfClass:NSString.class] && [[NSUUID alloc] initWithUUIDString:value] != nil; }
static BOOL P11Positive(id value) { return [value isKindOfClass:NSNumber.class] && [value doubleValue] > 0 && [value doubleValue] == [value longLongValue]; }
static NSArray *P11BindingKeys(void) { return @[@"bindingId", @"ownerUserId", @"tenantId", @"deviceId", @"sessionBinding", @"expiresAt"]; }
static BOOL P11ValidEnrollment(NSDictionary *value) {
  if (![value isKindOfClass:NSDictionary.class] || !P11UUID(value[@"bindingId"]) || !P11UUID(value[@"sessionBinding"]) ||
      !P11Positive(value[@"ownerUserId"]) || !P11Positive(value[@"tenantId"]) || !P11Positive(value[@"expiresAt"]) ||
      ![value[@"deviceId"] isKindOfClass:NSString.class] || [value[@"deviceId"] length] < 1 || [value[@"deviceId"] length] > 256) return NO;
  NSString *grant = value[@"grant"];
  return [grant isKindOfClass:NSString.class] && grant.length == 43 &&
      [grant rangeOfCharacterFromSet:[[NSCharacterSet characterSetWithCharactersInString:@"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"] invertedSet]].location == NSNotFound;
}

@interface Phone11WakeCoordinator ()
@property(nonatomic, strong) RNCallKeep *callKeep;
@property(nonatomic, strong) CXProvider *provider;
@property(nonatomic, strong) NSURLSession *session;
@property(nonatomic, strong) NSMutableSet<NSURLSessionTask *> *tasks;
@property(nonatomic, strong) NSDictionary *active;
@property(nonatomic, strong) NSDictionary *enrollment;
@property(nonatomic, strong) CXAnswerCallAction *answer;
@property(nonatomic, assign) NSUInteger generation;
@property(nonatomic, assign) BOOL incoming, connected, accepting, wakeAudioActive;
@end

@implementation Phone11WakeCoordinator
+ (instancetype)shared { static Phone11WakeCoordinator *value; static dispatch_once_t once; dispatch_once(&once, ^{ value = [self new]; }); return value; }
+ (void)restoreCallKitDelegate { if (PHONE11_VOIP_WAKE_COMMISSIONED) [[self shared] installProvider]; }
- (instancetype)init { if ((self = [super init])) self.tasks = [NSMutableSet new]; return self; }
- (double)now { return NSDate.date.timeIntervalSince1970 * 1000; }
- (void)scheduleAfter:(double)seconds block:(void (^)(void))block {
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(seconds * NSEC_PER_SEC)), dispatch_get_main_queue(), block);
}
- (void)recordStage:(NSString *)stage code:(NSInteger)code classification:(NSString *)classification {
  NSArray *stages = @[@"reported",@"claim_http",@"ready_http",@"claim_rejected",@"prepare_complete",@"incoming",@"connected",@"answer_requested",@"answer_accept",@"answer_result",@"finished"];
  NSArray *classes = @[@"wake_owner_mismatch",@"account_config_mismatch",@"account_count_mismatch",@"runtime_sink_missing",@"none",@"transport_error",@"owner_or_config_mismatch",@"runtime_busy",@"registration_failed",@"registration_request_failed",@"expired",@"invalid_or_expired",@"runtime_setup_failed",@"other"];
  if (![stages containsObject:stage] || ![classes containsObject:classification] || code < -1 || code > 999) return;
  NSDictionary *entry = @{@"timestamp":@([self now]),@"stage":stage,@"code":@(code),@"classification":classification};
  NSUserDefaults *defaults = NSUserDefaults.standardUserDefaults;
  NSArray *saved = [defaults arrayForKey:P11WakeDiagnosticKey];
  NSMutableArray *trail = [NSMutableArray new];
  for (id item in saved) {
    if (![item isKindOfClass:NSDictionary.class] || [item count] != 4) continue;
    if (![stages containsObject:item[@"stage"]] || ![classes containsObject:item[@"classification"]] ||
        ![item[@"timestamp"] isKindOfClass:NSNumber.class] || ![item[@"code"] isKindOfClass:NSNumber.class]) continue;
    [trail addObject:item];
  }
  [trail addObject:entry];
  while (trail.count > 32) [trail removeObjectAtIndex:0];
  [defaults setObject:trail forKey:P11WakeDiagnosticKey];
  NSLog(@"Phone11Wake stage=%@ code=%ld classification=%@",stage,(long)code,classification);
}
- (NSDictionary *)readEnrollment {
  CFTypeRef data = NULL;
  OSStatus code = SecItemCopyMatching((__bridge CFDictionaryRef)@{(__bridge id)kSecClass:(__bridge id)kSecClassGenericPassword,
      (__bridge id)kSecAttrService:P11WakeKey, (__bridge id)kSecAttrAccount:@"incoming", (__bridge id)kSecReturnData:@YES,
      (__bridge id)kSecMatchLimit:(__bridge id)kSecMatchLimitOne}, &data);
  if (code != errSecSuccess || !data) return nil;
  NSData *bytes = CFBridgingRelease(data);
  id value = [NSJSONSerialization JSONObjectWithData:bytes options:0 error:nil];
  return P11ValidEnrollment(value) && [value[@"expiresAt"] doubleValue] > [self now] ? value : nil;
}
- (BOOL)writeEnrollment:(NSDictionary *)value {
  NSDictionary *query = @{(__bridge id)kSecClass:(__bridge id)kSecClassGenericPassword, (__bridge id)kSecAttrService:P11WakeKey,
      (__bridge id)kSecAttrAccount:@"incoming"};
  if (!value) { OSStatus code = SecItemDelete((__bridge CFDictionaryRef)query); return code == errSecSuccess || code == errSecItemNotFound; }
  NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
  NSDictionary *attributes = @{(__bridge id)kSecValueData:data,
      // Only this limited incoming-call grant changes accessibility. Existing SIP
      // passwords, auth bearer, device ID and token ledger remain WHEN_UNLOCKED.
      (__bridge id)kSecAttrAccessible:(__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly};
  OSStatus code = SecItemUpdate((__bridge CFDictionaryRef)query, (__bridge CFDictionaryRef)attributes);
  if (code == errSecItemNotFound) { NSMutableDictionary *item = [query mutableCopy]; [item addEntriesFromDictionary:attributes]; code = SecItemAdd((__bridge CFDictionaryRef)item, NULL); }
  return code == errSecSuccess;
}
- (BOOL)saveEnrollment:(NSDictionary *)value {
  if (!PHONE11_VOIP_WAKE_COMMISSIONED || !P11ValidEnrollment(value) || [value[@"expiresAt"] doubleValue] <= [self now]) return NO;
  // Never rotate an in-flight wake into a different session behind its owner.
  if (self.active && ![value[@"bindingId"] isEqual:self.active[@"bindingId"]]) return NO;
  if (![self writeEnrollment:value]) return NO;
  return YES;
}
- (NSDictionary *)publicBinding {
  if (!PHONE11_VOIP_WAKE_COMMISSIONED) return nil;
  NSDictionary *value = [self readEnrollment];
  return value ? [value dictionaryWithValuesForKeys:P11BindingKeys()] : nil;
}
- (void)clearEnrollment {
  [self finish:CXCallEndedReasonFailed notifyServer:YES];
  ++self.generation;
  for (NSURLSessionTask *task in self.tasks) [task cancel];
  [self.tasks removeAllObjects];
  self.enrollment = nil;
  [self writeEnrollment:nil];
}
- (void)installProvider {
  self.callKeep = [RNCallKeep allocWithZone:nil];
  if (!self.callKeep.callKeepProvider) [RNCallKeep setup:[[NSUserDefaults standardUserDefaults] dictionaryForKey:@"RNCallKeepSettings"] ?: @{
      @"appName":@"Phone11", @"supportsVideo":@NO, @"maximumCallGroups":@1, @"maximumCallsPerCallGroup":@1}];
  self.provider = self.callKeep.callKeepProvider;
  if (PHONE11_VOIP_WAKE_COMMISSIONED) [self.provider setDelegate:self queue:dispatch_get_main_queue()];
}
- (BOOL)respondsToSelector:(SEL)selector { return [super respondsToSelector:selector] || [self.callKeep respondsToSelector:selector]; }
- (id)forwardingTargetForSelector:(SEL)selector { return [self.callKeep respondsToSelector:selector] ? self.callKeep : [super forwardingTargetForSelector:selector]; }
- (BOOL)isCurrent:(NSUInteger)generation { return self.active && self.generation == generation; }
- (BOOL)owns:(NSUUID *)uuid { return [uuid.UUIDString.lowercaseString isEqual:[self.active[@"callUUID"] lowercaseString]]; }
- (void)receivePayload:(NSDictionary *)payload completion:(void (^)(void))completion {
  [self installProvider];
  BOOL shape = PHONE11_VOIP_WAKE_COMMISSIONED && [payload isKindOfClass:NSDictionary.class] && [payload[@"v"] isEqual:@1] &&
      P11UUID(payload[@"callUUID"]) && P11UUID(payload[@"bindingId"]) && P11Positive(payload[@"expiresAt"]) &&
      [payload[@"expiresAt"] doubleValue] > [self now] && [payload[@"expiresAt"] doubleValue] <= [self now] + 30000;
  BOOL duplicate = shape && [payload[@"callUUID"] caseInsensitiveCompare:self.active[@"callUUID"] ?: @""] == NSOrderedSame && [payload[@"bindingId"] isEqual:self.active[@"bindingId"]];
  BOOL usable = shape && (!self.active || duplicate);
  NSUUID *uuid = usable ? [[NSUUID alloc] initWithUUIDString:payload[@"callUUID"]] : NSUUID.UUID;
  CXCallUpdate *update = [CXCallUpdate new];
  update.remoteHandle = [[CXHandle alloc] initWithType:CXHandleTypeGeneric value:@"Phone11"];
  update.localizedCallerName = @"Incoming Phone11 call";
  update.hasVideo = NO; update.supportsHolding = NO; update.supportsDTMF = NO; update.supportsGrouping = NO; update.supportsUngrouping = NO;
  NSUInteger reservedGeneration = self.generation;
  if (usable && !duplicate) {
    // Reserve the one wake slot before asynchronous CallKit completion. An early
    // Answer is retained here; a second push cannot overwrite this call.
    self.active = @{ @"callUUID":uuid.UUIDString.lowercaseString, @"bindingId":payload[@"bindingId"], @"expiresAt":payload[@"expiresAt"] };
    self.enrollment = nil; self.incoming = NO; self.connected = NO; self.accepting = NO;
    reservedGeneration = ++self.generation;
  }
  // Report immediately; even invalid/expired deliveries complete the CallKit
  // requirement. No keychain read, JS bridge or network precedes this call.
  void (^reported)(NSError *) = ^(NSError *error) {
    completion();
    [self recordStage:@"reported" code:error ? 1 : 0 classification:@"none"];
    if (duplicate) return;
    if (error) {
      // Do not end a UUID that CallKit rejected as already present.
      if (usable && [self isCurrent:reservedGeneration]) { self.active = nil; ++self.generation; [self.answer fail]; self.answer = nil; }
      return;
    }
    if (usable && ![self isCurrent:reservedGeneration]) { [self.provider reportCallWithUUID:uuid endedAtDate:NSDate.date reason:CXCallEndedReasonFailed]; return; }
    if (!usable) { [self.provider reportCallWithUUID:uuid endedAtDate:NSDate.date reason:CXCallEndedReasonFailed]; return; }
    NSDictionary *enrollment = [self readEnrollment];
    if (![enrollment[@"bindingId"] isEqual:payload[@"bindingId"]]) { [self finish:CXCallEndedReasonFailed notifyServer:NO]; return; }
    self.enrollment = enrollment;
    NSUInteger generation = reservedGeneration;
    [self scheduleAfter:MAX(0, [payload[@"expiresAt"] doubleValue] - [self now]) / 1000 block:^{
      if ([self isCurrent:generation] && !self.connected) [self finish:CXCallEndedReasonUnanswered notifyServer:YES];
    }];
    [self request:@"claim" completion:^(NSDictionary *response) {
      if (![self isCurrent:generation]) return;
      BOOL identity = YES;
      for (NSString *key in @[@"bindingId", @"ownerUserId", @"tenantId", @"deviceId", @"sessionBinding"]) if (![response[key] isEqual:enrollment[key]]) identity = NO;
      if (!identity || ![@[@"pending", @"ready"] containsObject:response[@"status"] ?: @""] || ![response[@"sip"] isKindOfClass:NSDictionary.class]) { [self recordStage:@"claim_rejected" code:0 classification:@"none"]; [self finish:CXCallEndedReasonFailed notifyServer:YES]; return; }
      NSMutableDictionary *context = [[enrollment dictionaryWithValuesForKeys:P11BindingKeys()] mutableCopy];
      [context addEntriesFromDictionary:self.active]; context[@"v"] = @1; context[@"grantExpiresAt"] = enrollment[@"expiresAt"];
      [Phone11Siprix prepareIncomingWake:context sip:response[@"sip"] event:^(NSDictionary *event) {
        if (![self isCurrent:generation] || ![event[@"callUUID"] isKindOfClass:NSString.class] || [event[@"callUUID"] caseInsensitiveCompare:self.active[@"callUUID"]] != NSOrderedSame) return;
        NSString *type = event[@"type"];
        if ([type isEqual:@"incoming"] || [type isEqual:@"connected"]) [self recordStage:type code:0 classification:@"none"];
        if ([type isEqual:@"incoming"]) { self.incoming = YES; [self acceptIfReady]; }
        else if ([type isEqual:@"connected"]) { self.connected = YES; [self.answer fulfill]; self.answer = nil; [self heartbeat:generation]; }
        else if ([type isEqual:@"terminated"]) [self finish:CXCallEndedReasonRemoteEnded notifyServer:YES];
        else if ([type isEqual:@"failed"]) [self finish:CXCallEndedReasonFailed notifyServer:YES];
      } completion:^(NSError *error) {
        if (![self isCurrent:generation]) return;
        [self recordStage:@"prepare_complete" code:error ? 1 : 0 classification:error ? P11PrepareFailure(error) : @"none"];
        if (error) { [self finish:CXCallEndedReasonFailed notifyServer:YES]; return; }
        if (self.wakeAudioActive) [Phone11Siprix setIncomingWakeAudioSession:AVAudioSession.sharedInstance active:YES];
        [self request:@"ready" completion:^(NSDictionary *ready) {
          if (![self isCurrent:generation]) return;
          if (![ready[@"status"] isEqual:@"ready"]) [self finish:CXCallEndedReasonFailed notifyServer:YES];
          else [self poll:generation];
        }];
      }];
    }];
  };
  [self.provider reportNewIncomingCallWithUUID:uuid update:update completion:^(NSError *error) {
    if (NSThread.isMainThread) reported(error);
    else dispatch_async(dispatch_get_main_queue(), ^{ reported(error); });
  }];
}
- (void)poll:(NSUInteger)generation {
  if (![self isCurrent:generation] || self.connected) return;
  [self request:@"status" completion:^(NSDictionary *response) {
    if (![self isCurrent:generation] || self.connected) return;
    if (![@[@"pending", @"ready"] containsObject:response[@"status"] ?: @""]) { [self finish:CXCallEndedReasonRemoteEnded notifyServer:NO]; return; }
    [self scheduleAfter:1 block:^{ [self poll:generation]; }];
  }];
}
- (void)heartbeat:(NSUInteger)generation {
  if (![self isCurrent:generation] || !self.connected) return;
  [self request:@"ready" completion:^(NSDictionary *response) {
    if (![self isCurrent:generation] || !self.connected) return;
    if ([response[@"authorizationRejected"] boolValue]) {
      [self finish:CXCallEndedReasonFailed notifyServer:NO]; [self writeEnrollment:nil]; return;
    }
    if ([@[@"cancelled", @"ended"] containsObject:response[@"status"] ?: @""]) {
      // This response has already matched the active UUID/binding and generation.
      // The authoritative terminal state closes only this native wake.
      [self finish:CXCallEndedReasonRemoteEnded notifyServer:NO]; return;
    }
    // Actual SIP activity owns the call. A transient HTTP failure must not turn
    // a connected call into a fake End; the server's separate lease is bounded.
    [self scheduleAfter:20 block:^{ [self heartbeat:generation]; }];
  }];
}
- (NSString *)apiOrigin { return [[NSBundle mainBundle] objectForInfoDictionaryKey:@"Phone11WakeOrigin"]; }
- (void)request:(NSString *)operation completion:(void (^)(NSDictionary *))completion {
  NSString *origin = [self apiOrigin];
  NSURLComponents *url = [NSURLComponents componentsWithString:origin ?: @""];
  if (![url.scheme isEqual:@"https"] || !url.host.length || url.user || url.password || url.query || url.fragment || (url.path.length && ![url.path isEqual:@"/"]) || !self.active || !self.enrollment) { completion(nil); return; }
  NSTimeInterval remaining = ([self.active[@"expiresAt"] doubleValue] - [self now]) / 1000;
  BOOL activeLifecycle = [operation isEqual:@"end"] || (self.connected && [operation isEqual:@"ready"]);
  if (remaining <= 0 && !activeLifecycle) { completion(nil); return; }
  if (!self.session) {
    NSURLSessionConfiguration *config = NSURLSessionConfiguration.ephemeralSessionConfiguration;
    config.HTTPCookieStorage = nil; config.URLCredentialStorage = nil; config.URLCache = nil;
    config.HTTPShouldSetCookies = NO; config.waitsForConnectivity = NO;
    config.timeoutIntervalForResource = 5; config.timeoutIntervalForRequest = 5;
    self.session = [NSURLSession sessionWithConfiguration:config delegate:self delegateQueue:nil];
  }
  url.path = [@"/api/phone11/wake/" stringByAppendingString:operation];
  NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url.URL];
  request.HTTPMethod = @"POST"; request.timeoutInterval = activeLifecycle ? 5 : MIN(5, MAX(.1, remaining));
  [request setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];
  [request setValue:[@"Wake " stringByAppendingString:self.enrollment[@"grant"]] forHTTPHeaderField:@"Authorization"];
  request.HTTPBody = [NSJSONSerialization dataWithJSONObject:@{@"callUUID":self.active[@"callUUID"], @"bindingId":self.active[@"bindingId"]} options:0 error:nil];
  NSUInteger generation = self.generation;
  __block NSURLSessionDataTask *task;
  task = [self.session dataTaskWithRequest:request completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
    dispatch_async(dispatch_get_main_queue(), ^{
      [self.tasks removeObject:task];
      if (![self isCurrent:generation]) return;
      NSInteger status = [(NSHTTPURLResponse *)response statusCode];
      if ([operation isEqual:@"claim"] || [operation isEqual:@"ready"]) [self recordStage:[operation stringByAppendingString:@"_http"] code:error ? -1 : status classification:error ? @"transport_error" : @"none"];
      if (!error && (status == 401 || status == 403)) { [self writeEnrollment:nil]; completion(@{@"authorizationRejected":@YES}); return; }
      NSDictionary *body = !error && status == 200 && data.length <= 32768 ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
      if (![body isKindOfClass:NSDictionary.class] || ![body[@"v"] isEqual:@1] || ![body[@"callUUID"] isEqual:self.active[@"callUUID"]] || ![body[@"bindingId"] isEqual:self.active[@"bindingId"]]) body = nil;
      completion(body);
    });
  }];
  [self.tasks addObject:task]; [task resume];
}
- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task willPerformHTTPRedirection:(NSHTTPURLResponse *)response newRequest:(NSURLRequest *)request completionHandler:(void (^)(NSURLRequest *))completion { completion(nil); }
- (void)acceptIfReady {
  if (!self.answer || !self.incoming || self.accepting || !self.active || self.connected) return;
  self.accepting = YES; NSUInteger generation = self.generation;
  [self recordStage:@"answer_accept" code:0 classification:@"none"];
  [Phone11Siprix answerIncomingWake:self.active[@"callUUID"] completion:^(NSError *error) {
    if ([self isCurrent:generation]) [self recordStage:@"answer_result" code:error ? 1 : 0 classification:error ? @"other" : @"none"];
    if ([self isCurrent:generation] && error) [self finish:CXCallEndedReasonFailed notifyServer:YES];
  }];
}
- (void)finish:(CXCallEndedReason)reason notifyServer:(BOOL)notify {
  if (!self.active) return;
  [self recordStage:@"finished" code:reason classification:@"none"];
  NSString *uuid = self.active[@"callUUID"];
  // An End can arrive after reporting but before the report-completion callback.
  // Resolve only the same device binding so that early rejection can cancel the
  // held server INVITE without waiting for the setup TTL.
  if (notify && !self.enrollment) {
    NSDictionary *saved = [self readEnrollment];
    if ([saved[@"bindingId"] isEqual:self.active[@"bindingId"]]) self.enrollment = saved;
  }
  // End closes only this binding/call lease. SIP teardown also runs locally;
  // server busy TTL remains a fallback when network cleanup is unavailable.
  if (notify) [self request:@"end" completion:^(NSDictionary *ignored) {}];
  self.active = nil; self.enrollment = nil; ++self.generation;
  [self.answer fail]; self.answer = nil;
  [Phone11Siprix endIncomingWake:uuid];
  [self.provider reportCallWithUUID:[[NSUUID alloc] initWithUUIDString:uuid] endedAtDate:NSDate.date reason:reason];
}
- (void)provider:(CXProvider *)provider performAnswerCallAction:(CXAnswerCallAction *)action {
  if (![self owns:action.callUUID]) { [(id<CXProviderDelegate>)self.callKeep provider:provider performAnswerCallAction:action]; return; }
  [self recordStage:@"answer_requested" code:0 classification:@"none"];
  if (self.connected) { [action fulfill]; return; }
  if (self.answer) { [action fail]; return; }
  NSError *error = nil;
  [[AVAudioSession sharedInstance] setCategory:AVAudioSessionCategoryPlayAndRecord mode:AVAudioSessionModeVoiceChat
      options:AVAudioSessionCategoryOptionAllowBluetooth error:&error];
  if (error) { [action fail]; [self finish:CXCallEndedReasonFailed notifyServer:YES]; return; }
  self.answer = action; [self acceptIfReady];
}
- (void)provider:(CXProvider *)provider performEndCallAction:(CXEndCallAction *)action {
  if (![self owns:action.callUUID]) { [(id<CXProviderDelegate>)self.callKeep provider:provider performEndCallAction:action]; return; }
  [self finish:CXCallEndedReasonRemoteEnded notifyServer:YES]; [action fulfill];
}
- (void)provider:(CXProvider *)provider timedOutPerformingAction:(CXAction *)action {
  if ([action isKindOfClass:CXCallAction.class] && [self owns:((CXCallAction *)action).callUUID]) { [action fail]; [self finish:CXCallEndedReasonFailed notifyServer:YES]; return; }
  if ([self.callKeep respondsToSelector:_cmd]) [(id<CXProviderDelegate>)self.callKeep provider:provider timedOutPerformingAction:action];
}
- (void)providerDidReset:(CXProvider *)provider {
  [self finish:CXCallEndedReasonFailed notifyServer:YES];
  [(id<CXProviderDelegate>)self.callKeep providerDidReset:provider];
}
- (void)provider:(CXProvider *)provider didActivateAudioSession:(AVAudioSession *)session {
  if (self.active) { self.wakeAudioActive = YES; [Phone11Siprix setIncomingWakeAudioSession:session active:YES]; }
  [(id<CXProviderDelegate>)self.callKeep provider:provider didActivateAudioSession:session];
}
- (void)provider:(CXProvider *)provider didDeactivateAudioSession:(AVAudioSession *)session {
  if (self.wakeAudioActive) { self.wakeAudioActive = NO; [Phone11Siprix setIncomingWakeAudioSession:session active:NO]; }
  [(id<CXProviderDelegate>)self.callKeep provider:provider didDeactivateAudioSession:session];
}
@end
