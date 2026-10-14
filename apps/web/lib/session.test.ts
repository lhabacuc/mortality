import test from "node:test";
import assert from "node:assert/strict";
import { decodePending, decodeSession, encodePending, encodeSession } from "./session-token.ts";

process.env.SESSION_SECRET = "a".repeat(40);
const uid = "11111111-1111-1111-1111-111111111111";

test("sessão válida, adulterada e expirada", () => {
  const t = encodeSession(uid, 1000);
  assert.equal(decodeSession(t, 2000), uid);
  assert.equal(decodeSession(t.replace(uid, uid.replace("1", "2")), 2000), null);
  assert.equal(decodeSession(t, 1000 + 8 * 24 * 3600 * 1000), null);
  assert.equal(decodeSession("lixo", 2000), null);
});

test("cookie de 2FA pendente nunca vale como sessão (e vice-versa)", () => {
  const p = encodePending(uid, 1000), s = encodeSession(uid, 1000);
  assert.equal(decodePending(p, 2000), uid);
  assert.equal(decodeSession(p, 2000), null);
  assert.equal(decodePending(s, 2000), null);
  assert.equal(decodePending(p, 1000 + 6 * 60 * 1000), null);
});
