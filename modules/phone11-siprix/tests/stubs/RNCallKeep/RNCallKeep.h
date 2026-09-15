#import <CallKit/CallKit.h>
@interface RNCallKeep : NSObject
@property(nonatomic, strong) CXProvider *callKeepProvider;
+ (void)setup:(NSDictionary *)options;
+ (void)reportNewIncomingCall:(NSString *)uuid handle:(NSString *)handle handleType:(NSString *)type hasVideo:(BOOL)video localizedCallerName:(NSString *)name supportsHolding:(BOOL)holding supportsDTMF:(BOOL)dtmf supportsGrouping:(BOOL)grouping supportsUngrouping:(BOOL)ungrouping fromPushKit:(BOOL)push payload:(NSDictionary *)payload withCompletionHandler:(void (^)(void))completion;
+ (void)endCallWithUUID:(NSString *)uuid reason:(int)reason;
@end
