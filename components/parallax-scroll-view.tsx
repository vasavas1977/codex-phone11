import { useRef, type PropsWithChildren, type ReactElement } from "react";
import { Animated, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/use-colors";

const HEADER_HEIGHT = 250;

type Props = PropsWithChildren<{
  headerImage: ReactElement;
  headerBackgroundColor?: string;
}>;

/**
 * A scroll view with a lightweight parallax header effect.
 */
export default function ParallaxScrollView({
  children,
  headerImage,
  headerBackgroundColor,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const scrollY = useRef(new Animated.Value(0)).current;

  const headerHeight = HEADER_HEIGHT + insets.top;
  const headerAnimatedStyle = {
    transform: [
      {
        translateY: scrollY.interpolate({
          inputRange: [-headerHeight, 0, headerHeight],
          outputRange: [-headerHeight / 2, 0, headerHeight * 0.75],
          extrapolate: "clamp",
        }),
      },
      {
        scale: scrollY.interpolate({
          inputRange: [-headerHeight, 0, headerHeight],
          outputRange: [2, 1, 1],
          extrapolate: "clamp",
        }),
      },
    ],
  };

  return (
    <Animated.ScrollView
      style={{ backgroundColor: colors.background, flex: 1 }}
      contentContainerStyle={{
        paddingBottom: insets.bottom,
        paddingLeft: insets.left,
        paddingRight: insets.right,
      }}
      onScroll={Animated.event(
        [{ nativeEvent: { contentOffset: { y: scrollY } } }],
        { useNativeDriver: true },
      )}
      scrollEventThrottle={16}
    >
      <Animated.View
        style={[
          {
            overflow: "hidden",
            backgroundColor: headerBackgroundColor ?? colors.primary,
            height: headerHeight,
            paddingTop: insets.top,
          },
          headerAnimatedStyle,
        ]}
      >
        {headerImage}
      </Animated.View>
      <View className="flex-1 p-8 gap-4 overflow-hidden bg-background">
        {children}
      </View>
    </Animated.ScrollView>
  );
}
