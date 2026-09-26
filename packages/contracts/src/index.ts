/** Live fanout subject. The bus carries this envelope; it is not a domain event. */
export const realtimeSubject = "realtime.broadcast";

export type RealtimeEnvelope = {
  id: string;
  type: string;
};
