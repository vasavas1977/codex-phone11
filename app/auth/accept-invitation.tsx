import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, Text, TextInput } from "react-native";
import { router } from "expo-router";
import { AuthBrand, AuthScreen, authStyles } from "@/components/auth/auth-screen";
import { useAuth } from "@/hooks/use-auth";
import { createTRPCClient } from "@/lib/trpc";
import { signInWithEmail } from "@/lib/_core/api";
import * as Auth from "@/lib/_core/auth";
import { scrubInvitationBrowserUrl } from "@/lib/invitation-ui";
import { resetTokenFromFragment } from "@/constants/oauth";

type Invitation = {
  workspaceName: string;
  email: string;
  role: "user" | "admin";
  expiresAt: string;
  mode: "create_account" | "sign_in";
};

function sameEmail(left: string | null | undefined, right: string) {
  return Boolean(left && left.trim().toLowerCase() === right.trim().toLowerCase());
}

function invitationTokenFromHash(hash: string | undefined) {
  return resetTokenFromFragment(hash);
}

export default function AcceptInvitationScreen() {
  const { user, logout } = useAuth();
  const [token, setToken] = useState<string | null>(null);
  const [tokenReady, setTokenReady] = useState(false);
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [checking, setChecking] = useState(false);
  const [pending, setPending] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const attempt = useRef(0);
  const busy = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; attempt.current += 1; };
  }, []);

  useEffect(() => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      const nextToken = invitationTokenFromHash(window.location.hash);
      const hasQueryToken = new URLSearchParams(window.location.search).has("token");
      // Invitation links carry the token only in the fragment. A query token
      // needs a full route replacement to clear Expo Router's query state.
      scrubInvitationBrowserUrl(() => hasQueryToken
        ? router.replace("/auth/accept-invitation")
        : router.setParams({ "#": "" }));
      setToken(hasQueryToken ? null : nextToken);
    }
    setTokenReady(true);
  }, []);

  const inspect = useCallback(async () => {
    if (!token) return;
    const request = ++attempt.current;
    setChecking(true);
    setError(null);
    try {
      const result = await createTRPCClient().invitations.inspect.mutate({ token });
      if (mounted.current && request === attempt.current) setInvitation(result);
    } catch {
      if (mounted.current && request === attempt.current) {
        setInvitation(null);
        setError("This invitation link is invalid, expired, or unavailable. Ask the workspace owner to send a new invitation.");
      }
    } finally {
      if (mounted.current && request === attempt.current) setChecking(false);
    }
  }, [token]);

  useEffect(() => { void inspect(); }, [inspect]);

  const goToSignIn = () => router.replace("/auth/sign-in");
  const continueToWorkspace = () => {
    if (!user || !invitation || !sameEmail(user.email, invitation.email)) {
      goToSignIn();
      return;
    }
    router.replace(invitation.role === "admin" ? "/admin" : "/(tabs)");
  };

  const submit = async () => {
    if (busy.current || pending || !token || !invitation) return;
    setError(null);
    if (invitation.mode === "create_account") {
      if (!name.trim()) { setError("Enter your name."); return; }
      if (password.length < 12) { setError("Use a password with at least 12 characters."); return; }
      if (password !== confirmation) { setError("Passwords do not match."); return; }
      if (user && !sameEmail(user.email, invitation.email)) {
        setError("You are signed in with a different account. Sign out to continue with this invitation.");
        return;
      }
    } else {
      if (!user && !sameEmail(email, invitation.email)) {
        setError(`Sign in with ${invitation.email} to accept this invitation.`);
        return;
      }
      if (user && !sameEmail(user.email, invitation.email)) {
        setError("You are signed in with a different account. Sign out to continue with this invitation.");
        return;
      }
      if (!user && !password) { setError("Enter your password."); return; }
    }

    busy.current = true;
    setPending(true);
    try {
      if (invitation.mode === "sign_in" && !user) {
        const signedIn = await signInWithEmail(email.trim(), password);
        if (!sameEmail(signedIn.email, invitation.email)) {
          await logout();
          throw new Error("identity-mismatch");
        }
      }
      const currentUser = Auth.getAuthSnapshot().user;
      if (currentUser && !sameEmail(currentUser.email, invitation.email)) {
        setError("You are signed in with a different account. Sign out to continue with this invitation.");
        return;
      }
      await createTRPCClient().invitations.accept.mutate({
        token,
        ...(invitation.mode === "create_account" ? { name: name.trim(), password } : {}),
      });
      if (!mounted.current) return;
      setToken(null);
      setPassword("");
      setConfirmation("");
      setComplete(true);
    } catch (failure) {
      if (mounted.current) {
        setError(failure instanceof Error && failure.message === "identity-mismatch"
          ? `Sign in with ${invitation.email} to accept this invitation.`
          : "Phone11 could not accept this invitation. It may have expired or already been used. Retry or ask the workspace owner for a new link.");
      }
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  };

  const signOutAndContinue = async () => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try { await logout(); }
    catch { if (mounted.current) setError("Phone11 could not sign out this account. Please try again."); }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  };

  if (complete) {
    const signedIntoInvitation = Boolean(user && invitation && sameEmail(user.email, invitation.email));
    return <AuthScreen closeLabel={signedIntoInvitation ? "Go to workspace" : "Go to sign-in"} onClose={continueToWorkspace}>
      <AuthBrand title="Invitation accepted" detail={`You’ve joined ${invitation?.workspaceName || "the workspace"}.${signedIntoInvitation ? " Continue to Phone11." : " Sign in to continue."}`} />
      <Pressable accessibilityRole="button" onPress={continueToWorkspace} style={authStyles.primaryButton}><Text style={authStyles.primaryButtonText}>{signedIntoInvitation ? "Go to workspace" : "Go to sign in"}</Text></Pressable>
    </AuthScreen>;
  }

  if (!tokenReady) {
    return <AuthScreen closeLabel="Back to sign-in" onClose={goToSignIn}>
      <AuthBrand title="Opening invitation" detail="Please wait while Phone11 loads the invitation." />
      <ActivityIndicator color="#007AFF" />
    </AuthScreen>;
  }

  if (!token) {
    return <AuthScreen closeLabel="Go to sign-in" onClose={goToSignIn}>
      <AuthBrand title="Invitation link unavailable" detail="Open the full invitation link from your email, or ask the workspace owner to send a new one." />
      <Pressable accessibilityRole="button" onPress={goToSignIn} style={authStyles.primaryButton}><Text style={authStyles.primaryButtonText}>Go to sign in</Text></Pressable>
    </AuthScreen>;
  }

  if (checking && !invitation) {
    return <AuthScreen closeLabel="Back to sign-in" onClose={goToSignIn}>
      <AuthBrand title="Checking invitation" detail="Please wait while Phone11 verifies the invitation." />
      <ActivityIndicator color="#007AFF" />
    </AuthScreen>;
  }

  if (!invitation) {
    return <AuthScreen closeLabel="Back to sign-in" onClose={goToSignIn}>
      <AuthBrand title="Invitation unavailable" detail="This invitation link could not be verified." />
      {error ? <Text accessibilityRole="alert" style={authStyles.error}>{error}</Text> : null}
      <Pressable accessibilityRole="button" disabled={checking} onPress={() => void inspect()} style={[authStyles.primaryButton, authStyles.primaryButtonWithMargin, checking && authStyles.disabled]}>
        {checking ? <ActivityIndicator color="#FFFFFF" /> : <Text style={authStyles.primaryButtonText}>Try again</Text>}
      </Pressable>
    </AuthScreen>;
  }

  const wrongAccount = Boolean(user && !sameEmail(user.email, invitation.email));
  const accountCreation = invitation.mode === "create_account";
  return <AuthScreen closeLabel="Back to sign-in" closeDisabled={pending} onClose={goToSignIn}>
    <AuthBrand title={accountCreation ? "Join your workspace" : "Accept your invitation"} detail={`${invitation.workspaceName} invited ${invitation.email} as a ${invitation.role === "admin" ? "workspace administrator" : "member"}.`} />
    {wrongAccount ? <>
      <Text accessibilityRole="alert" style={authStyles.error}>You’re signed in as {user?.email}. This invitation is for {invitation.email}.</Text>
      <Pressable accessibilityRole="button" disabled={pending} onPress={() => void signOutAndContinue()} style={[authStyles.primaryButton, authStyles.primaryButtonWithMargin, pending && authStyles.disabled]}>
        {pending ? <ActivityIndicator color="#FFFFFF" /> : <Text style={authStyles.primaryButtonText}>Sign out and continue</Text>}
      </Pressable>
    </> : accountCreation ? <>
      <Text style={authStyles.label}>Name</Text>
      <TextInput accessibilityLabel="Name" autoCapitalize="words" autoCorrect={false} editable={!pending} onChangeText={setName} placeholder="Your name" placeholderTextColor="#94A3B8" style={[authStyles.input, authStyles.inputWithMargin]} textContentType="name" value={name} />
      <Text style={authStyles.label}>Password</Text>
      <TextInput accessibilityLabel="Password" autoCapitalize="none" autoCorrect={false} editable={!pending} onChangeText={setPassword} placeholder="At least 12 characters" placeholderTextColor="#94A3B8" secureTextEntry style={[authStyles.input, authStyles.inputWithMargin]} textContentType="newPassword" value={password} />
      <Text style={authStyles.label}>Confirm password</Text>
      <TextInput accessibilityLabel="Confirm password" autoCapitalize="none" autoCorrect={false} editable={!pending} onChangeText={setConfirmation} onSubmitEditing={() => void submit()} placeholder="Repeat your password" placeholderTextColor="#94A3B8" secureTextEntry style={authStyles.input} textContentType="newPassword" value={confirmation} />
    </> : user ? <Text style={authStyles.identity}>Signed in as {user.email}. Accept to join this workspace.</Text> : <>
      <Text style={authStyles.label}>Email</Text>
      <TextInput accessibilityLabel="Invitation email" autoCapitalize="none" autoCorrect={false} editable={!pending} keyboardType="email-address" onChangeText={setEmail} placeholder={invitation.email} placeholderTextColor="#94A3B8" style={[authStyles.input, authStyles.inputWithMargin]} textContentType="emailAddress" value={email} />
      <Text style={authStyles.label}>Password</Text>
      <TextInput accessibilityLabel="Password" autoCapitalize="none" autoCorrect={false} editable={!pending} onChangeText={setPassword} onSubmitEditing={() => void submit()} placeholder="Your Phone11 password" placeholderTextColor="#94A3B8" secureTextEntry style={authStyles.input} textContentType="password" value={password} />
    </>}
    {!wrongAccount ? <Pressable accessibilityRole="button" accessibilityLabel="Accept workspace invitation" accessibilityState={{ disabled: pending, busy: pending }} disabled={pending} onPress={() => void submit()} style={[authStyles.primaryButton, authStyles.primaryButtonWithMargin, pending && authStyles.disabled]}>
      {pending ? <ActivityIndicator color="#FFFFFF" /> : <Text style={authStyles.primaryButtonText}>Accept invitation</Text>}
    </Pressable> : null}
    {pending ? <Text accessibilityLiveRegion="polite" style={authStyles.status}>Accepting invitation…</Text> : null}
    {error ? <Text accessibilityRole="alert" style={authStyles.error}>{error}</Text> : null}
    {!accountCreation ? <Pressable accessibilityRole="button" disabled={pending} onPress={goToSignIn} style={authStyles.textLink}><Text style={authStyles.textLinkLabel}>Go to sign in</Text></Pressable> : null}
  </AuthScreen>;
}
