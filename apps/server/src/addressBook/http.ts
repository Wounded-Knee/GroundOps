import type { AddressBookEntryPatch } from "@groundops/contracts";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { sendDomainResult } from "../http/result.js";
import { coordinateSchema } from "../http/schemas.js";
import { registerRequestSession } from "../http/session.js";
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
  latitude: coordinateSchema.shape.latitude,
  longitude: coordinateSchema.shape.longitude,
});

const patchBody = z.object({
  nickname: z.string().optional(),
  placeName: z.string().optional(),
  label: z.string().optional(),
  latitude: coordinateSchema.shape.latitude.optional(),
  longitude: coordinateSchema.shape.longitude.optional(),
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
  registerRequestSession(app);

  app.get("/address-book", async (request, reply) => {
    if (!request.session) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    return reply.send(await readAddressBook(request.session.user));
  });

  app.post("/address-book", async (request, reply) => {
    if (!request.session) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const parsed = createBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid request" });
    }
    const created = await createAddressBookEntry(request.session.user, parsed.data);
    if (created === "invalid") {
      return sendDomainResult(reply, created);
    }
    return reply.code(201).send(created);
  });

  app.post("/address-book/phone-stars", async (request, reply) => {
    if (!request.session) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const parsed = phoneStarBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid request" });
    }
    const starred = await starPhoneAddress(request.session.user, parsed.data);
    if (starred === "invalid") {
      return sendDomainResult(reply, starred);
    }
    return reply.code(204).send();
  });

  app.delete("/address-book/phone-stars", async (request, reply) => {
    if (!request.session) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const parsed = phoneStarBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid request" });
    }
    const cleared = await unstarPhoneAddress(request.session.user, parsed.data);
    if (cleared === "invalid") {
      return sendDomainResult(reply, cleared);
    }
    return reply.code(204).send();
  });

  app.post("/address-book/:id/company-share", async (request, reply) => {
    return shareRoute(request.session, request.params, reply, shareAddressBookEntryWithCompany);
  });

  app.delete("/address-book/:id/company-share", async (request, reply) => {
    return shareRoute(request.session, request.params, reply, unshareAddressBookEntryWithCompany);
  });

  app.post("/address-book/:id/platform-share", async (request, reply) => {
    return shareRoute(request.session, request.params, reply, shareAddressBookEntryWithPlatform);
  });

  app.delete("/address-book/:id/platform-share", async (request, reply) => {
    return shareRoute(request.session, request.params, reply, unshareAddressBookEntryWithPlatform);
  });

  app.patch("/address-book/:id", async (request, reply) => {
    if (!request.session) {
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
    const result = await updateAddressBookEntry(request.session.user, params.data.id, patch);
    if (typeof result === "string") {
      return sendDomainResult(reply, result);
    }
    return reply.send(result);
  });

  app.delete("/address-book/:id", async (request, reply) => {
    if (!request.session) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const params = idParams.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: "invalid request" });
    }
    const removed = await deleteAddressBookEntry(request.session.user, params.data.id);
    if (removed === "missing") {
      return sendDomainResult(reply, removed);
    }
    return reply.code(204).send();
  });
}

async function shareRoute(
  session: { user: Parameters<typeof shareAddressBookEntryWithCompany>[0] } | null,
  params: unknown,
  reply: FastifyReply,
  share: (
    person: Parameters<typeof shareAddressBookEntryWithCompany>[0],
    id: string,
  ) => ReturnType<typeof shareAddressBookEntryWithCompany>,
) {
  if (!session) {
    return reply.code(401).send({ error: "unauthorized" });
  }
  const parsed = idParams.safeParse(params);
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid request" });
  }
  const result = await share(session.user, parsed.data.id);
  if (typeof result === "string") {
    return sendDomainResult(reply, result);
  }
  return reply.send(result);
}
