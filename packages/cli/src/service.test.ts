import test from "node:test";
import assert from "node:assert/strict";
import { generateUnit } from "./service.ts";
import { checkPath, defaultPolicy, within } from "./policy.ts";
import { mkdtempSync, mkdirSync, symlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("unit usa caminhos absolutos e entre aspas", () => {
  const u = generateUnit("/home/u/.nvm/versions/node v24/bin/node", "/opt/m/dist/index.js");
  assert.match(u, /ExecStart="\/home\/u\/\.nvm\/versions\/node v24\/bin\/node" "\/opt\/m\/dist\/index\.js" run --service/);
  assert.match(u, /WantedBy=default\.target/);
});

test("within", () => {
  assert.ok(within("/a/b", "/a/b/c"));
  assert.ok(!within("/a/b", "/a/bc"));
  assert.ok(!within("/a/b", "/a"));
});

test("checkPath: interseção servidor ∩ local, symlinks e ..", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "mt-")));
  const ok = join(root, "ok"), other = join(root, "other");
  mkdirSync(ok); mkdirSync(other);
  symlinkSync(other, join(ok, "link"));
  const perms = { allowedDirs: [ok, other], blockedCommands: [], readOnly: false };
  const policy = defaultPolicy(ok); // local só permite `ok`
  assert.equal(checkPath(join(ok, "x"), perms, policy), join(ok, "x"));
  assert.throws(() => checkPath(other, perms, policy), /política local/);
  assert.throws(() => checkPath(join(ok, "link"), perms, policy), /política local/); // symlink escapa
  assert.throws(() => checkPath(join(ok, "..", "other"), perms, policy), /política local/);
  assert.throws(() => checkPath(join(ok, "x"), { ...perms, allowedDirs: [other] }, policy), /servidor/);
  assert.throws(() => checkPath("relativo", perms, policy), /absoluto/);
});
