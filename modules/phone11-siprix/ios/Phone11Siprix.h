#import <React/RCTEventEmitter.h>

@class AVAudioSession;
@interface Phone11Siprix : RCTEventEmitter
+ (void)prepareIncomingWake:(NSDictionary *)context sip:(NSDictionary *)sip
                     event:(void (^)(NSDictionary *event))event completion:(void (^)(NSError *error))completion;
+ (void)answerIncomingWake:(NSString *)callUUID completion:(void (^)(NSError *error))completion;
+ (void)endIncomingWake:(NSString *)callUUID;
+ (void)setIncomingWakeAudioSession:(AVAudioSession *)session active:(BOOL)active;
@end
