#import <Foundation/Foundation.h>
extern NSString *const AVAudioSessionPortBuiltInSpeaker;
extern NSString *const AVAudioSessionPortBuiltInReceiver;
extern NSString *const AVAudioSessionPortHeadphones;
extern NSString *const AVAudioSessionPortHeadsetMic;
extern NSString *const AVAudioSessionPortBluetoothA2DP;
extern NSString *const AVAudioSessionPortBluetoothHFP;
extern NSString *const AVAudioSessionPortBluetoothLE;
extern NSString *const AVAudioSessionPortAirPlay;
extern NSString *const AVAudioSessionPortUSBAudio;
extern NSString *const AVAudioSessionPortHDMI;
extern NSString *const AVAudioSessionCategoryPlayAndRecord;
extern NSString *const AVAudioSessionCategoryPlayback;
extern NSString *const AVAudioSessionModeVoiceChat;
extern NSString *const AVAudioSessionModeDefault;
extern NSString *const AVAudioSessionModeSpokenAudio;
extern NSString *const AVAudioSessionRouteChangeNotification;
typedef NS_OPTIONS(NSUInteger, AVAudioSessionCategoryOptions) {
  AVAudioSessionCategoryOptionAllowBluetooth = 4,
  AVAudioSessionCategoryOptionAllowBluetoothA2DP = 32,
};
typedef NS_ENUM(NSUInteger, AVAudioSessionPortOverride) { AVAudioSessionPortOverrideNone = 0, AVAudioSessionPortOverrideSpeaker = 1 };
@interface AVAudioSessionPortDescription : NSObject
@property(nonatomic, copy) NSString *portType;
@end
@interface AVAudioSessionRouteDescription : NSObject
@property(nonatomic, strong) NSArray<AVAudioSessionPortDescription *> *outputs;
@end
@interface AVAudioSession : NSObject
+ (instancetype)sharedInstance;
- (BOOL)setCategory:(NSString *)category mode:(NSString *)mode options:(AVAudioSessionCategoryOptions)options error:(NSError **)error;
- (BOOL)overrideOutputAudioPort:(AVAudioSessionPortOverride)portOverride error:(NSError **)error;
- (BOOL)setActive:(BOOL)active error:(NSError **)error;
@property(nonatomic, strong) AVAudioSessionRouteDescription *currentRoute;
@property(nonatomic, copy, readonly) NSString *category;
@property(nonatomic, copy, readonly) NSString *mode;
@property(nonatomic, readonly) AVAudioSessionCategoryOptions categoryOptions;
@end

extern NSString *const AVMediaTypeVideo;
typedef NS_ENUM(NSInteger, AVAuthorizationStatus) { AVAuthorizationStatusNotDetermined, AVAuthorizationStatusRestricted, AVAuthorizationStatusDenied, AVAuthorizationStatusAuthorized };
@interface AVCaptureDevice : NSObject
+ (AVAuthorizationStatus)authorizationStatusForMediaType:(NSString *)type;
+ (void)requestAccessForMediaType:(NSString *)type completionHandler:(void (^)(BOOL granted))handler;
@end
