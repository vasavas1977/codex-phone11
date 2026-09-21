import { useEffect, useMemo, useState } from "react";
import { Platform, Text, View } from "react-native";
import { Image, type ImageSource } from "expo-image";
import { getApiBaseUrl } from "@/constants/oauth";
import { addAuthChangeListener, getAuthSnapshot, getSessionToken } from "@/lib/_core/auth";
import { useColors } from "@/hooks/use-colors";

const photoPath = /^\/api\/profile\/photo\/(\d+)\/(\d+)$/;
const version = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function profileInitials(name: string | null | undefined): string {
  const initials = (name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.slice(0, 1).toLocaleUpperCase())
    .join("");
  return initials || "P";
}

type VerifiedPhoto = { path: string; version: string };

/** Only server-generated, tenant-bound relative descriptor paths may reach an image loader. */
function verifiedPhoto(
  photoUrl: string | null | undefined,
  tenantId: number | null | undefined,
  userId: number | null | undefined,
  photoVersion: string | null | undefined,
): VerifiedPhoto | null {
  if (
    typeof photoUrl !== "string" ||
    !Number.isSafeInteger(tenantId) ||
    !Number.isSafeInteger(userId) ||
    (tenantId ?? 0) <= 0 ||
    (userId ?? 0) <= 0 ||
    !photoUrl.startsWith("/") ||
    photoUrl.startsWith("//")
  )
    return null;
  try {
    const parsed = new URL(photoUrl, "https://phone11.invalid");
    const match = photoPath.exec(parsed.pathname);
    const descriptorVersion = parsed.searchParams.get("v");
    if (
      !match ||
      Number(match[1]) !== tenantId ||
      Number(match[2]) !== userId ||
      !descriptorVersion ||
      !version.test(descriptorVersion) ||
      (photoVersion !== undefined && photoVersion !== null && photoVersion !== descriptorVersion)
    )
      return null;
    return { path: `${parsed.pathname}?v=${encodeURIComponent(descriptorVersion)}`, version: descriptorVersion };
  } catch {
    return null;
  }
}

function useAuthState() {
  const [auth, setAuth] = useState(getAuthSnapshot);
  useEffect(() => addAuthChangeListener(() => setAuth(getAuthSnapshot())), []);
  return auth;
}

function useProfilePhotoSource({
  photoUrl,
  photoVersion,
  tenantId,
  userId,
}: Pick<ProfileAvatarProps, "photoUrl" | "photoVersion" | "tenantId" | "userId">): ImageSource | null {
  const auth = useAuthState();
  const safePhoto = useMemo(
    () => verifiedPhoto(photoUrl, tenantId, userId, photoVersion),
    [photoUrl, photoVersion, tenantId, userId],
  );
  const [token, setToken] = useState<string | null | undefined>(() =>
    Platform.OS === "web" ? null : undefined,
  );
  const owner = auth.user;

  useEffect(() => {
    let active = true;
    setToken(undefined);
    if (!safePhoto || !owner || auth.loading) return () => { active = false; };
    if (Platform.OS === "web") {
      setToken(null);
      return () => { active = false; };
    }
    void getSessionToken()
      .then((value) => {
        if (active && getAuthSnapshot().user === owner) setToken(value);
      })
      .catch(() => {
        if (active) setToken(null);
      });
    return () => { active = false; };
  }, [auth.loading, owner, safePhoto]);

  if (!safePhoto || !owner || auth.loading || (Platform.OS !== "web" && !token)) return null;
  const base = getApiBaseUrl().replace(/\/$/, "");
  return {
    uri: `${base}${safePhoto.path}`,
    ...(Platform.OS === "web" ? {} : { headers: { Authorization: `Bearer ${token}` } }),
    // The descriptor is private and versioned. Keep source identity scoped even
    // though rendered images intentionally do not persist in the image cache.
    cacheKey: `profile-photo:${owner.id}:${tenantId}:${userId}:${safePhoto.version}`,
  };
}

export type ProfileAvatarProps = {
  name: string | null | undefined;
  photoUrl?: string | null;
  photoVersion?: string | null;
  tenantId?: number | null;
  userId?: number | null;
  size: number;
  rounded?: boolean;
  accessibilityLabel?: string;
  testID?: string;
};

/** Tenant-scoped avatar with a privacy-safe authenticated image source and initials fallback. */
export function ProfileAvatar(props: ProfileAvatarProps) {
  const colors = useColors();
  const source = useProfilePhotoSource(props);
  const [failed, setFailed] = useState(false);
  const displayName = props.name?.trim() || "Profile";
  const radius = props.rounded ? Math.round(props.size * 0.3) : props.size / 2;
  useEffect(() => setFailed(false), [source?.cacheKey]);
  const hasPhoto = !!source && !failed;

  return (
    <View
      testID={props.testID}
      accessibilityLabel={props.accessibilityLabel ?? (hasPhoto ? `${displayName} profile photo` : `${displayName} initials`)}
      style={{
        width: props.size,
        height: props.size,
        borderRadius: radius,
        overflow: "hidden",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.primary + "1F",
      }}
    >
      {hasPhoto ? (
        <Image
          source={source}
          cachePolicy="none"
          recyclingKey={source.cacheKey}
          contentFit="cover"
          onError={() => setFailed(true)}
          style={{ width: props.size, height: props.size, borderRadius: radius }}
        />
      ) : (
        <Text style={{ color: colors.foreground, fontSize: Math.max(11, Math.round(props.size * 0.36)), fontWeight: "700" }}>
          {profileInitials(props.name)}
        </Text>
      )}
    </View>
  );
}

/** Remove all cached protected photos when the account changes. */
let lastOwnerId = getAuthSnapshot().user?.id ?? null;
addAuthChangeListener(() => {
  const nextOwnerId = getAuthSnapshot().user?.id ?? null;
  if (nextOwnerId === lastOwnerId) return;
  lastOwnerId = nextOwnerId;
  void Promise.allSettled([Image.clearMemoryCache(), Image.clearDiskCache()]);
});

/** A screen calls this with its active workspace so switching workspaces drops private image cache. */
export function useProfilePhotoCacheScope(tenantId: number | null | undefined) {
  const auth = useAuthState();
  const scope = auth.user && Number.isSafeInteger(tenantId) && (tenantId ?? 0) > 0
    ? `${auth.user.id}:${tenantId}`
    : null;
  const [previous, setPrevious] = useState(scope);
  useEffect(() => {
    if (previous !== scope) {
      setPrevious(scope);
      void Promise.allSettled([Image.clearMemoryCache(), Image.clearDiskCache()]);
    }
  }, [previous, scope]);
}
