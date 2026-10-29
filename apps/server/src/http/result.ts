import type { FastifyReply } from "fastify";

const domainStatus: Record<string, { status: number; error: string }> = {
  invalid: { status: 400, error: "invalid request" },
  "invalid-range": { status: 400, error: "invalid request" },
  missing: { status: 404, error: "not found" },
  "not-found": { status: 404, error: "not found" },
  "no-driver": { status: 409, error: "no driver" },
  "no-location": { status: 409, error: "no location" },
  "not-in-progress": { status: 409, error: "not in progress" },
  "not-commenced": { status: 409, error: "not commenced" },
  "in-use": { status: 409, error: "in use" },
  forbidden: { status: 403, error: "forbidden" },
  unavailable: { status: 503, error: "schedule unavailable" },
  failed: { status: 502, error: "provider failed" },
  "no-route": { status: 422, error: "no route" },
  rejected: { status: 401, error: "sign-in failed" },
};

/** Maps a domain string code onto the HTTP status the routes already use. Objects are left for the caller. */
export function sendDomainResult(reply: FastifyReply, result: string): FastifyReply {
  const mapped = domainStatus[result];
  if (!mapped) {
    throw new Error(`unmapped domain result: ${result}`);
  }
  return reply.code(mapped.status).send({ error: mapped.error });
}
