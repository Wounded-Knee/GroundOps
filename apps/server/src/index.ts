import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { connectBus, publishEnvelope } from "./bus.js";
import { setRealtimePublisher } from "./realtime.js";
import { closeDatabase, pingDatabase } from "./db.js";
import { registerGateway } from "./gateway.js";
import { migrateDatabase } from "./migrate.js";
import { readGoogleClientIds } from "./identity/google.js";
import { registerSessionRoutes } from "./identity/http.js";
import { registerRequestSession } from "./http/session.js";
import { registerRoutingRoutes } from "./routing/http.js";
import { computeDriveDuration, computeDrivingRoute, lookupAddress, suggestPlaces } from "./routing/google.js";
import { registerCalendarRoutes } from "./calendar/http.js";
import { registerLocalCors } from "./cors.js";
import { registerPlatformRoutes } from "./platform/http.js";
import { registerAvailabilityRoutes } from "./availability/http.js";
import { registerAddressBookRoutes } from "./addressBook/http.js";
import { startAvailabilityMaintenance } from "./availability/maintenance.js";

const googleClientIds = readGoogleClientIds();
if (googleClientIds.length === 0) {
  throw new Error(
    "At least one of GOOGLE_WEB_CLIENT_ID, GOOGLE_ANDROID_CLIENT_ID, or GOOGLE_IOS_CLIENT_ID is required",
  );
}

const port = Number(process.env.PORT ?? 3000);
const host = "0.0.0.0";

const app = Fastify({ logger: true });
const bus = await connectBus();
setRealtimePublisher(
  (envelope) => {
    publishEnvelope(bus.connection, envelope);
  },
  (error) => {
    app.log.error({ err: error }, "realtime publish failed");
  },
);

await migrateDatabase();
registerLocalCors(app);
registerRequestSession(app);
await app.register(websocket);
registerSessionRoutes(app, googleClientIds);
registerAvailabilityRoutes(app);
registerPlatformRoutes(app);
registerCalendarRoutes(
  app,
  {
    driveDuration: computeDriveDuration,
    lookupAddress,
    now: () => new Date(),
  },
  {
    computeDrivingRoute: (origin, destination, intermediates) =>
      computeDrivingRoute(origin, destination, intermediates),
  },
);
registerAddressBookRoutes(app);
registerRoutingRoutes(app, {
  suggestPlaces,
  computeDrivingRoute,
  lookupAddress,
});
registerGateway(app, bus.subscription);
const stopAvailabilityMaintenance = startAvailabilityMaintenance((error) => {
  app.log.error({ err: error }, "availability maintenance failed");
});

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
  stopAvailabilityMaintenance();
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
