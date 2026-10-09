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
  userId: string;
  socket: ClientSocket;
};

export const socketOpen = 1;
const sockets = new Set<AuthenticatedSocket>();

const realtimeEnvelope = z.object({
  id: z.uuid(),
  type: z.string().min(1),
  userId: z.uuid(),
  recordedAt: z.string().min(1),
});

/** A socket is kept only for an unrevoked session that is still open. */
export function sessionMayHoldSocket<T>(active: T | null, readyState: number): active is T {
  return active !== null && readyState === socketOpen;
}

/** Sends one envelope only to open sockets for that user. */
export function deliverEnvelope(
  entries: Iterable<{ userId: string; readyState: number; send: (data: string) => void }>,
  envelope: { userId: string },
  text: string,
): void {
  for (const entry of entries) {
    if (entry.userId === envelope.userId && entry.readyState === socketOpen) {
      entry.send(text);
    }
  }
}

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
    if (!sessionMayHoldSocket(active, socket.readyState)) {
      if (socket.readyState === socketOpen) {
        socket.close();
      }
      return;
    }

    const entry: AuthenticatedSocket = { sessionId: active.sessionId, userId: active.user.id, socket };
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

    deliverEnvelope(
      [...sockets].map((entry) => ({
        userId: entry.userId,
        readyState: entry.socket.readyState,
        send: (data) => {
          entry.socket.send(data);
        },
      })),
      parsed.data,
      message.string(),
    );
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
