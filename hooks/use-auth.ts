import * as Api from "@/lib/_core/api";
import * as Auth from "@/lib/_core/auth";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";

type UseAuthOptions = {
  autoFetch?: boolean;
};

function userFromApi(apiUser: {
  id: number;
  openId: string;
  name: string | null;
  email: string | null;
  loginMethod: string | null;
  lastSignedIn: string;
}): Auth.User {
  return {
    id: apiUser.id,
    openId: apiUser.openId,
    name: apiUser.name,
    email: apiUser.email,
    loginMethod: apiUser.loginMethod,
    lastSignedIn: new Date(apiUser.lastSignedIn),
  };
}

export function useAuth(options?: UseAuthOptions) {
  const { autoFetch = true } = options ?? {};
  const [user, setUser] = useState<Auth.User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchUser = useCallback(async () => {
    console.log("[useAuth] fetchUser called");
    try {
      setLoading(true);
      setError(null);

      // Web platform: use cookie-based auth, fetch user from API
      if (Platform.OS === "web") {
        console.log("[useAuth] Web platform: fetching user from API...");
        const apiUser = await Api.getMe();
        console.log("[useAuth] API user response:", apiUser);

        if (apiUser) {
          const userInfo = userFromApi(apiUser);
          setUser(userInfo);
          // Cache user info in localStorage for faster subsequent loads
          await Auth.setUserInfo(userInfo);
          console.log("[useAuth] Web user set from API:", userInfo);
        } else {
          console.log("[useAuth] Web: No authenticated user from API");
          setUser(null);
          await Auth.clearUserInfo();
        }
        return;
      }

      // Native platform: session token is the source of truth. Cached user info
      // alone is not enough, because tRPC provisioning calls require the Bearer token.
      console.log("[useAuth] Native platform: checking for session token...");
      const sessionToken = await Auth.getSessionToken();
      console.log(
        "[useAuth] Session token:",
        sessionToken ? `present (${sessionToken.substring(0, 20)}...)` : "missing",
      );
      if (!sessionToken) {
        console.log("[useAuth] No session token, clearing cached user and setting user to null");
        setUser(null);
        await Auth.clearUserInfo();
        return;
      }

      // Validate the token against the backend and refresh cached user info.
      const apiUser = await Api.getMe();
      console.log("[useAuth] Native /api/auth/me response:", apiUser);
      if (apiUser) {
        const userInfo = userFromApi(apiUser);
        setUser(userInfo);
        await Auth.setUserInfo(userInfo);
        console.log("[useAuth] Native user set from validated backend session");
        return;
      }

      console.log("[useAuth] Session token was present but backend rejected it; clearing auth state");
      setUser(null);
      await Auth.removeSessionToken();
      await Auth.clearUserInfo();
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Failed to fetch user");
      console.error("[useAuth] fetchUser error:", error);
      setError(error);
      setUser(null);
    } finally {
      setLoading(false);
      console.log("[useAuth] fetchUser completed, loading:", false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await Api.logout();
    } catch (err) {
      console.error("[Auth] Logout API call failed:", err);
      // Continue with logout even if API call fails
    } finally {
      await Auth.removeSessionToken();
      await Auth.clearUserInfo();
      setUser(null);
      setError(null);
    }
  }, []);

  const isAuthenticated = useMemo(() => Boolean(user), [user]);

  useEffect(() => {
    console.log("[useAuth] useEffect triggered, autoFetch:", autoFetch, "platform:", Platform.OS);
    if (!autoFetch) {
      console.log("[useAuth] autoFetch disabled, setting loading to false");
      setLoading(false);
      return;
    }

    const unsubscribe =
      Platform.OS === "web"
        ? undefined
        : Auth.addAuthChangeListener(() => {
            console.log("[useAuth] Auth storage changed, refreshing user...");
            fetchUser();
          });

    if (Platform.OS === "web") {
      // Web: fetch user from API directly (user will login manually if needed)
      console.log("[useAuth] Web: fetching user from API...");
      fetchUser();
    } else {
      // Native: never trust cached profile alone. A stale cached profile can make
      // the UI say Signed In while tRPC requests have no Authorization header.
      Promise.all([Auth.getSessionToken(), Auth.getUserInfo()]).then(([sessionToken, cachedUser]) => {
        console.log("[useAuth] Native cached user/token check:", {
          hasSessionToken: !!sessionToken,
          hasCachedUser: !!cachedUser,
        });

        if (sessionToken && cachedUser) {
          console.log("[useAuth] Native: showing cached user while backend session validates");
          setUser(cachedUser);
        } else if (!sessionToken && cachedUser) {
          console.log("[useAuth] Native: cached user exists without token, clearing cached user");
          Auth.clearUserInfo().catch(console.error);
        }

        fetchUser();
      });
    }

    return unsubscribe;
  }, [autoFetch, fetchUser]);

  useEffect(() => {
    console.log("[useAuth] State updated:", {
      hasUser: !!user,
      loading,
      isAuthenticated,
      error: error?.message,
    });
  }, [user, loading, isAuthenticated, error]);

  return {
    user,
    loading,
    error,
    isAuthenticated,
    refresh: fetchUser,
    logout,
  };
}
