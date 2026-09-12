#import <React/RCTEventEmitter.h>

@class AVAudioSession;
@interface Phone11Siprix : RCTEventEmitter
+ (void)prepareIncomingWake:(NSDictionary *)context sip:(NSDictionary *)sip
                     event:(void (^)(NSDictionary *event))event completion:(void (^)(NSError *error))completion;
+ (void)prepareIncomingWake:(NSDictionary *)context sip:(NSDictionary *)sip receivedAt:(NSTimeInterval)receivedAt
                     event:(void (^)(NSDictionary *event))event completion:(void (^)(NSError *error))completion;
+ (void)answerIncomingWake:(NSString *)callUUID completion:(void (^)(NSError *error))completion;
+ (void)completedWakeBindingDidChange;
+ (void)clearCompletedWakeCalls;
+ (void)endIncomingWake:(NSString *)callUUID;
+ (void)setIncomingWakeAudioSession:(AVAudioSession *)session active:(BOOL)active;
@end
