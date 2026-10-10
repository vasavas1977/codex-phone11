import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { AuthBrand, AuthScreen, authStyles } from "@/components/auth/auth-screen";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useAuth } from "@/hooks/use-auth";
import {
  getSafePortalReturnTarget,
  passwordResetRequestRoute,
} from "@/constants/oauth";
import {
  authErrorMessage,
  getMobileAuthConfig,
  signInWithEmail,
  type MobileAuthConfig,
} from "@/lib/_core/api";

export default function SignInScreen() {
  const { user, logout } = useAuth();
  const { returnTo: requestedReturnTo } = useLocalSearchParams<{
    returnTo?: string | string[];
  }>();
  const returnTo = getSafePortalReturnTarget(requestedReturnTo);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<MobileAuthConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const passwordInput = useRef<TextInput>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  const configAttempt = useRef(0);

  const loadConfig = useCallback(async () => {
    const attempt = ++configAttempt.current;
    setConfigLoading(true);
    setError(null);
    try {
      const next = await getMobileAuthConfig();
      if (mounted.current && attempt === configAttempt.current) setConfig(next);
    } catch (failure) {
      if (mounted.current && attempt === configAttempt.current) {
        setConfig(null);
        setError(authErrorMessage(failure));
      }
    } finally {
      if (mounted.current && attempt === configAttempt.current)
        setConfigLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void loadConfig();
    return () => {
      mounted.current = false;
    };
  }, [loadConfig]);

  const close = () => {
    if (returnTo) {
      router.replace(returnTo);
      return;
    }
    if (requestedReturnTo !== undefined) {
      router.replace("/(tabs)/settings");
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/settings");
  };

  const submit = async () => {
    if (busy.current || configLoading || !config?.emailPasswordEnabled) return;
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      await signInWithEmail(email, password);
      if (mounted.current) close();
    } catch (failure) {
      if (mounted.current) setError(authErrorMessage(failure));
    } finally {
      busy.current = false;
      if (mounted.current) {
        setPassword("");
        setShowPassword(false);
        setPending(false);
      }
    }
  };

  const signOut = async () => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      await logout();
    } catch (failure) {
      if (mounted.current) setError(authErrorMessage(failure));
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  };

  const disabled = pending || configLoading || !config?.emailPasswordEnabled;
  return (
    <AuthScreen
      closeLabel="Close sign-in"
      closeDisabled={pending}
      onClose={close}
    >
      <AuthBrand title={user ? "Signed in" : "Sign in"} />
            {user ? (
              <>
                <Text style={authStyles.identity}>
                  {user.email || user.name || "Phone11 account"}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: pending, busy: pending }}
                  disabled={pending}
                  onPress={signOut}
                  style={[
                    authStyles.primaryButton,
                    authStyles.primaryButtonWithMargin,
                    pending && authStyles.disabled,
                  ]}
                >
                  {pending ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={authStyles.primaryButtonText}>Sign out</Text>
                  )}
                </Pressable>
              </>
            ) : (
              <>
                <Text style={authStyles.label}>Email</Text>
                <TextInput
                  accessibilityLabel="Email"
                  style={[authStyles.input, authStyles.inputWithMargin]}
                  value={email}
                  onChangeText={setEmail}
                  editable={!disabled}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  textContentType="username"
                  returnKeyType="next"
                  onSubmitEditing={() => passwordInput.current?.focus()}
                  placeholder="you@company.com"
                  placeholderTextColor="#94A3B8"
                  selectionColor="#007AFF"
                />
                <Text style={authStyles.label}>Password</Text>
                <View style={authStyles.passwordField}>
                  <TextInput
                    ref={passwordInput}
                    accessibilityLabel="Password"
                    style={authStyles.passwordInput}
                    value={password}
                    onChangeText={setPassword}
                    editable={!disabled}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="current-password"
                    textContentType="password"
                    returnKeyType="go"
                    onSubmitEditing={() => {
                      void submit();
                    }}
                    selectionColor="#007AFF"
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      showPassword ? "Hide password" : "Show password"
                    }
                    disabled={disabled}
                    onPress={() => setShowPassword((visible) => !visible)}
                    style={authStyles.iconButton}
                  >
                    <IconSymbol
                      name={showPassword ? "eye.slash" : "eye"}
                      size={22}
                      color="#64748B"
                    />
                  </Pressable>
                </View>
                {config?.passwordResetEnabled ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Forgot password"
                    disabled={pending}
                    onPress={() =>
                      router.push(passwordResetRequestRoute(returnTo) as any)
                    }
                    style={authStyles.textLink}
                  >
                    <Text style={authStyles.textLinkLabel}>
                      Forgot password?
                    </Text>
                  </Pressable>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Sign In"
                  accessibilityState={{
                    disabled,
                    busy: pending || configLoading,
                  }}
                  disabled={disabled}
                  onPress={submit}
                  style={[
                    authStyles.primaryButton,
                    authStyles.primaryButtonWithMargin,
                    disabled && authStyles.disabled,
                  ]}
                >
                  {pending || configLoading ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={authStyles.primaryButtonText}>Sign in</Text>
                  )}
                </Pressable>
                {configLoading && (
                  <Text
                    accessibilityLiveRegion="polite"
                    style={authStyles.status}
                  >
                    Checking sign-in availability...
                  </Text>
                )}
                {pending && (
                  <Text
                    accessibilityLiveRegion="polite"
                    style={authStyles.status}
                  >
                    Signing in...
                  </Text>
                )}
                {!configLoading &&
                  (!config || !config.emailPasswordEnabled) && (
                    <>
                      {config && (
                        <Text style={authStyles.status}>
                          Email sign-in is currently unavailable. Contact your
                          Phone11 administrator.
                        </Text>
                      )}
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => {
                          void loadConfig();
                        }}
                        style={authStyles.retry}
                      >
                        <IconSymbol
                          name="arrow.clockwise"
                          size={18}
                          color="#0066CC"
                        />
                        <Text style={authStyles.retryText}>Retry</Text>
                      </Pressable>
                    </>
                  )}
              </>
            )}
            {error && (
              <Text
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
                style={authStyles.error}
              >
                {error}
              </Text>
            )}
    </AuthScreen>
  );
}
