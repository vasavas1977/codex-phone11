import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { AuthBrand, AuthScreen, authStyles } from "@/components/auth/auth-screen";
import {
  getSafePortalReturnTarget,
  portalSignInRoute,
} from "@/constants/oauth";
import {
  getMobileAuthConfig,
  passwordResetErrorMessage,
  requestPasswordReset,
  type MobileAuthConfig,
} from "@/lib/_core/api";

export default function ForgotPasswordScreen() {
  const { returnTo: requestedReturnTo } = useLocalSearchParams<{
    returnTo?: string | string[];
  }>();
  const returnTo = getSafePortalReturnTarget(requestedReturnTo);
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<MobileAuthConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const busy = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    void getMobileAuthConfig()
      .then((next) => {
        if (mounted.current) setConfig(next);
      })
      .catch(() => {
        if (mounted.current) setConfig(null);
      })
      .finally(() => {
        if (mounted.current) setConfigLoading(false);
      });
    return () => {
      mounted.current = false;
    };
  }, []);

  const goToSignIn = () => {
    if (returnTo) router.replace(portalSignInRoute(returnTo));
    else router.replace("/auth/sign-in");
  };

  const submit = async () => {
    if (busy.current || !config?.passwordResetEnabled) return;
    if (!email.trim()) {
      setError("Enter your email address.");
      return;
    }
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      await requestPasswordReset(email, returnTo);
      if (mounted.current) setSubmitted(true);
    } catch (failure) {
      if (mounted.current) setError(passwordResetErrorMessage(failure));
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  };

  return (
    <AuthScreen
      closeLabel="Back to sign-in"
      closeDisabled={pending}
      onClose={goToSignIn}
    >
      {configLoading ? (
        <>
          <AuthBrand title="Reset your password" />
          <Text accessibilityLiveRegion="polite" style={authStyles.status}>
            Checking password recovery availability...
          </Text>
        </>
      ) : !config?.passwordResetEnabled ? (
        <>
          <AuthBrand
            title="Password recovery is unavailable"
            detail="Contact your Phone11 administrator for help signing in."
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to sign-in"
            onPress={goToSignIn}
            style={authStyles.primaryButton}
          >
            <Text style={authStyles.primaryButtonText}>Back to sign in</Text>
          </Pressable>
        </>
      ) : submitted ? (
        <>
          <AuthBrand
            title="Check your email"
            detail="If an account uses that email, a reset link will arrive shortly."
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to sign-in"
            onPress={goToSignIn}
            style={authStyles.primaryButton}
          >
            <Text style={authStyles.primaryButtonText}>Back to sign in</Text>
          </Pressable>
        </>
      ) : (
        <>
          <AuthBrand
            title="Reset your password"
            detail="Enter your work email and we’ll send a secure reset link."
          />
          <Text style={authStyles.label}>Email</Text>
          <TextInput
            accessibilityLabel="Email"
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            editable={!pending}
            keyboardType="email-address"
            onChangeText={setEmail}
            onSubmitEditing={() => void submit()}
            placeholder="you@company.com"
            placeholderTextColor="#94A3B8"
            returnKeyType="go"
            selectionColor="#007AFF"
            style={authStyles.input}
            textContentType="username"
            value={email}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send reset link"
            accessibilityState={{ disabled: pending, busy: pending }}
            disabled={pending}
            onPress={submit}
            style={[
              authStyles.primaryButton,
              authStyles.primaryButtonWithMargin,
              pending && authStyles.disabled,
            ]}
          >
            {pending ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={authStyles.primaryButtonText}>Send reset link</Text>
            )}
          </Pressable>
          {pending ? (
            <Text accessibilityLiveRegion="polite" style={authStyles.status}>
              Requesting a reset link...
            </Text>
          ) : null}
          {error ? (
            <Text
              accessibilityLiveRegion="polite"
              accessibilityRole="alert"
              style={authStyles.error}
            >
              {error}
            </Text>
          ) : null}
        </>
      )}
    </AuthScreen>
  );
}
