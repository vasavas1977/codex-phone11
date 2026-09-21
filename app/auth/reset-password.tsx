import { useEffect, useState } from "react";
import { ActivityIndicator, Platform, Pressable, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { AuthBrand, AuthScreen, authStyles } from "@/components/auth/auth-screen";
import {
  getSafePortalReturnTarget,
  passwordResetPathWithoutToken,
  passwordResetRequestRoute,
  portalSignInRoute,
  resetTokenFromFragment,
} from "@/constants/oauth";
import { passwordResetErrorMessage, resetPassword } from "@/lib/_core/api";

export default function ResetPasswordScreen() {
  const { returnTo: requestedReturnTo } = useLocalSearchParams<{
    returnTo?: string | string[];
  }>();
  const returnTo = getSafePortalReturnTarget(requestedReturnTo);
  const [token] = useState(() =>
    Platform.OS === "web" && typeof window !== "undefined"
      ? resetTokenFromFragment(window.location.hash)
      : null,
  );
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const hasQueryToken = new URLSearchParams(window.location.search).has(
      "token",
    );
    if (!window.location.hash && !hasQueryToken) return;
    window.history.replaceState(
      window.history.state,
      "",
      passwordResetPathWithoutToken(returnTo),
    );
  }, [returnTo]);

  const goToSignIn = () => {
    if (returnTo) router.replace(portalSignInRoute(returnTo));
    else router.replace("/auth/sign-in");
  };

  const requestNewLink = () => {
    router.replace(passwordResetRequestRoute(returnTo) as any);
  };

  const submit = async () => {
    if (pending || !token) return;
    if (password.length < 12) {
      setError("Use a password with at least 12 characters.");
      return;
    }
    if (password !== confirmation) {
      setError("Passwords do not match.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await resetPassword(token, password);
      setPassword("");
      setConfirmation("");
      setComplete(true);
    } catch (failure) {
      setError(passwordResetErrorMessage(failure));
    } finally {
      setPending(false);
    }
  };

  if (!token) {
    return (
      <AuthScreen closeLabel="Back to sign-in" onClose={goToSignIn}>
        <AuthBrand
          title="This link is no longer valid"
          detail="Password reset links expire for your protection. Request a new one to continue."
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Request a new reset link"
          onPress={requestNewLink}
          style={authStyles.primaryButton}
        >
          <Text style={authStyles.primaryButtonText}>Request a new link</Text>
        </Pressable>
      </AuthScreen>
    );
  }

  if (complete) {
    return (
      <AuthScreen closeLabel="Back to sign-in" onClose={goToSignIn}>
        <AuthBrand
          title="Password updated"
          detail="Use your new password to sign in."
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sign in with new password"
          onPress={goToSignIn}
          style={authStyles.primaryButton}
        >
          <Text style={authStyles.primaryButtonText}>Sign in</Text>
        </Pressable>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen
      closeLabel="Back to sign-in"
      closeDisabled={pending}
      onClose={goToSignIn}
    >
      <AuthBrand
        title="Choose a new password"
        detail="Use at least 12 characters to keep your account secure."
      />
      <Text style={authStyles.label}>New password</Text>
      <View style={authStyles.passwordField}>
        <TextInput
          accessibilityLabel="New password"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!pending}
          onChangeText={setPassword}
          placeholder="At least 12 characters"
          placeholderTextColor="#94A3B8"
          returnKeyType="next"
          secureTextEntry={!showPassword}
          selectionColor="#007AFF"
          style={authStyles.passwordInput}
          textContentType="newPassword"
          value={password}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={showPassword ? "Hide password" : "Show password"}
          disabled={pending}
          onPress={() => setShowPassword((visible) => !visible)}
          style={authStyles.iconButton}
        >
          <Text style={authStyles.textLinkLabel}>
            {showPassword ? "Hide" : "Show"}
          </Text>
        </Pressable>
      </View>
      <View style={authStyles.inputWithMargin} />
      <Text style={authStyles.label}>Confirm new password</Text>
      <TextInput
        accessibilityLabel="Confirm new password"
        autoCapitalize="none"
        autoCorrect={false}
        editable={!pending}
        onChangeText={setConfirmation}
        onSubmitEditing={() => void submit()}
        placeholder="Repeat your new password"
        placeholderTextColor="#94A3B8"
        returnKeyType="go"
        secureTextEntry={!showPassword}
        selectionColor="#007AFF"
        style={authStyles.input}
        textContentType="newPassword"
        value={confirmation}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Update password"
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
          <Text style={authStyles.primaryButtonText}>Update password</Text>
        )}
      </Pressable>
      {pending ? (
        <Text accessibilityLiveRegion="polite" style={authStyles.status}>
          Updating your password...
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
    </AuthScreen>
  );
}
