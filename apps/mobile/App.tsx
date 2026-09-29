import type { User } from "@groundops/contracts";
import * as AuthSession from "expo-auth-session";
import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { AppFrame } from "./src/AppFrame";
import { resolveApiUrl } from "./src/apiUrl";
import { CalendarScreen } from "./src/CalendarScreen";
import { clearCalendarCache } from "./src/calendarCache";
import { NavigationScreen } from "./src/NavigationScreen";
import {
  createSession,
  openAuthenticatedSocket,
  readCurrentUser,
  revokeSession,
} from "./src/sessionClient";
import { deleteStoredSession, readStoredSession, writeStoredSession } from "./src/sessionStore";

WebBrowser.maybeCompleteAuthSession();

const apiUrl = resolveApiUrl();
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
  console.log(`API URL: ${apiUrl}`);
}

type Phase =
  | { status: "loading" }
  | { status: "signed-out"; message: string | null }
  | { status: "offline"; message: string }
  | {
      status: "signed-in";
      token: string;
      user: User;
      live: "authenticated" | "closed";
      signOutMessage: string | null;
    };

export default function App() {
  const [phase, setPhase] = useState<Phase>({ status: "loading" });
  const [nonce, setNonce] = useState(() => Crypto.randomUUID());
  const [submitting, setSubmitting] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const generation = useRef(0);

  const [request, , promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: googleClient.id,
      redirectUri,
      responseType: nativeGoogleSignIn
        ? AuthSession.ResponseType.Code
        : AuthSession.ResponseType.IdToken,
      scopes: ["openid", "profile", "email"],
      usePKCE: nativeGoogleSignIn,
      extraParams: nativeGoogleSignIn ? undefined : { nonce },
    },
    googleDiscovery,
  );

  useEffect(() => {
    let cancelled = false;

    async function restore(): Promise<void> {
      let token: string | null;
      try {
        token = await readStoredSession();
      } catch (error) {
        if (!cancelled) {
          setPhase({ status: "offline", message: errorMessage(error) });
        }
        return;
      }

      if (!token) {
        if (!cancelled) {
          setPhase({ status: "signed-out", message: null });
        }
        return;
      }

      const current = await readCurrentUser(apiUrl, token);
      if (cancelled) {
        return;
      }
      if (current === "unauthorized") {
        await deleteStoredSession();
        await forgetCalendarCache();
        if (!cancelled) {
          setCalendarOpen(false);
          setPhase({ status: "signed-out", message: null });
        }
        return;
      }
      if (current === "unreachable") {
        setPhase({ status: "offline", message: "Could not reach the server." });
        return;
      }
      setPhase({
        status: "signed-in",
        token,
        user: current,
        live: "closed",
        signOutMessage: null,
      });
    }

    void restore();
    return () => {
      cancelled = true;
    };
  }, []);

  const sessionToken = phase.status === "signed-in" ? phase.token : null;

  useEffect(() => {
    if (!sessionToken) {
      return;
    }

    const token = sessionToken;
    const currentGeneration = generation.current;
    const socket = openAuthenticatedSocket(apiUrl, token);

    socket.onopen = () => {
      if (generation.current !== currentGeneration) {
        return;
      }
      setPhase((current) =>
        current.status === "signed-in" && current.token === token
          ? { ...current, live: "authenticated" }
          : current,
      );
    };

    socket.onclose = () => {
      if (generation.current !== currentGeneration) {
        return;
      }
      void classifyClosedSocket(token, currentGeneration);
    };

    return () => {
      generation.current += 1;
      socket.close();
    };
  }, [sessionToken]);

  async function classifyClosedSocket(token: string, currentGeneration: number): Promise<void> {
    const current = await readCurrentUser(apiUrl, token);
    if (generation.current !== currentGeneration) {
      return;
    }
    if (current === "unauthorized") {
      await deleteStoredSession();
      await forgetCalendarCache();
      if (generation.current !== currentGeneration) {
        return;
      }
      setCalendarOpen(false);
      setPhase({ status: "signed-out", message: null });
      return;
    }
    setPhase((existing) =>
      existing.status === "signed-in" && existing.token === token
        ? { ...existing, live: "closed" }
        : existing,
    );
  }

  async function onSignIn(): Promise<void> {
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
      setPhase({
        status: "signed-in",
        token: created.token,
        user: created.user,
        live: "closed",
        signOutMessage: null,
      });
    } catch (error) {
      if (__DEV__) {
        console.log(`Google sign-in failed: ${errorMessage(error)}`);
      }
      setPhase({ status: "signed-out", message: "Sign-in failed." });
    } finally {
      setSubmitting(false);
    }
  }

  async function onSignOut(token: string): Promise<void> {
    const result = await revokeSession(apiUrl, token);
    if (result === "unreachable") {
      setPhase((current) =>
        current.status === "signed-in" ? { ...current, signOutMessage: "Sign-out failed." } : current,
      );
      return;
    }
    await deleteStoredSession();
    await forgetCalendarCache();
    setCalendarOpen(false);
    setPhase({ status: "signed-out", message: null });
  }

  async function onSessionRejected(): Promise<void> {
    generation.current += 1;
    await deleteStoredSession();
    await forgetCalendarCache();
    setCalendarOpen(false);
    setPhase({ status: "signed-out", message: null });
  }

  async function onRetry(): Promise<void> {
    setPhase({ status: "loading" });
    let token: string | null;
    try {
      token = await readStoredSession();
    } catch (error) {
      setPhase({ status: "offline", message: errorMessage(error) });
      return;
    }
    if (!token) {
      setPhase({ status: "signed-out", message: null });
      return;
    }
    const current = await readCurrentUser(apiUrl, token);
    if (current === "unauthorized") {
      await deleteStoredSession();
      await forgetCalendarCache();
      setCalendarOpen(false);
      setPhase({ status: "signed-out", message: null });
      return;
    }
    if (current === "unreachable") {
      setPhase({ status: "offline", message: "Could not reach the server." });
      return;
    }
    setPhase({
      status: "signed-in",
      token,
      user: current,
      live: "closed",
      signOutMessage: null,
    });
  }

  const driving = phase.status === "signed-in" && Platform.OS !== "web";
  const showCalendar = phase.status === "signed-in" && calendarOpen;

  return (
    <AppFrame>
      <View style={driving || showCalendar ? styles.map : styles.container}>
        {phase.status === "loading" ? <Text>Checking session…</Text> : null}
        {phase.status === "signed-out" ? (
          <SignIn message={phase.message} disabled={submitting} onSignIn={() => void onSignIn()} />
        ) : null}
        {phase.status === "offline" ? <Offline message={phase.message} onRetry={() => void onRetry()} /> : null}
        {phase.status === "signed-in" && Platform.OS === "web" && !showCalendar ? (
          <SignedIn
            user={phase.user}
            live={phase.live}
            signOutMessage={phase.signOutMessage}
            onSignOut={() => void onSignOut(phase.token)}
            onOpenCalendar={() => setCalendarOpen(true)}
          />
        ) : null}
        {phase.status === "signed-in" && Platform.OS === "web" && showCalendar ? (
          <CalendarScreen
            userId={phase.user.id}
            token={phase.token}
            onClose={() => setCalendarOpen(false)}
            onUnauthorized={() => void onSessionRejected()}
          />
        ) : null}
        {driving ? (
          <View style={styles.map}>
            <NavigationScreen
              token={phase.token}
              signOutMessage={phase.signOutMessage}
              onSignOut={() => void onSignOut(phase.token)}
              onUnauthorized={() => void onSessionRejected()}
              onOpenCalendar={() => setCalendarOpen(true)}
            />
            {showCalendar ? (
              <View style={styles.calendarCover}>
                <CalendarScreen
                  userId={phase.user.id}
                  token={phase.token}
                  onClose={() => setCalendarOpen(false)}
                  onUnauthorized={() => void onSessionRejected()}
                />
              </View>
            ) : null}
          </View>
        ) : null}
        <StatusBar style="auto" />
      </View>
    </AppFrame>
  );
}

