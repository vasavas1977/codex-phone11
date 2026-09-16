import { Text, View } from "react-native";

import { useColors } from "@/hooks/use-colors";
import {
  phoneTodayKindLabel,
  selectPhoneTodayItems,
  type PhoneTodayItem,
} from "@/lib/calendar/phone-today";

function itemTime(startsAt: string): string {
  return new Date(startsAt).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function PhoneTodayView({
  items,
  now,
}: {
  /** Items supplied by the authenticated Super Number calendar adapter. */
  items: readonly PhoneTodayItem[];
  now?: Date;
}) {
  const colors = useColors();
  const today = selectPhoneTodayItems(items, now);

  if (today.length === 0) {
    return (
      <View
        accessibilityLabel="No scheduled phone activity today"
        style={{ paddingVertical: 28, gap: 8 }}
      >
        <Text style={{ color: colors.foreground, fontSize: 17, fontWeight: "600" }}>
          Nothing scheduled today
        </Text>
        <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 20 }}>
          Scheduled calls, callbacks and meetings from your work calendar will appear here.
        </Text>
      </View>
    );
  }

  return (
    <View accessibilityLabel="Today’s phone schedule" style={{ gap: 10 }}>
      {today.map((item) => (
        <View
          key={item.id}
          style={{
            padding: 16,
            borderRadius: 14,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
            gap: 4,
          }}
        >
          <Text style={{ color: colors.primary, fontSize: 13, fontWeight: "700" }}>
            {item.status === "in_progress" ? "In progress" : phoneTodayKindLabel(item.kind)} · {itemTime(item.startsAt)}
          </Text>
          <Text style={{ color: colors.foreground, fontSize: 17, fontWeight: "600" }}>
            {item.title}
          </Text>
          {item.counterpart ? (
            <Text style={{ color: colors.muted, fontSize: 14 }}>{item.counterpart}</Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}
