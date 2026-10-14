import test from "node:test";
import assert from "node:assert/strict";
import { decodeSession, encodeSession } from "./session-token.ts";

process.env.SESSION_SECRET = "a".repeat(40);
const uid = "11111111-1111-1111-1111-111111111111";

test("sessão válida, adulterada e expirada", () => {
  const t = encodeSession(uid, 1000);
  assert.equal(decodeSession(t, 2000), uid);
  assert.equal(decodeSession(t.replace(uid, uid.replace("1", "2")), 2000), null);
  assert.equal(decodeSession(t, 1000 + 8 * 24 * 3600 * 1000), null);
  assert.equal(decodeSession("lixo", 2000), null);
});
