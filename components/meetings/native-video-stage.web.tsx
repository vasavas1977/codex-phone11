import { Text, View } from 'react-native';
import type { ComponentProps } from 'react';
import type { NativeVideoStage as NativeStage } from './native-video-stage';
/** Expo Router evaluates every route on web; never load the native WebRTC view there. */
export function NativeVideoStage(_props: ComponentProps<typeof NativeStage>) {
  return <View accessibilityRole="text"><Text>Open this meeting in the Phone11 mobile app to view native video.</Text></View>;
}
