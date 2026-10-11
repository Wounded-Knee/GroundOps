import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { findActiveSession } from "../identity/sessions.js";
import { readBearer } from "../identity/tokens.js";
import {
  createCompany,
  createDirectoryUser,
  createFacility,
  deleteCompany,
  deleteDirectoryUser,
  deleteFacility,
  listCompanies,
  listFacilities,
  listUsers,
  updateCompany,
  updateDirectoryUser,
  updateFacility,
} from "./directory.js";

const nameBody = z.object({
  name: z.string(),
});

const userBody = z.object({
  displayName: z.string(),
  email: z.string().nullable(),
});

const idParams = z.object({
  id: z.uuid(),
});

type DirectoryResult = "invalid" | "missing" | "in-use";

export function registerPlatformRoutes(app: FastifyInstance): void {
  app.get("/companies", async (request, reply) => {
    const gate = await requireAdministrator(request.headers.authorization);
    if (gate === "unauthorized" || gate === "forbidden") {
      return sendGate(reply, gate);
    }
    return reply.send({ companies: await listCompanies() });
  });

  app.post("/companies", async (request, reply) => {
    const gate = await requireAdministrator(request.headers.authorization);
    if (gate === "unauthorized" || gate === "forbidden") {
      return sendGate(reply, gate);
    }
    const parsed = nameBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid request" });
    }
    const created = await createCompany(parsed.data.name);
    if (created === "invalid") {
      return reply.code(400).send({ error: "invalid request" });
    }
    return reply.code(201).send(created);
  });

  app.patch("/companies/:id", async (request, reply) => {
    const gate = await requireAdministrator(request.headers.authorization);
    if (gate === "unauthorized" || gate === "forbidden") {
      return sendGate(reply, gate);
    }
    const params = idParams.safeParse(request.params);
    const parsed = nameBody.safeParse(request.body);
    if (!params.success || !parsed.success) {
      return reply.code(400).send({ error: "invalid request" });
    }
    return sendResult(reply, await updateCompany(params.data.id, parsed.data.name));
  });

  app.delete("/companies/:id", async (request, reply) => {
    const gate = await requireAdministrator(request.headers.authorization);
    if (gate === "unauthorized" || gate === "forbidden") {
      return sendGate(reply, gate);
    }
    const params = idParams.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: "invalid request" });
    }
    return sendDeleted(reply, await deleteCompany(params.data.id));
  });

  app.get("/facilities", async (request, reply) => {
    const gate = await requireAdministrator(request.headers.authorization);
    if (gate === "unauthorized" || gate === "forbidden") {
      return sendGate(reply, gate);
    }
    return reply.send({ facilities: await listFacilities() });
  });

  app.post("/facilities", async (request, reply) => {
    const gate = await requireAdministrator(request.headers.authorization);
    if (gate === "unauthorized" || gate === "forbidden") {
      return sendGate(reply, gate);
    }
    const parsed = nameBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid request" });
    }
    const created = await createFacility(parsed.data.name);
    if (created === "invalid") {
      return reply.code(400).send({ error: "invalid request" });
    }
    return reply.code(201).send(created);
  });

  app.patch("/facilities/:id", async (request, reply) => {
    const gate = await requireAdministrator(request.headers.authorization);
    if (gate === "unauthorized" || gate === "forbidden") {
      return sendGate(reply, gate);
    }
    const params = idParams.safeParse(request.params);
    const parsed = nameBody.safeParse(request.body);
    if (!params.success || !parsed.success) {
      return reply.code(400).send({ error: "invalid request" });
    }
    return sendResult(reply, await updateFacility(params.data.id, parsed.data.name));
  });

  app.delete("/facilities/:id", async (request, reply) => {
    const gate = await requireAdministrator(request.headers.authorization);
    if (gate === "unauthorized" || gate === "forbidden") {
      return sendGate(reply, gate);
    }
    const params = idParams.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: "invalid request" });
    }
    return sendDeleted(reply, await deleteFacility(params.data.id));
  });

  app.get("/users", async (request, reply) => {
    const gate = await requireAdministrator(request.headers.authorization);
    if (gate === "unauthorized" || gate === "forbidden") {
      return sendGate(reply, gate);
    }
    return reply.send({ users: await listUsers() });
  });

  app.post("/users", async (request, reply) => {
    const gate = await requireAdministrator(request.headers.authorization);
    if (gate === "unauthorized" || gate === "forbidden") {
      return sendGate(reply, gate);
    }
    const parsed = userBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid request" });
    }
    const created = await createDirectoryUser(parsed.data.displayName, parsed.data.email);
    if (created === "invalid") {
      return reply.code(400).send({ error: "invalid request" });
    }
    return reply.code(201).send(created);
  });

  app.patch("/users/:id", async (request, reply) => {
    const gate = await requireAdministrator(request.headers.authorization);
    if (gate === "unauthorized" || gate === "forbidden") {
      return sendGate(reply, gate);
    }
    const params = idParams.safeParse(request.params);
    const parsed = userBody.safeParse(request.body);
    if (!params.success || !parsed.success) {
      return reply.code(400).send({ error: "invalid request" });
    }
    return sendResult(reply, await updateDirectoryUser(params.data.id, parsed.data.displayName, parsed.data.email));
  });

  app.delete("/users/:id", async (request, reply) => {
    const gate = await requireAdministrator(request.headers.authorization);
    if (gate === "unauthorized" || gate === "forbidden") {
      return sendGate(reply, gate);
    }
    const params = idParams.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: "invalid request" });
    }
    return sendDeleted(reply, await deleteDirectoryUser(gate.userId, params.data.id));
  });
}

async function requireAdministrator(
  authorization: string | string[] | undefined,
): Promise<{ userId: string } | "unauthorized" | "forbidden"> {
  const token = readBearer(headerValue(authorization));
  if (!token) {
    return "unauthorized";
  }
  const active = await findActiveSession(token);
  if (!active) {
    return "unauthorized";
  }
  if (!active.user.platformAdministrator) {
    return "forbidden";
  }
  return { userId: active.user.id };
}

function sendGate(reply: FastifyReply, gate: "unauthorized" | "forbidden") {
  if (gate === "unauthorized") {
    return reply.code(401).send({ error: "unauthorized" });
  }
  return reply.code(403).send({ error: "forbidden" });
}

function sendResult(reply: FastifyReply, result: DirectoryResult | { id: string }) {
  if (typeof result === "object") {
    return reply.send(result);
  }
  return sendFailure(reply, result);
}

function sendDeleted(reply: FastifyReply, result: "ok" | "missing" | "in-use") {
  if (result === "ok") {
    return reply.code(204).send();
  }
  return sendFailure(reply, result);
}

function sendFailure(reply: FastifyReply, result: DirectoryResult) {
  if (result === "invalid") {
    return reply.code(400).send({ error: "invalid request" });
  }
  if (result === "missing") {
    return reply.code(404).send({ error: "not found" });
  }
  return reply.code(409).send({ error: "in use" });
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}
