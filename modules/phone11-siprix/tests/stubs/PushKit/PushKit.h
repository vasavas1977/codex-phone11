#import <Foundation/Foundation.h>
typedef NSString *PKPushType;
extern PKPushType const PKPushTypeVoIP;
@class PKPushRegistry, PKPushCredentials, PKPushPayload;
@protocol PKPushRegistryDelegate <NSObject>
- (void)pushRegistry:(PKPushRegistry *)registry didUpdatePushCredentials:(PKPushCredentials *)credentials forType:(PKPushType)type;
- (void)pushRegistry:(PKPushRegistry *)registry didInvalidatePushTokenForType:(PKPushType)type;
- (void)pushRegistry:(PKPushRegistry *)registry didReceiveIncomingPushWithPayload:(PKPushPayload *)payload forType:(PKPushType)type withCompletionHandler:(void (^)(void))completion;
@end
@interface PKPushRegistry : NSObject
@property(nonatomic, weak) id<PKPushRegistryDelegate> delegate;
@property(nonatomic, copy) NSSet *desiredPushTypes;
- (instancetype)initWithQueue:(dispatch_queue_t)queue;
@end
@interface PKPushCredentials : NSObject
@property(nonatomic, strong) NSData *token;
@end
@interface PKPushPayload : NSObject
@property(nonatomic, strong) NSDictionary *dictionaryPayload;
@end
