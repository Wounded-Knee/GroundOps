import type { User } from "@groundops/contracts";
import * as AuthSession from "expo-auth-session";
import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { clearOfflineStore } from "./localDatabase";
import { createSession, readCurrentUser, revokeSession } from "./sessionClient";
import {
  deleteStoredSession,
  readStoredSession,
  readStoredUser,
  writeStoredSession,
  writeStoredUser,
} from "./sessionStore";
import { stopLocationObservationUpdates } from "./locationObservationReporting";

WebBrowser.maybeCompleteAuthSession();

const googleClient = googleClientForPlatform();
const nativeGoogleSignIn = Platform.OS !== "web";
const redirectUri = nativeGoogleSignIn
  ? nativeGoogleRedirectUri(googleClient.id)
  : AuthSession.makeRedirectUri({ path: "redirect" });
const googleDiscovery = {
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenEndpoint: "https://oauth2.googleapis.com/token",
};

if (__DEV__) {
  console.log(`Google redirect URI: ${redirectUri}`);
}

export type Phase =
  | { status: "loading" }
  | { status: "signed-out"; message: string | null }
  | { status: "offline"; message: string }
  | {
      status: "signed-in";
      token: string;
      user: User;
      live: "authenticated" | "closed";
      signOutMessage: string | null;
      profileFresh: boolean;
    };

