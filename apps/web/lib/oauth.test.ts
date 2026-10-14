import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  canonicalResource, isValidChallenge, parseScope, redirectMatches, s256, safeNext, validRedirectUri, verifyPkce,
} from "./oauth.ts";

test("PKCE S256 (vetor RFC 7636 apêndice B)", () => {
  const v = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  assert.equal(s256(v), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  assert.ok(verifyPkce(v, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"));
  assert.ok(!verifyPkce(v + "x", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"));
  assert.ok(!verifyPkce("curto", s256("curto")));
  assert.ok(isValidChallenge(createHash("sha256").update("x").digest("base64url")));
  assert.ok(!isValidChallenge("plain"));
});

test("redirect_uri: validação e correspondência", () => {
  assert.ok(validRedirectUri("https://claude.ai/api/mcp/auth_callback"));
  assert.ok(validRedirectUri("http://localhost:33418/callback"));
  assert.ok(validRedirectUri("cursor://anysphere.cursor-retrieval/oauth/callback"));
  assert.ok(!validRedirectUri("http://evil.example/cb"));
  assert.ok(!validRedirectUri("javascript:alert(1)"));
  assert.ok(!validRedirectUri("https://a.example/cb#frag"));
  assert.ok(!validRedirectUri("https://user:pw@a.example/cb"));

  const reg = ["https://a.example/cb", "http://127.0.0.1/cb"];
  assert.ok(redirectMatches(reg, "https://a.example/cb"));
  assert.ok(!redirectMatches(reg, "https://a.example/cb2"));
  assert.ok(!redirectMatches(reg, "https://a.example:444/cb"));
  assert.ok(redirectMatches(reg, "http://127.0.0.1:5555/cb")); // porta livre em loopback
  assert.ok(!redirectMatches(reg, "http://127.0.0.1:5555/outro"));
  assert.ok(!redirectMatches(["https://a.example/cb"], "http://localhost:1/cb"));
});

test("resource, scope, next", () => {
  assert.equal(canonicalResource("https://x.app/"), "https://x.app/api/mcp");
  assert.equal(parseScope(undefined), "mcp:tools");
  assert.equal(parseScope("mcp:tools"), "mcp:tools");
  assert.equal(parseScope("mcp:tools admin"), null);
  assert.equal(safeNext("/oauth/authorize?a=1"), "/oauth/authorize?a=1");
  assert.equal(safeNext("//evil.com"), null);
  assert.equal(safeNext("https://evil.com"), null);
  assert.equal(safeNext("/\\evil.com"), null);
});
