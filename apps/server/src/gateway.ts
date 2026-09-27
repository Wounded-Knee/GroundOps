import type { FastifyInstance } from "fastify";
import type { Subscription } from "@nats-io/transport-node";
import { z } from "zod";
import { findActiveSession } from "./identity/sessions.js";
import { readBearer } from "./identity/tokens.js";

type ClientSocket = {
  readyState: number;
  send: (data: string) => void;
  close: () => void;
  on: (event: "close", listener: () => void) => void;
};

type AuthenticatedSocket = {
  sessionId: string;
  socket: ClientSocket;
};

const socketOpen = 1;
const sockets = new Set<AuthenticatedSocket>();

const realtimeEnvelope = z.object({
  id: z.string().uuid(),
  type: z.string().min(1),
});

/** Closes every socket held by one session. Other sessions stay connected. */
export function closeSessionSockets(sessionId: string): void {
  for (const entry of [...sockets]) {
    if (entry.sessionId !== sessionId) {
      continue;
    }
    sockets.delete(entry);
    entry.socket.close();
  }
}

/**
 * Accepts a socket only for an unrevoked session presented on the handshake.
 * Forwards bus envelopes only to sockets still in that set.
 */
export function registerGateway(app: FastifyInstance, subscription: Subscription): void {
  app.get("/ws", { websocket: true }, (socket, request) => {
    void acceptSocket(socket, authorizationHeader(request.headers.authorization));
  });

  void forward(app, subscription);
}

async function acceptSocket(socket: ClientSocket, authorization: string | undefined): Promise<void> {
  try {
    const token = readBearer(authorization);
    const active = token ? await findActiveSession(token) : null;
    if (!active || socket.readyState !== socketOpen) {
      if (socket.readyState === socketOpen) {
        socket.close();
      }
      return;
    }

    const entry: AuthenticatedSocket = { sessionId: active.sessionId, socket };
    sockets.add(entry);
    socket.on("close", () => {
      sockets.delete(entry);
    });
  } catch {
    if (socket.readyState === socketOpen) {
      socket.close();
    }
  }
}

async function forward(app: FastifyInstance, subscription: Subscription): Promise<void> {
  for await (const message of subscription) {
    const parsed = realtimeEnvelope.safeParse(readJson(message.string()));
    if (!parsed.success) {
      app.log.warn("dropped realtime payload that is not an envelope");
      continue;
    }

    const text = JSON.stringify(parsed.data);
    for (const entry of sockets) {
      if (entry.socket.readyState === socketOpen) {
        entry.socket.send(text);
      }
    }
  }
}

function authorizationHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function readJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
