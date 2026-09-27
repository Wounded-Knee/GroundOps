/** Live fanout subject. The bus carries this envelope; it is not a domain event. */
export const realtimeSubject = "realtime.broadcast";

export type RealtimeEnvelope = {
  id: string;
  type: string;
};

export type User = {
  id: string;
  displayName: string | null;
  email: string | null;
};

export type CreateSessionRequest = {
  googleIdToken: string;
};

export type CreateSessionResponse = {
  token: string;
  user: User;
};
