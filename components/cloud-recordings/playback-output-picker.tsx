import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import type { ComponentProps, ComponentType } from "react";
import { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  ScrollView,
  Text,
  TouchableOpacity,
  UIManager,
  View,
  requireNativeComponent,
  type NativeSyntheticEvent,
  type ViewProps,
} from "react-native";
import type {
  PlaybackAudioRoute,
  PlaybackAudioRouteStatus,
} from "@/lib/cloud-recordings/playback-route";
import type { PlaybackControlColors } from "./playback-controls";

const nativePickerName = "Phone11AudioRoutePickerView";

export interface PlaybackExternalOutput {
  /** Stable identifier supplied by a real platform route inventory. */
  id: string;
  label: string;
  selected?: boolean;
  icon?: Extract<
    ComponentProps<typeof MaterialIcons>["name"],
    "airplay" | "bluetooth-audio" | "headphones"
  >;
}

interface NativeRoutePickerProps extends ViewProps {
  disabled?: boolean;
  onPickerOpened?: (
    event: NativeSyntheticEvent<PlaybackAudioRouteStatus>,
  ) => void;
}

let cachedNativePicker:
  | ComponentType<NativeRoutePickerProps>
  | null
  | undefined;

function nativePickerComponent(): ComponentType<NativeRoutePickerProps> | null {
  if (cachedNativePicker !== undefined) return cachedNativePicker;
  if (
    Platform.OS !== "ios" ||
    !UIManager?.getViewManagerConfig?.(nativePickerName)
  )
    return (cachedNativePicker = null);
  return (cachedNativePicker =
    requireNativeComponent<NativeRoutePickerProps>(nativePickerName));
}

