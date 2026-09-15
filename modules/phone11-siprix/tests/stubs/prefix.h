// Host-only compatibility declarations; production always uses real iOS headers.
#import <Foundation/Foundation.h>
#import <TargetConditionals.h>
#undef TARGET_OS_IPHONE
#define TARGET_OS_IPHONE 1
#undef TARGET_OS_OSX
#define TARGET_OS_OSX 0
