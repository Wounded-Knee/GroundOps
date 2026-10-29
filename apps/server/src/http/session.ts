import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ActiveSession } from "../identity/sessions.js";
import { findActiveSession } from "../identity/sessions.js";
import { readBearer } from "../identity/tokens.js";

declare module "fastify" {
  interface FastifyRequest {
    session: ActiveSession | null;
    /** Raw bearer token, kept so session revocation can hash it. */
    sessionToken: string | null;
  }
}

const attached = new WeakSet<FastifyInstance>();

/** Sets `request.session` before route handlers validate bodies. The websocket handshake reads its own token. */
export function registerRequestSession(app: FastifyInstance): void {
  if (attached.has(app)) {
    return;
  }
  attached.add(app);
  app.decorateRequest("session", null);
  app.decorateRequest("sessionToken", null);
  app.addHook("preHandler", async (request) => {
    if (isWebSocketHandshake(request)) {
      return;
    }
    const token = readBearer(oneHeader(request.headers.authorization));
    request.sessionToken = token;
    request.session = token ? await findActiveSession(token) : null;
  });
}

function isWebSocketHandshake(request: FastifyRequest): boolean {
  const upgrade = oneHeader(request.headers.upgrade);
  if (upgrade?.toLowerCase() === "websocket") {
    return true;
  }
  const path = request.url.split("?")[0] ?? request.url;
  return path === "/ws";
}

function oneHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
