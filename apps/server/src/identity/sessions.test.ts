import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { closeDatabase, db } from "../db.js";
import { session, user, userCredential } from "../schema.js";
import { createSession, findActiveSession, revokeActiveSession } from "./sessions.js";

after(async () => {
  await closeDatabase();
});

describe("sessions", () => {
  it("keeps one user per Google subject and revokes only the presented session", async () => {
    const subject = `test-${crypto.randomUUID()}`;
    const first = await createSession({
      sub: subject,
      displayName: "Test Person",
      email: "first@example.com",
    });

    try {
      const second = await createSession({
        sub: subject,
        displayName: "Updated Person",
        email: "second@example.com",
      });
      const other = await createSession({
        sub: `${subject}-other`,
        displayName: "Other Person",
        email: null,
      });

      assert.equal(second.user.id, first.user.id);
      assert.equal(second.user.displayName, "Updated Person");
      assert.equal(second.user.email, "second@example.com");
      assert.notEqual(other.user.id, first.user.id);

      assert.equal((await findActiveSession(first.token))?.user.id, first.user.id);
      assert.equal((await findActiveSession(second.token))?.user.displayName, "Updated Person");

      const revoked = await revokeActiveSession(first.token);
      assert.equal(typeof revoked, "string");
      assert.equal(await findActiveSession(first.token), null);
      assert.equal((await findActiveSession(second.token))?.sessionId !== undefined, true);
      assert.equal((await findActiveSession(other.token))?.user.id, other.user.id);

      await db.delete(session).where(eq(session.userId, other.user.id));
      await db.delete(userCredential).where(eq(userCredential.userId, other.user.id));
      await db.delete(user).where(eq(user.id, other.user.id));
    } finally {
      await db.delete(session).where(eq(session.userId, first.user.id));
      await db.delete(userCredential).where(eq(userCredential.userId, first.user.id));
      await db.delete(user).where(eq(user.id, first.user.id));
    }
  });
});
