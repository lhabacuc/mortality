import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { installScript, safeOrigin } from "./install-script.ts";

test("safeOrigin recusa metacaracteres de shell", () => {
  assert.equal(safeOrigin("https://mortality-mcp.vercel.app"), "https://mortality-mcp.vercel.app");
  assert.equal(safeOrigin("http://localhost:3000"), "http://localhost:3000");
  assert.equal(safeOrigin("https://x.app'; rm -rf ~; echo '"), null);
  assert.equal(safeOrigin("https://x.app/$(id)"), null);
  assert.equal(safeOrigin("javascript:alert(1)"), null);
});

test("o script gerado tem sintaxe bash válida e embute a origem", () => {
  const s = installScript("https://exemplo.app");
  assert.match(s, /^#!\/usr\/bin\/env bash/);
  assert.match(s, /ORIGIN='https:\/\/exemplo\.app'/);
  const r = spawnSync("bash", ["-n"], { input: s, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});
