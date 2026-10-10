#import <Foundation/Foundation.h>
typedef void (^RCTPromiseResolveBlock)(id result);
typedef void (^RCTPromiseRejectBlock)(NSString *code, NSString *message, NSError *error);
#define RCT_EXPORT_MODULE(name)
#define RCT_EXPORT_METHOD(method) - (void)method
@interface RCTEventEmitter : NSObject
@property(nonatomic, strong) NSMutableArray<NSDictionary *> *testEvents;
- (void)sendEventWithName:(NSString *)name body:(id)body;
- (void)invalidate;
@end
