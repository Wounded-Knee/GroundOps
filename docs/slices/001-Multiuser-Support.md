# Slice 001 — Multiuser Support

## Status

**CURRENT SLICE**

**Derived from:** Development Methodology (`docs/02-development-methodology.md`) section 6, Technical Architecture (`docs/04-technical-architecture.md`) section 6, and the User concept in `docs/03-domain-model.md`.

**Purpose:** A person can sign in to the local client with a Google account. The platform recognizes that person as a User, shows that identity, authenticates their live connection with the same session, and lets them sign out.

This document is the implementation boundary. Later identity providers, and a possible proprietary credential, stay outside this slice. Technical Architecture section 6 already leaves the credential channel to the first sign-in slice. This slice chooses Google, in development only.

---

# 1. User capability

After this slice, a person using the local Expo client can:

1. Sign in with a Google account.
2. See the platform User that Google account maps to.
3. Hold a live connection authenticated with that session.
4. Sign out, so that session can no longer be used and that connection is closed.

Two people with different Google accounts become two Users, each with their own session. The same Google account on a later sign-in is the same User.

The signed-in person has no company, no role, and no driver state. Later slices attach operational relationships to this User.

---

# 2. Actors

One actor: a person with a Google account, using the local development client.

---

# 3. Development mode

This slice is demonstrable on the existing local stack:

- `pnpm dev:server`
- `pnpm dev:mobile`

The API uses host PostgreSQL. The client is the Expo development server the app already uses.

Google is configured with a development OAuth client for each platform the app runs on: web, Android, and iOS. The consent screen stays in testing. The application keeps no account allowlist. Google's testing-mode consent screen may still require the developer to list the Google accounts that can finish consent.

Each platform has one client id. The server and the client both read it. The client sends the id for the platform it is running on. The server accepts a token whose audience is any configured platform client id. `.env.example` names the variables and contains no real client id. Secrets stay out of git.

| Platform | Variable |
| --- | --- |
| Web | `GOOGLE_WEB_CLIENT_ID` |
| Android | `GOOGLE_ANDROID_CLIENT_ID` |
| iOS | `GOOGLE_IOS_CLIENT_ID` |

The client obtains a Google ID token through the Expo auth-session flow that runs in the current development server. This slice adds no native Google Sign-In SDK, no EAS build, no store build, no production OAuth client, and no deployed environment.

---

# 4. Credential and session

The platform owns **User**. Google authenticates the person. The User remains the platform identity.

The client sends the Google ID token to the server once. The server verifies it, then issues an **opaque session token**. The server discards the Google token after verification. Sessions are not JWTs.

The server stores a hash of the session token in PostgreSQL and returns the raw token once. The client keeps that token in secure storage and sends it as a bearer credential on later HTTP requests and on the WebSocket handshake. Logout revokes the session that was presented. A missing, unknown, or revoked token is rejected on HTTP and on the socket.

The stable link to Google is the ID token `sub` claim. Display name and email are profile fields from the verified token, so the signed-in screen can tell people apart. Lookup uses `sub`.

A verified sign-in for a `sub` the platform has not seen creates a User and a Google credential link. A later verified sign-in for the same `sub` returns that User and updates the stored display name and email from the new token. Each sign-in issues its own session. Signing out revokes only the session in use. Other sessions for that User stay valid.

The server accepts the Google token only when signature verification succeeds, the issuer is Google's accounts issuer, the audience is one of the configured platform client ids, and the token is unexpired. The server writes no User and no session when verification fails.

---

# 5. Domain objects

## 5.1 User

A **user** is the human identity from `docs/03-domain-model.md`. This slice stores the id and the profile fields needed to show who is signed in.

A user created here has no driver record. Driver remains a separate object for a later slice.

## 5.2 Google credential link

The credential link records that one Google subject belongs to one User. The provider value this slice writes is `google`. The subject is the Google `sub`.

The link is the boundary a later federated provider, or a proprietary credential, can use to attach to the same User. This slice writes `google` only. It adds no provider framework, no second provider, no password sign-in, and no magic link.

## 5.3 Session

A **session** is the server-issued credential for one signed-in client. It belongs to one User. Several sessions for one User may be valid at the same time. HTTP and the WebSocket gateway both accept this token. A session may hold a socket only while it is unrevoked.

---

# 6. State transitions

| From | To | What happens |
| --- | --- | --- |
| Signed out | Signed in | The server accepts a verified Google ID token, finds or creates the User, and issues a session. The client opens a socket with that session. |
| Signed in | Signed out | The server revokes the session presented by the client, closes any socket held by that session, and the client removes the stored token. |

