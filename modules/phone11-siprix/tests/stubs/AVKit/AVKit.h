#import <UIKit/UIKit.h>

@class AVRoutePickerView;
@protocol AVRoutePickerViewDelegate <NSObject>
@optional
- (void)routePickerViewWillBeginPresentingRoutes:(AVRoutePickerView *)routePickerView;
- (void)routePickerViewDidEndPresentingRoutes:(AVRoutePickerView *)routePickerView;
@end

@interface AVRoutePickerView : UIView
@property(nonatomic, weak) id<AVRoutePickerViewDelegate> delegate;
@property(nonatomic) BOOL prioritizesVideoDevices;
@property(nonatomic, strong) UIColor *activeTintColor;
@end
