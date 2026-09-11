#import <Foundation/Foundation.h>
#import <CallKit/CallKit.h>
#import <AVFoundation/AVFoundation.h>

#ifndef PHONE11_VOIP_WAKE_COMMISSIONED
#define PHONE11_VOIP_WAKE_COMMISSIONED 0
#endif

/** Owns only incoming wake calls on RNCallKeep's existing provider. All methods
 * run on the main queue. Grant material never appears in events or snapshots. */
@interface Phone11WakeCoordinator : NSObject <CXProviderDelegate, NSURLSessionTaskDelegate>
+ (instancetype)shared;
+ (void)restoreCallKitDelegate;
- (BOOL)saveEnrollment:(NSDictionary *)enrollment;
- (NSDictionary *)publicBinding;
- (void)clearEnrollment;
- (void)receivePayload:(NSDictionary *)payload completion:(void (^)(void))completion;
@end
