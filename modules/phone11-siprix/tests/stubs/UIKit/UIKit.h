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
- (void)didMoveToWindow;
- (void)layoutSubviews;
- (void)addSubview:(UIView *)view;
- (void)removeFromSuperview;
@property(nonatomic) CGRect frame;
@property(nonatomic) CGRect bounds;
@property(nonatomic, weak) UIView *window;
@property(nonatomic, strong) UIColor *tintColor;
@end

@interface UIApplication : NSObject
@end
typedef NSString *UIApplicationOpenURLOptionsKey;
