import test from "node:test";
import assert from "node:assert/strict";
import { commandBlocked, isWithin, toolsForPreset } from "./index.ts";

test("isWithin", () => {
  assert.ok(isWithin("/home/a", "/home/a/b/c"));
  assert.ok(isWithin("/home/a", "/home/a"));
  assert.ok(!isWithin("/home/a", "/home/ab"));
  assert.ok(!isWithin("/home/a", "/home/a/../b"));
  assert.ok(!isWithin("/home/a", "/etc/passwd"));
  assert.ok(isWithin("C:\\Users\\X", "c:\\users\\x\\docs"));
  assert.ok(!isWithin("", "/x"));
});

test("presets", () => {
  assert.ok(toolsForPreset("read_only").includes("list_directory"));
  assert.ok(!toolsForPreset("read_only").includes("write_file"));
  assert.ok(toolsForPreset("terminal").includes("start_process"));
  assert.deepEqual(toolsForPreset("custom"), []);
});

test("commandBlocked (igual ao relay)", () => {
  assert.equal(commandBlocked("ls && sudo rm x", ["rm"]), "rm");
  assert.equal(commandBlocked("git push --force", ["git push"]), "git push");
  assert.equal(commandBlocked("echo rm", ["rm"]), null);
});
