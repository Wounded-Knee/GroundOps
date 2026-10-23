import type { AddressBookEntryPatch } from "@groundops/contracts";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { findActiveSession } from "../identity/sessions.js";
import { readBearer } from "../identity/tokens.js";
import {
  createAddressBookEntry,
  deleteAddressBookEntry,
  readAddressBook,
  shareAddressBookEntryWithCompany,
  shareAddressBookEntryWithPlatform,
  starPhoneAddress,
  unshareAddressBookEntryWithCompany,
  unshareAddressBookEntryWithPlatform,
  unstarPhoneAddress,
  updateAddressBookEntry,
} from "./addressBook.js";

const createBody = z.object({
  nickname: z.string().optional().default(""),
  placeName: z.string().optional().default(""),
  label: z.string(),
  latitude: z.number().gte(-90).lte(90),
  longitude: z.number().gte(-180).lte(180),
});

const patchBody = z.object({
  nickname: z.string().optional(),
  placeName: z.string().optional(),
  label: z.string().optional(),
  latitude: z.number().gte(-90).lte(90).optional(),
  longitude: z.number().gte(-180).lte(180).optional(),
  favorite: z.boolean().optional(),
});

const idParams = z.object({
  id: z.uuid(),
});

const phoneStarBody = z.object({
  contactId: z.string(),
  addressId: z.string(),
});

export function registerAddressBookRoutes(app: FastifyInstance): void {
  app.get("/address-book", async (request, reply) => {
    const active = await findPresentedSession(request.headers.authorization);
    if (!active) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    return reply.send(await readAddressBook(active.user));
  });

  app.post("/address-book", async (request, reply) => {
    const active = await findPresentedSession(request.headers.authorization);
    if (!active) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const parsed = createBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid request" });
    }
    const created = await createAddressBookEntry(active.user, parsed.data);
    if (created === "invalid") {
      return reply.code(400).send({ error: "invalid request" });
    }
    return reply.code(201).send(created);
  });

  app.post("/address-book/phone-stars", async (request, reply) => {
    const active = await findPresentedSession(request.headers.authorization);
    if (!active) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const parsed = phoneStarBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid request" });
    }
    const starred = await starPhoneAddress(active.user, parsed.data);
    if (starred === "invalid") {
      return reply.code(400).send({ error: "invalid request" });
    }
    return reply.code(204).send();
  });

  app.delete("/address-book/phone-stars", async (request, reply) => {
    const active = await findPresentedSession(request.headers.authorization);
    if (!active) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const parsed = phoneStarBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid request" });
    }
    const cleared = await unstarPhoneAddress(active.user, parsed.data);
    if (cleared === "invalid") {
      return reply.code(400).send({ error: "invalid request" });
    }
    return reply.code(204).send();
  });

  app.post("/address-book/:id/company-share", async (request, reply) => {
    return shareRoute(request.headers.authorization, request.params, reply, shareAddressBookEntryWithCompany);
  });

  app.delete("/address-book/:id/company-share", async (request, reply) => {
    return shareRoute(request.headers.authorization, request.params, reply, unshareAddressBookEntryWithCompany);
  });

  app.post("/address-book/:id/platform-share", async (request, reply) => {
    return shareRoute(request.headers.authorization, request.params, reply, shareAddressBookEntryWithPlatform);
  });

  app.delete("/address-book/:id/platform-share", async (request, reply) => {
    return shareRoute(request.headers.authorization, request.params, reply, unshareAddressBookEntryWithPlatform);
  });

  app.patch("/address-book/:id", async (request, reply) => {
    const active = await findPresentedSession(request.headers.authorization);
    if (!active) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const params = idParams.safeParse(request.params);
    const parsed = patchBody.safeParse(request.body);
    if (!params.success || !parsed.success) {
      return reply.code(400).send({ error: "invalid request" });
    }
    const patch: AddressBookEntryPatch = {};
    if (parsed.data.nickname !== undefined) {
      patch.nickname = parsed.data.nickname;
    }
    if (parsed.data.placeName !== undefined) {
      patch.placeName = parsed.data.placeName;
    }
    if (parsed.data.label !== undefined) {
      patch.label = parsed.data.label;
    }
    if (parsed.data.latitude !== undefined) {
      patch.latitude = parsed.data.latitude;
    }
    if (parsed.data.longitude !== undefined) {
      patch.longitude = parsed.data.longitude;
    }
    if (parsed.data.favorite !== undefined) {
      patch.favorite = parsed.data.favorite;
    }
    return sendEntry(reply, await updateAddressBookEntry(active.user, params.data.id, patch));
  });

  app.delete("/address-book/:id", async (request, reply) => {
    const active = await findPresentedSession(request.headers.authorization);
    if (!active) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const params = idParams.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: "invalid request" });
    }
    const removed = await deleteAddressBookEntry(active.user, params.data.id);
    if (removed === "missing") {
      return reply.code(404).send({ error: "not found" });
    }
    return reply.code(204).send();
  });
}

async function shareRoute(
  authorization: string | string[] | undefined,
  params: unknown,
  reply: FastifyReply,
  share: (person: Parameters<typeof shareAddressBookEntryWithCompany>[0], id: string) => ReturnType<typeof shareAddressBookEntryWithCompany>,
) {
  const active = await findPresentedSession(authorization);
  if (!active) {
    return reply.code(401).send({ error: "unauthorized" });
  }
  const parsed = idParams.safeParse(params);
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid request" });
  }
  const result = await share(active.user, parsed.data.id);
  if (result === "missing") {
    return reply.code(404).send({ error: "not found" });
  }
  if (result === "forbidden") {
    return reply.code(403).send({ error: "forbidden" });
  }
  return reply.send(result);
}

function sendEntry(
  reply: FastifyReply,
  result: Awaited<ReturnType<typeof updateAddressBookEntry>>,
) {
  if (result === "invalid") {
    return reply.code(400).send({ error: "invalid request" });
  }
  if (result === "missing") {
    return reply.code(404).send({ error: "not found" });
  }
  return reply.send(result);
}

async function findPresentedSession(authorization: string | string[] | undefined) {
  const token = readBearer(oneHeader(authorization));
  if (!token) {
    return null;
  }
  return findActiveSession(token);
}

function oneHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