function OutputRow({
  label,
  description,
  icon,
  selected,
  disabled,
  busy,
  onPress,
  colors,
}: {
  label: string;
  description?: string;
  icon: ComponentProps<typeof MaterialIcons>["name"];
  selected: boolean;
  disabled?: boolean;
  busy?: boolean;
  onPress?(): void;
  colors: PlaybackControlColors;
}) {
  return (
    <TouchableOpacity
      accessibilityRole="menuitem"
      accessibilityLabel={label}
      accessibilityHint={description}
      accessibilityState={{ selected, disabled: disabled || busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={{
        minHeight: 58,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <View
        style={{
          width: 38,
          height: 38,
          borderRadius: 19,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: selected ? colors.primary : colors.surface,
        }}
      >
        <MaterialIcons
          name={icon}
          size={21}
          color={selected ? "#FFFFFF" : colors.foreground}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={{ color: colors.foreground, fontSize: 16, fontWeight: "500" }}
        >
          {label}
        </Text>
        {description ? (
          <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
            {description}
          </Text>
        ) : null}
      </View>
      {busy ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : selected ? (
        <MaterialIcons name="check" size={22} color={colors.primary} />
      ) : null}
    </TouchableOpacity>
  );
}

export function PlaybackOutputPickerSheet({
  visible,
  output,
  routeChanging = false,
  availableOutputs = [],
  onRouteChange,
  onOutputSelect,
  onClose,
  colors,
}: {
  visible: boolean;
  output: PlaybackAudioRouteStatus;
  routeChanging?: boolean;
  availableOutputs?: readonly PlaybackExternalOutput[];
  onRouteChange(route: PlaybackAudioRoute): void | Promise<void>;
  onOutputSelect?(output: PlaybackExternalOutput): void | Promise<void>;
  onClose(): void;
  colors: PlaybackControlColors;
}) {
  const selectBuiltIn = (route: "earpiece" | "speaker") => {
    onClose();
    void Promise.resolve(onRouteChange(route)).catch(() => undefined);
  };
  const selectExternal = (externalOutput: PlaybackExternalOutput) => {
    if (!onOutputSelect) return;
    onClose();
    void Promise.resolve(onOutputSelect(externalOutput)).catch(() => undefined);
  };
  const deviceLabel = Platform.OS === "ios" ? "iPhone" : "Phone";

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      presentationStyle="overFullScreen"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View
        style={{
          flex: 1,
          justifyContent: "flex-end",
          backgroundColor: "rgba(13, 20, 28, 0.44)",
        }}
      >
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Close audio output picker"
          activeOpacity={1}
          onPress={onClose}
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
          }}
        />
        <View
          accessibilityViewIsModal
          accessibilityRole="menu"
          accessibilityLabel="Audio output"
          style={{
            maxHeight: "64%",
            backgroundColor: colors.background,
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            paddingTop: 10,
            paddingBottom: 20,
            paddingHorizontal: 20,
            gap: 6,
          }}
        >
          <View
            importantForAccessibility="no-hide-descendants"
            style={{
              width: 36,
              height: 4,
              borderRadius: 2,
              backgroundColor: colors.border,
              alignSelf: "center",
              marginBottom: 2,
            }}
          />
          <View
            style={{
              minHeight: 48,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Text
              style={{
                color: colors.foreground,
                fontWeight: "700",
                fontSize: 17,
              }}
            >
              Audio output
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Close audio output picker"
              onPress={onClose}
              style={{
                minHeight: 44,
                minWidth: 44,
                alignItems: "flex-end",
                justifyContent: "center",
              }}
            >
              <Text style={{ color: colors.primary, fontSize: 15 }}>Done</Text>
            </TouchableOpacity>
          </View>
          <ScrollView
            bounces={false}
            showsVerticalScrollIndicator={false}
            style={{ flexGrow: 0 }}
          >
            <OutputRow
              label={deviceLabel}
              description="Private listening"
              icon="phone-iphone"
              selected={output.route === "earpiece"}
              busy={routeChanging}
              onPress={() => selectBuiltIn("earpiece")}
              colors={colors}
            />
            <OutputRow
              label="Speaker"
              description="Play aloud"
              icon="volume-up"
              selected={output.route === "speaker"}
              busy={routeChanging}
              onPress={() => selectBuiltIn("speaker")}
              colors={colors}
            />
            {availableOutputs.map((item) => {
              const selected =
                item.selected === true ||
                (output.route === "external" && output.label === item.label);
              return (
                <OutputRow
                  key={item.id}
                  label={item.label}
                  description={
                    selected
                      ? "Connected"
                      : "Choose from your system audio controls"
                  }
                  icon={item.icon ?? "headphones"}
                  selected={selected}
                  disabled={!onOutputSelect}
                  busy={routeChanging}
                  onPress={() => selectExternal(item)}
                  colors={colors}
                />
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function PlaybackOutputPickerButton({
  loaded,
  output,
  routeChanging = false,
  availableOutputs,
  onRouteChange,
  onOutputSelect,
  onOutputPickerOpened,
  colors,
}: {
  loaded: boolean;
  output: PlaybackAudioRouteStatus;
  routeChanging?: boolean;
  availableOutputs?: readonly PlaybackExternalOutput[];
  onRouteChange(route: PlaybackAudioRoute): void | Promise<void>;
  onOutputSelect?(output: PlaybackExternalOutput): void | Promise<void>;
  onOutputPickerOpened?(output: PlaybackAudioRouteStatus): void | Promise<void>;
  colors: PlaybackControlColors;
}) {
  const [fallbackVisible, setFallbackVisible] = useState(false);
  const NativeRoutePicker = nativePickerComponent();
  const disabled = !loaded || routeChanging;
  const speakerSelected = output.route === "speaker";

  return (
    <>
      <View style={{ position: "relative" }}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Choose audio output"
          accessibilityHint="Shows available audio outputs"
          accessibilityState={{
            selected: speakerSelected,
            disabled,
            busy: routeChanging,
          }}
          accessible={!NativeRoutePicker}
          disabled={disabled || Boolean(NativeRoutePicker)}
          onPress={() => setFallbackVisible(true)}
          style={{
            height: 44,
            minWidth: 104,
            paddingHorizontal: 10,
            borderRadius: 22,
            borderWidth: 1,
            borderColor: speakerSelected ? colors.primary : colors.border,
            flexDirection: "row",
            gap: 6,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: speakerSelected ? colors.primary : colors.surface,
          }}
        >
          <MaterialIcons
            name="volume-up"
            size={19}
            color={speakerSelected ? "#FFFFFF" : colors.foreground}
          />
          <Text
            style={{
              color: speakerSelected ? "#FFFFFF" : colors.foreground,
              fontWeight: "600",
            }}
          >
            {routeChanging ? "Changing…" : "Speaker"}
          </Text>
        </TouchableOpacity>
        {NativeRoutePicker ? (
          <NativeRoutePicker
            accessible
            accessibilityRole="button"
            accessibilityLabel="Choose audio output"
            accessibilityHint="Opens the iPhone audio output picker"
            disabled={disabled}
            onPickerOpened={(event) => {
              void Promise.resolve(
                onOutputPickerOpened?.(event.nativeEvent),
              ).catch(() => undefined);
            }}
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
            }}
          />
        ) : null}
      </View>
      {!NativeRoutePicker ? (
        <PlaybackOutputPickerSheet
          visible={fallbackVisible}
          output={output}
          routeChanging={routeChanging}
          availableOutputs={availableOutputs}
          onRouteChange={onRouteChange}
          onOutputSelect={onOutputSelect}
          onClose={() => setFallbackVisible(false)}
          colors={colors}
        />
      ) : null}
    </>
  );
}
