import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useAuth } from "@/hooks/use-auth";
import {
  authErrorMessage,
  getMobileAuthConfig,
  signInWithEmail,
  type MobileAuthConfig,
} from "@/lib/_core/api";

export default function SignInScreen() {
  const { user, logout } = useAuth();
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
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.toolbar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close sign-in"
            disabled={pending}
            onPress={close}
            style={styles.iconButton}
          >
            <IconSymbol name="xmark" size={24} color="#B8BDC8" />
          </Pressable>
        </View>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <View style={styles.form}>
            <IconSymbol name="phone.fill" size={36} color="#00E5A8" />
            <Text style={styles.brand}>Phone11</Text>
            <Text style={styles.heading}>{user ? "Signed In" : "Sign In"}</Text>
            {user ? (
              <>
                <Text style={styles.identity}>
                  {user.email || user.name || "Phone11 account"}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: pending, busy: pending }}
                  disabled={pending}
                  onPress={signOut}
                  style={[styles.button, pending && styles.disabled]}
                >
                  {pending ? (
                    <ActivityIndicator color="#07140F" />
                  ) : (
                    <Text style={styles.buttonText}>Sign Out</Text>
                  )}
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.label}>Email</Text>
                <TextInput
                  accessibilityLabel="Email"
                  style={styles.input}
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
                  placeholderTextColor="#8A929F"
                  selectionColor="#00E5A8"
                />
                <Text style={styles.label}>Password</Text>
                <View style={styles.passwordField}>
                  <TextInput
                    ref={passwordInput}
                    accessibilityLabel="Password"
                    style={styles.passwordInput}
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
                    selectionColor="#00E5A8"
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      showPassword ? "Hide password" : "Show password"
                    }
                    disabled={disabled}
                    onPress={() => setShowPassword((visible) => !visible)}
                    style={styles.iconButton}
                  >
                    <IconSymbol
                      name={showPassword ? "eye.slash" : "eye"}
                      size={22}
                      color="#B8BDC8"
                    />
                  </Pressable>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Sign In"
                  accessibilityState={{
                    disabled,
                    busy: pending || configLoading,
                  }}
                  disabled={disabled}
                  onPress={submit}
                  style={[styles.button, disabled && styles.disabled]}
                >
                  {pending || configLoading ? (
                    <ActivityIndicator color="#07140F" />
                  ) : (
                    <Text style={styles.buttonText}>Sign In</Text>
                  )}
                </Pressable>
                {configLoading && (
                  <Text accessibilityLiveRegion="polite" style={styles.status}>
                    Checking sign-in availability...
                  </Text>
                )}
                {pending && (
                  <Text accessibilityLiveRegion="polite" style={styles.status}>
                    Signing in...
                  </Text>
                )}
                {!configLoading &&
                  (!config || !config.emailPasswordEnabled) && (
                    <>
                      {config && (
                        <Text style={styles.status}>
                          Email sign-in is currently unavailable. Contact your
                          Phone11 administrator.
                        </Text>
                      )}
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => {
                          void loadConfig();
                        }}
                        style={styles.retry}
                      >
                        <IconSymbol
                          name="arrow.clockwise"
                          size={18}
                          color="#00E5A8"
                        />
                        <Text style={styles.retryText}>Retry</Text>
                      </Pressable>
                    </>
                  )}
              </>
            )}
            {error && (
              <Text
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
                style={styles.error}
              >
                {error}
              </Text>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0D0F14" },
  toolbar: { minHeight: 56, paddingHorizontal: 12, alignItems: "flex-end" },
  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 40,
  },
  form: { width: "100%", maxWidth: 420, alignSelf: "center" },
  brand: {
    fontSize: 32,
    fontWeight: "700",
    color: "#F5F7FA",
    marginTop: 16,
    letterSpacing: 0,
  },
  heading: {
    fontSize: 22,
    fontWeight: "600",
    color: "#F5F7FA",
    marginTop: 8,
    marginBottom: 32,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#D4D8E0",
    marginBottom: 10,
  },
  input: {
    minHeight: 54,
    borderWidth: 1,
    borderColor: "#454C59",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: "#F5F7FA",
    fontSize: 16,
    marginBottom: 22,
    backgroundColor: "#171B23",
  },
  passwordField: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#454C59",
    borderRadius: 8,
    backgroundColor: "#171B23",
  },
  passwordInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 54,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: "#F5F7FA",
    fontSize: 16,
  },
  iconButton: {
    width: 48,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  button: {
    minHeight: 54,
    paddingHorizontal: 20,
    paddingVertical: 14,
    marginTop: 28,
    borderRadius: 8,
    backgroundColor: "#00E5A8",
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#07140F",
    textAlign: "center",
  },
  disabled: { opacity: 0.55 },
  identity: { color: "#D4D8E0", fontSize: 16 },
  status: { color: "#B8BDC8", fontSize: 14, lineHeight: 21, marginTop: 18 },
  error: { color: "#FF9790", fontSize: 14, lineHeight: 21, marginTop: 18 },
  retry: {
    minHeight: 48,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    alignSelf: "flex-start",
    marginTop: 8,
  },
  retryText: { color: "#00E5A8", fontSize: 15, fontWeight: "600" },
});