function SignIn({
  message,
  disabled,
  onSignIn,
}: {
  message: string | null;
  disabled: boolean;
  onSignIn: () => void;
}) {
  return (
    <>
      <Pressable style={styles.button} disabled={disabled} onPress={onSignIn}>
        <Text style={styles.buttonText}>Sign in with Google</Text>
      </Pressable>
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </>
  );
}

function SignedIn({
  user,
  live,
  signOutMessage,
  onSignOut,
  onOpenCalendar,
}: {
  user: User;
  live: "authenticated" | "closed";
  signOutMessage: string | null;
  onSignOut: () => void;
  onOpenCalendar: () => void;
}) {
  return (
    <>
      <Text style={styles.identity}>{identityLabel(user)}</Text>
      <Text style={styles.message}>
        {live === "authenticated"
          ? "Live connection authenticated"
          : "Live connection not authenticated"}
      </Text>
      {signOutMessage ? <Text style={styles.message}>{signOutMessage}</Text> : null}
      <Pressable style={styles.button} onPress={onOpenCalendar}>
        <Text style={styles.buttonText}>Calendar</Text>
      </Pressable>
      <Pressable style={[styles.button, styles.signOutButton]} onPress={onSignOut}>
        <Text style={styles.buttonText}>Sign out</Text>
      </Pressable>
    </>
  );
}

async function forgetCalendarCache(): Promise<void> {
  try {
    await clearCalendarCache();
  } catch {
    // A later sign-in discards a cache stored for a different user.
  }
}

function Offline({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <>
      <Text style={styles.message}>{message}</Text>
      <Pressable style={styles.button} onPress={onRetry}>
        <Text style={styles.buttonText}>Retry</Text>
      </Pressable>
    </>
  );
}

function identityLabel(user: User): string {
  return user.displayName ?? user.email ?? "Signed in";
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  map: {
    flex: 1,
    backgroundColor: "#fff",
  },
  calendarCover: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "#fff",
  },
  signOutButton: {
    marginTop: 12,
  },
  identity: {
    fontSize: 20,
    marginBottom: 12,
    textAlign: "center",
  },
  message: {
    marginTop: 16,
    textAlign: "center",
  },
  button: {
    backgroundColor: "#111",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 8,
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
  },
});
