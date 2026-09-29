import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { connectBus } from "./bus.js";
import { closeDatabase, pingDatabase } from "./db.js";
import { registerGateway } from "./gateway.js";
import { migrateDatabase } from "./migrate.js";
import { findActiveSession } from "./identity/sessions.js";
import { readBearer } from "./identity/tokens.js";
import { registerRoutingRoutes } from "./routing/http.js";
import { computeDrivingRoute, suggestPlaces } from "./routing/google.js";
import { registerCalendarRoutes } from "./calendar/http.js";
import { registerLocalCors } from "./cors.js";
import { registerSessionRoutes } from "./routes.js";

const port = Number(process.env.PORT ?? 3000);
const host = "0.0.0.0";

const app = Fastify({ logger: true });
const bus = await connectBus();

await migrateDatabase();
registerLocalCors(app);
await app.register(websocket);
registerSessionRoutes(app);
registerCalendarRoutes(app);
registerRoutingRoutes(app, {
  findSession: async (authorization) => {
    const token = readBearer(authorization);
    if (!token) {
      return null;
    }
    return findActiveSession(token);
  },
  suggestPlaces,
  computeDrivingRoute,
});
registerGateway(app, bus.subscription);

app.get("/health", async (_request, reply) => {
  let postgres: "up" | "down" = "down";
  try {
    await pingDatabase();
    postgres = "up";
  } catch (error) {
    app.log.error({ err: error }, "postgres health check failed");
  }

  const nats = bus.connection.isClosed() ? "down" : "up";
  const ok = postgres === "up" && nats === "up";
  return reply.code(ok ? 200 : 503).send({ ok, postgres, nats });
});

async function shutdown(): Promise<void> {
  await app.close();
  await bus.connection.drain();
  await closeDatabase();
}

process.once("SIGINT", () => {
  void shutdown().then(() => process.exit(0));
});
process.once("SIGTERM", () => {
  void shutdown().then(() => process.exit(0));
});

await app.listen({ port, host });
