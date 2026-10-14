import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "./password.ts";

test("hash/verify", async () => {
  const h = await hashPassword("segredo-123");
  assert.ok(h.startsWith("scrypt$"));
  assert.equal(await verifyPassword("segredo-123", h), true);
  assert.equal(await verifyPassword("errada", h), false);
  assert.equal(await verifyPassword("x", "lixo"), false);
});
