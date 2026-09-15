#import <Foundation/Foundation.h>
extern NSString *const AVAudioSessionPortBuiltInSpeaker;
extern NSString *const AVAudioSessionCategoryPlayAndRecord;
extern NSString *const AVAudioSessionModeVoiceChat;
extern NSString *const AVAudioSessionCategoryPlayback;
extern NSString *const AVAudioSessionModeDefault;
typedef NS_ENUM(NSUInteger, AVAudioSessionPortOverride) { AVAudioSessionPortOverrideNone = 0, AVAudioSessionPortOverrideSpeaker = 1 };
typedef NS_OPTIONS(NSUInteger, AVAudioSessionCategoryOptions) { AVAudioSessionCategoryOptionAllowBluetooth = 4 };
@interface AVAudioSessionPortDescription : NSObject
@property(nonatomic, copy) NSString *portType;
@end
@interface AVAudioSessionRouteDescription : NSObject
@property(nonatomic, strong) NSArray<AVAudioSessionPortDescription *> *outputs;
@end
@interface AVAudioSession : NSObject
+ (instancetype)sharedInstance;
- (BOOL)setCategory:(NSString *)category mode:(NSString *)mode options:(AVAudioSessionCategoryOptions)options error:(NSError **)error;
- (BOOL)overrideOutputAudioPort:(AVAudioSessionPortOverride)port error:(NSError **)error;
@property(nonatomic, strong) AVAudioSessionRouteDescription *currentRoute;
@end