export function useSession(input: {
  apiUrl: string;
  resetChrome: () => void;
  invalidateLive: () => void;
}): {
  phase: Phase;
  submitting: boolean;
  onSignIn: () => Promise<void>;
  onSignOut: (token: string) => Promise<void>;
  onRetry: () => Promise<void>;
  onSessionRejected: () => Promise<void>;
  onUnauthorized: () => void;
  setLive: (token: string, live: "authenticated" | "closed") => void;
} {
  const { apiUrl } = input;
  const resetChromeRef = useRef(input.resetChrome);
  const invalidateLiveRef = useRef(input.invalidateLive);
  resetChromeRef.current = input.resetChrome;
  invalidateLiveRef.current = input.invalidateLive;
  const [phase, setPhase] = useState<Phase>({ status: "loading" });
  const [nonce, setNonce] = useState(() => Crypto.randomUUID());
  const [submitting, setSubmitting] = useState(false);

  const [request, , promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: googleClient.id,
      redirectUri,
      responseType: nativeGoogleSignIn ? AuthSession.ResponseType.Code : AuthSession.ResponseType.IdToken,
      scopes: ["openid", "profile", "email"],
      usePKCE: nativeGoogleSignIn,
      prompt: AuthSession.Prompt.SelectAccount,
      extraParams: nativeGoogleSignIn ? undefined : { nonce },
    },
    googleDiscovery,
  );

  const onSessionRejected = useCallback(async () => {
    invalidateLiveRef.current();
    await deleteStoredSession();
    await forgetCalendarCache();
    await stopLocationObservationUpdates();
    resetChromeRef.current();
    setPhase({ status: "signed-out", message: null });
  }, []);

  const onUnauthorized = useCallback(() => {
    void onSessionRejected();
  }, [onSessionRejected]);

  const setLive = useCallback((token: string, live: "authenticated" | "closed") => {
    setPhase((current) =>
      current.status === "signed-in" && current.token === token ? { ...current, live } : current,
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    void restoreStoredSession(apiUrl, () => cancelled, () => resetChromeRef.current(), setPhase);
    return () => {
      cancelled = true;
    };
  }, [apiUrl]);

  const profileToken = phase.status === "signed-in" ? phase.token : null;
  const profileFresh = phase.status === "signed-in" ? phase.profileFresh : true;

  useEffect(() => {
    if (!profileToken || profileFresh) {
      return;
    }
    const token = profileToken;
    let cancelled = false;
    const refresh = async () => {
      const current = await readCurrentUser(apiUrl, token);
      if (cancelled) {
        return;
      }
      if (current === "unauthorized") {
        await onSessionRejected();
        return;
      }
      if (current === "unreachable") {
        return;
      }
      try {
        await writeStoredUser(current);
      } catch {
        // The shell already has the cached profile. The next retry writes it again.
      }
      setPhase((existing) =>
        existing.status === "signed-in" && existing.token === token
          ? { ...existing, user: current, profileFresh: true }
          : existing,
      );
    };
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [apiUrl, onSessionRejected, profileFresh, profileToken]);

  const onSignIn = useCallback(async () => {
    setSubmitting(true);
    setPhase({ status: "signed-out", message: null });
    if (!googleClient.id) {
      setPhase({
        status: "signed-out",
        message: `Set ${googleClient.envName} in the root .env file.`,
      });
      setSubmitting(false);
      return;
    }
    try {
      const result = await promptAsync();
      setNonce(Crypto.randomUUID());
      if (result.type === "cancel" || result.type === "dismiss") {
        return;
      }
      const idToken = await readIdToken(result, request?.codeVerifier);
      if (!idToken) {
        if (__DEV__) {
          console.log(`Google sign-in returned no ID token (${result.type}).`);
        }
        setPhase({ status: "signed-out", message: "Sign-in failed." });
        return;
      }

      const created = await createSession(apiUrl, idToken);
      if (created === "rejected" || created === "unreachable") {
        if (__DEV__) {
          console.log(`Session create ${created} at ${apiUrl}.`);
        }
        setPhase({ status: "signed-out", message: "Sign-in failed." });
        return;
      }
      await writeStoredSession(created.token);
      await writeStoredUser(created.user);
      resetChromeRef.current();
      setPhase({
        status: "signed-in",
        token: created.token,
        user: created.user,
        live: "closed",
        signOutMessage: null,
        profileFresh: true,
      });
    } catch (error) {
      if (__DEV__) {
        console.log(`Google sign-in failed: ${errorMessage(error)}`);
      }
      setPhase({ status: "signed-out", message: "Sign-in failed." });
    } finally {
      setSubmitting(false);
    }
  }, [apiUrl, promptAsync, request?.codeVerifier]);

  const onSignOut = useCallback(
    async (token: string) => {
      const result = await revokeSession(apiUrl, token);
      if (result === "unreachable") {
        setPhase((current) =>
          current.status === "signed-in" ? { ...current, signOutMessage: "Sign-out failed." } : current,
        );
        return;
      }
      await deleteStoredSession();
      await forgetCalendarCache();
      await stopLocationObservationUpdates();
      resetChromeRef.current();
      setPhase({ status: "signed-out", message: null });
    },
    [apiUrl],
  );

  const onRetry = useCallback(async () => {
    setPhase({ status: "loading" });
    await restoreStoredSession(apiUrl, () => false, () => resetChromeRef.current(), setPhase);
  }, [apiUrl]);

  return { phase, submitting, onSignIn, onSignOut, onRetry, onSessionRejected, onUnauthorized, setLive };
}

async function restoreStoredSession(
  apiUrl: string,
  cancelled: () => boolean,
  resetChrome: () => void,
  setPhase: (phase: Phase) => void,
): Promise<void> {
  let token: string | null;
  try {
    token = await readStoredSession();
  } catch (error) {
    if (!cancelled()) {
      setPhase({ status: "offline", message: errorMessage(error) });
    }
    return;
  }

  if (!token) {
    if (!cancelled()) {
      setPhase({ status: "signed-out", message: null });
    }
    return;
  }

  const current = await readCurrentUser(apiUrl, token);
  if (cancelled()) {
    return;
  }
  if (current === "unauthorized") {
    await deleteStoredSession();
    await forgetCalendarCache();
    if (!cancelled()) {
      resetChrome();
      setPhase({ status: "signed-out", message: null });
    }
    return;
  }
  if (current === "unreachable") {
    const cached = await readCachedUser();
    if (cancelled()) {
      return;
    }
    if (!cached) {
      setPhase({ status: "offline", message: "Could not reach the server." });
      return;
    }
    setPhase({
      status: "signed-in",
      token,
      user: cached,
      live: "closed",
      signOutMessage: null,
      profileFresh: false,
    });
    return;
  }
  try {
    await writeStoredUser(current);
  } catch {
    // Sign-in still proceeds. The next profile read writes the cache.
  }
  setPhase({
    status: "signed-in",
    token,
    user: current,
    live: "closed",
    signOutMessage: null,
    profileFresh: true,
  });
}

async function readCachedUser(): Promise<User | null> {
  try {
    return await readStoredUser();
  } catch {
    return null;
  }
}

async function forgetCalendarCache(): Promise<void> {
  try {
    await clearOfflineStore();
  } catch {
    // A later sign-in discards a cache stored for a different user.
  }
}

async function readIdToken(
  result: AuthSession.AuthSessionResult,
  codeVerifier: string | undefined,
): Promise<string | null> {
  if (result.type !== "success") {
    return null;
  }
  const fromParams = result.params.id_token;
  if (fromParams && fromParams.length > 0) {
    return fromParams;
  }
  const fromAuthentication = result.authentication?.idToken;
  if (fromAuthentication && fromAuthentication.length > 0) {
    return fromAuthentication;
  }
  const code = result.params.code;
  if (!code || !codeVerifier) {
    return null;
  }
  const tokens = await new AuthSession.AccessTokenRequest({
    clientId: googleClient.id,
    redirectUri,
    code,
    extraParams: { code_verifier: codeVerifier },
  }).performAsync(googleDiscovery);
  return tokens.idToken && tokens.idToken.length > 0 ? tokens.idToken : null;
}

function nativeGoogleRedirectUri(clientId: string): string {
  const scheme = reversedGoogleClientScheme(clientId);
  return scheme ? `${scheme}:/oauth2redirect` : "groundops://redirect";
}

function reversedGoogleClientScheme(clientId: string): string | null {
  const suffix = ".apps.googleusercontent.com";
  if (!clientId.endsWith(suffix)) {
    return null;
  }
  const prefix = clientId.slice(0, -suffix.length);
  return prefix ? `com.googleusercontent.apps.${prefix}` : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Could not reach the server.";
}

function googleClientForPlatform(): { id: string; envName: string } {
  if (Platform.OS === "ios") {
    return {
      id: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? "",
      envName: "GOOGLE_IOS_CLIENT_ID",
    };
  }
  if (Platform.OS === "android") {
    return {
      id: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID ?? "",
      envName: "GOOGLE_ANDROID_CLIENT_ID",
    };
  }
  return {
    id: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "",
    envName: "GOOGLE_WEB_CLIENT_ID",
  };
}
