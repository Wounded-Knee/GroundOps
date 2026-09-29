import type { FastifyInstance } from "fastify";

/** Lets the local Expo web client call the API. Deployed origins stay out of this slice. */
export function registerLocalCors(app: FastifyInstance): void {
  app.addHook("onRequest", async (request, reply) => {
    const origin = oneHeader(request.headers.origin);
    if (origin && isLocalOrigin(origin)) {
      reply.header("access-control-allow-origin", origin);
      reply.header("vary", "Origin");
      reply.header("access-control-allow-headers", "authorization, content-type");
      reply.header("access-control-allow-methods", "GET, POST, PATCH, DELETE, OPTIONS");
    }
    if (request.method === "OPTIONS") {
      return reply.code(204).send();
    }
  });
}

function isLocalOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

function oneHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
