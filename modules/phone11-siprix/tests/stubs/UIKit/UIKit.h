#import <Foundation/Foundation.h>
typedef NS_ENUM(NSInteger, UIEventType) { UIEventTypeTouches = 0 };
@interface UIEvent : NSObject
@property(nonatomic) UIEventType type;
@end
@interface UIColor : NSObject
+ (instancetype)clearColor;
@end
@interface UIView : NSObject
- (instancetype)initWithFrame:(CGRect)frame;
- (UIView *)hitTest:(CGPoint)point withEvent:(UIEvent *)event;
- (BOOL)accessibilityActivate;
@property(nonatomic, strong) UIColor *tintColor;
@end

@interface UIApplication : NSObject
@end
typedef NSString *UIApplicationOpenURLOptionsKey;