No sortie, duty, availability, or other operational state changes.

A cancelled Google prompt leaves the person signed out and creates no User. A token the server rejects leaves the person signed out and creates no User.

---

# 7. Interfaces

The client has two screens.

**Sign-in.** One action: sign in with Google. This screen is the entry screen.

**Signed in.** Shows the user's display name when the profile has one, otherwise the email, otherwise that the person is signed in. Shows whether the live connection is authenticated. One action: sign out.

The person sees a failure in these cases:

- They cancel the Google prompt. The app stays on sign-in.
- The server rejects the Google token. The app stays on sign-in and shows that sign-in failed.
- The network or server is unreachable during sign-in. The app stays on sign-in and shows that sign-in failed.
- On launch, a stored token is rejected. The app clears it and shows sign-in.
- On launch, the network or server is unreachable. The app shows the failure and keeps the stored token, so a temporary outage does not sign the person out.
- The server refuses the socket. The signed-in screen shows that the live connection is not authenticated. A refusal caused by a revoked or unknown session clears the stored token and returns the person to sign-in. A refusal caused by the network keeps the stored token.

---

# 8. Backend

Commands are HTTP JSON. Zod validates input at the boundary. Domain checks live in `apps/server`. Shared wire types live in `packages/contracts`.

| Operation | Request | Result |
| --- | --- | --- |
| Create session | `POST /sessions` with the Google ID token | The session token and the User, or rejection when verification fails |
| Read current user | `GET /me` with the session token | The User for that session, or rejection when the token is missing, unknown, or revoked |
| Revoke current session | `DELETE /sessions/current` with the session token | That session is revoked, and any socket it holds is closed |
| Open live connection | `GET /ws` with the session token on the handshake, as `Authorization: Bearer` | The socket stays open while the session is unrevoked. A missing, unknown, or revoked token is rejected and no socket is kept |

The authorization rules in this slice: a session may read its own User, revoke itself, and hold a socket. The gateway checks the same session record HTTP checks. There is no second credential and no policy engine.

---

# 9. Persistence

Drizzle owns the schema and the migration. Three tables:

**user** — id, display name, email, created time.

**user credential** — user id, provider, subject. Unique on provider plus subject. Rows written here use provider `google`.

**session** — user id, token hash, created time, revoked time. The raw token is not stored. An incoming token is looked up by its hash.

Primary keys are server-generated UUIDs. Timestamps are `timestamptz` in UTC.

No company, role, driver, or operational-event table. Sign-in and sign-out are not operational history events.

---

# 10. Realtime

The WebSocket gateway in `apps/server` accepts a socket only when the handshake carries a session token for an unrevoked session. The client opens that socket after sign-in, and again when a stored session is restored. The client closes it on sign-out.

When a session is revoked, the gateway closes every socket held by that session. Other sessions for the same User keep their own sockets.

The gateway forwards a validated bus envelope only to sockets whose session is still valid. This slice publishes no domain events, so an authenticated socket receives no operational traffic. A later slice decides which events a connected User may receive. This slice does not add that filter, and it does not add company, role, or driver checks to the socket.

---

# 11. Acceptance criteria

The slice works when all of the following are true on the local stack:

1. A person can sign in with Google and see their User.
2. A second Google account produces a second User.
3. Signing in again with the first Google account returns the first User.
4. Sign-out causes that session token to be rejected.
5. Another still-valid session for the same User keeps working after one session is revoked.
6. Restarting the app with a valid stored session opens the signed-in screen and the server accepts a socket for that session.
7. Restarting the app with a revoked or unknown stored session opens the sign-in screen.
8. Cancelling the Google prompt, or presenting a token the server rejects, leaves the person signed out and creates no User.
9. A network failure during launch does not discard a stored session token.
10. After sign-in, the server accepts a socket that presents that session token, and the signed-in screen shows the live connection is authenticated.
11. A socket with a missing, unknown, or revoked token is rejected, and the server keeps no socket for it.
12. Sign-out closes the socket for that session. A second session for the same User stays connected.
13. The flow runs with `pnpm dev:server` and `pnpm dev:mobile`, using the development Google OAuth client for the platform under test.

---

# 12. Remains unimplemented

- Identity providers other than Google
- A proprietary credential, password, or magic link
- A product flow that links more than one credential to a User
- Session expiry, refresh, and revocation of every session for a User at once
- A production OAuth client, a deployed environment, EAS, and store distribution
- Roles, companies, tenancy checks, and driver state
- Screens other than sign-in and signed-in identity
- Publishing domain events, and filtering those events by company, role, or driver
- Operational history for sign-in
