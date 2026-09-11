#import <Foundation/Foundation.h>
#import <AVFoundation/AVFoundation.h>
typedef NS_ENUM(NSInteger, CXHandleType) { CXHandleTypeGeneric = 1 };
typedef NS_ENUM(NSInteger, CXCallEndedReason) { CXCallEndedReasonFailed = 1, CXCallEndedReasonRemoteEnded = 2, CXCallEndedReasonUnanswered = 3 };
@interface CXHandle : NSObject
@property(nonatomic, copy) NSString *value;
- (instancetype)initWithType:(CXHandleType)type value:(NSString *)value;
@end
@interface CXCallUpdate : NSObject
@property(nonatomic, strong) CXHandle *remoteHandle;
@property(nonatomic, copy) NSString *localizedCallerName;
@property(nonatomic) BOOL hasVideo, supportsHolding, supportsDTMF, supportsGrouping, supportsUngrouping;
@end
@interface CXAction : NSObject
@property(nonatomic) BOOL testFulfilled, testFailed;
- (void)fulfill;
- (void)fail;
@end
@interface CXCallAction : CXAction
@property(nonatomic, strong) NSUUID *callUUID;
@end
@interface CXAnswerCallAction : CXCallAction
@end
@interface CXEndCallAction : CXCallAction
@end
@class CXProvider;
@protocol CXProviderDelegate <NSObject>
- (void)providerDidReset:(CXProvider *)provider;
@optional
- (void)provider:(CXProvider *)provider performAnswerCallAction:(CXAnswerCallAction *)action;
- (void)provider:(CXProvider *)provider performEndCallAction:(CXEndCallAction *)action;
- (void)provider:(CXProvider *)provider timedOutPerformingAction:(CXAction *)action;
- (void)provider:(CXProvider *)provider didActivateAudioSession:(AVAudioSession *)session;
- (void)provider:(CXProvider *)provider didDeactivateAudioSession:(AVAudioSession *)session;
@end
@interface CXProvider : NSObject
- (void)setDelegate:(id<CXProviderDelegate>)delegate queue:(dispatch_queue_t)queue;
- (void)reportNewIncomingCallWithUUID:(NSUUID *)uuid update:(CXCallUpdate *)update completion:(void (^)(NSError *error))completion;
- (void)reportCallWithUUID:(NSUUID *)uuid endedAtDate:(NSDate *)date reason:(CXCallEndedReason)reason;
@end
@interface CXCallController : NSObject
@end
