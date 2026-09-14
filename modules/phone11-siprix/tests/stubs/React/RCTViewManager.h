#import <UIKit/UIKit.h>

typedef void (^RCTDirectEventBlock)(NSDictionary *event);
#define RCT_EXPORT_VIEW_PROPERTY(name, type)

@interface RCTViewManager : NSObject
- (UIView *)view;
@end
