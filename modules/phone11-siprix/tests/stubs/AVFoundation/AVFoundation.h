#import <Foundation/Foundation.h>
extern NSString *const AVAudioSessionPortBuiltInSpeaker;
@interface AVAudioSessionPortDescription : NSObject
@property(nonatomic, copy) NSString *portType;
@end
@interface AVAudioSessionRouteDescription : NSObject
@property(nonatomic, strong) NSArray<AVAudioSessionPortDescription *> *outputs;
@end
@interface AVAudioSession : NSObject
+ (instancetype)sharedInstance;
@property(nonatomic, strong) AVAudioSessionRouteDescription *currentRoute;
@end
