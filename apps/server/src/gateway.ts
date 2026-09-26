import type { FastifyInstance } from "fastify";
import type { Subscription } from "@nats-io/transport-node";
import { z } from "zod";

type ClientSocket = {
  readyState: number;
  send: (data: string) => void;
  on: (event: "close", listener: () => void) => void;
};

const socketOpen = 1;

const realtimeEnvelope = z.object({
  id: z.string().uuid(),
  type: z.string().min(1),
});

/**
 * Forwards validated envelopes from the bus to connected sockets.
 * There is no session issuer yet, so this pipe must not carry domain events.
 * The sign-in slice has to require the opaque session token before any domain
 * event is published or delivered.
 */
export function registerGateway(app: FastifyInstance, subscription: Subscription): void {
  const sockets = new Set<ClientSocket>();

  app.get("/ws", { websocket: true }, (socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
  });

  void forward(app, subscription, sockets);
}

async function forward(
  app: FastifyInstance,
  subscription: Subscription,
  sockets: Set<ClientSocket>,
): Promise<void> {
  for await (const message of subscription) {
    const parsed = realtimeEnvelope.safeParse(readJson(message.string()));
    if (!parsed.success) {
      app.log.warn("dropped realtime payload that is not an envelope");
      continue;
    }

    const text = JSON.stringify(parsed.data);
    for (const socket of sockets) {
      if (socket.readyState === socketOpen) {
        socket.send(text);
      }
    }
  }
}

function readJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
