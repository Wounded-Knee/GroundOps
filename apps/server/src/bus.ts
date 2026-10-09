import { realtimeSubject, type RealtimeEnvelope } from "@groundops/contracts";
import { connect, type NatsConnection, type Subscription } from "@nats-io/transport-node";

export type Bus = {
  connection: NatsConnection;
  subscription: Subscription;
};

export function publishEnvelope(connection: NatsConnection, envelope: RealtimeEnvelope): void {
  connection.publish(realtimeSubject, JSON.stringify(envelope));
}

export async function connectBus(): Promise<Bus> {
  const servers = process.env.NATS_URL;
  if (!servers) {
    throw new Error("NATS_URL is required");
  }

  const connection = await connect({ servers });
  const subscription = connection.subscribe(realtimeSubject);
  return { connection, subscription };
}
