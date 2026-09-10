#import <Foundation/Foundation.h>
typedef NS_ENUM(NSInteger, CXHandleType) { CXHandleTypeGeneric = 1 };
typedef NS_ENUM(NSInteger, CXCallEndedReason) { CXCallEndedReasonFailed = 1 };
@interface CXHandle : NSObject
@property(nonatomic, copy) NSString *value;
- (instancetype)initWithType:(CXHandleType)type value:(NSString *)value;
@end
@interface CXCallUpdate : NSObject
@property(nonatomic, strong) CXHandle *remoteHandle;
@property(nonatomic, copy) NSString *localizedCallerName;
@property(nonatomic) BOOL hasVideo, supportsHolding, supportsDTMF, supportsGrouping, supportsUngrouping;
@end
@interface CXProvider : NSObject
- (void)reportNewIncomingCallWithUUID:(NSUUID *)uuid update:(CXCallUpdate *)update completion:(void (^)(NSError *error))completion;
- (void)reportCallWithUUID:(NSUUID *)uuid endedAtDate:(NSDate *)date reason:(CXCallEndedReason)reason;
@end

@protocol CXProviderDelegate <NSObject>
@end
@interface CXCallController : NSObject
@end
