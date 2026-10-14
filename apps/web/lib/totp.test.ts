import test from "node:test";
import assert from "node:assert/strict";
import { base32Decode, base32Encode, decryptSecret, encryptSecret, hotp, newRecoveryCodes, otpauthUrl, verifyTotp } from "./totp.ts";

const SECRET = Buffer.from("12345678901234567890"); // RFC 6238 apêndice B

test("HOTP RFC 4226 (apêndice D)", () => {
  const exp = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
  exp.forEach((c, i) => assert.equal(hotp(SECRET, i), c));
});

test("TOTP RFC 6238 (SHA1, 8 dígitos)", () => {
  assert.equal(hotp(SECRET, Math.floor(59 / 30), 8), "94287082");
  assert.equal(hotp(SECRET, Math.floor(1111111109 / 30), 8), "07081804");
  assert.equal(hotp(SECRET, Math.floor(20000000000 / 30), 8), "65353130");
});

test("verifyTotp: janela, replay e formato", () => {
  const now = 1_700_000_000_000;
  const step = Math.floor(now / 1000 / 30);
  const code = hotp(SECRET, step);
  assert.equal(verifyTotp(SECRET, code, now), step);
  assert.equal(verifyTotp(SECRET, hotp(SECRET, step - 1), now), step - 1);   // ±1
  assert.equal(verifyTotp(SECRET, hotp(SECRET, step + 2), now), null);       // fora da janela
  assert.equal(verifyTotp(SECRET, code, now, step), null);                   // replay
  assert.equal(verifyTotp(SECRET, hotp(SECRET, step + 1), now, step), step + 1);
  assert.equal(verifyTotp(SECRET, "12345", now), null);
  assert.equal(verifyTotp(SECRET, "abcdef", now), null);
});

test("base32, otpauth, cifra e recovery codes", () => {
  assert.equal(base32Encode(Buffer.from("foobar")), "MZXW6YTBOI");
  assert.deepEqual(base32Decode("MZXW6YTBOI"), Buffer.from("foobar"));
  assert.deepEqual(base32Decode(base32Encode(SECRET)), SECRET);
  assert.match(otpauthUrl("Mortality", "a@b.c", "ABC"), /^otpauth:\/\/totp\/Mortality%3Aa%40b\.c\?secret=ABC&issuer=Mortality/);

  process.env.SESSION_SECRET = "s".repeat(40);
  const enc = encryptSecret(SECRET);
  assert.ok(!enc.includes(SECRET.toString("base64")));
  assert.deepEqual(decryptSecret(enc), SECRET);
  const bad = enc.split("."); bad[3] = Buffer.from("x".repeat(20)).toString("base64");
  assert.throws(() => decryptSecret(bad.join(".")));

  const codes = newRecoveryCodes();
  assert.equal(new Set(codes).size, 10);
  assert.match(codes[0], /^[A-Z0-9]{5}-[A-Z0-9]{5}$/);
});
