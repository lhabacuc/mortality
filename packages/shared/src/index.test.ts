import test from "node:test";
import assert from "node:assert/strict";
import { checkCeiling, ceilingTools, commandBlocked, isWithin, pathAllowed, toolsForPreset, versionAtLeast } from "./index.ts";

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

test("tetos do admin", () => {
  assert.equal(checkCeiling({ maxPreset: "terminal", disabledTools: [] }, { preset: "terminal" }), null);
  assert.match(checkCeiling({ maxPreset: "read_only", disabledTools: [] }, { preset: "read_write" })!, /limite máximo/);
  assert.match(checkCeiling({ maxPreset: "terminal", disabledTools: ["start_process"] }, { preset: "terminal" })!, /proibidas/);
  assert.match(checkCeiling({ maxPreset: "read_write", disabledTools: [] }, { preset: "custom", tools: ["read_file", "start_process"] })!, /start_process/);
  assert.equal(checkCeiling({ maxPreset: "read_write", disabledTools: [] }, { preset: "custom", tools: ["read_file"] }), null);
  assert.ok(!ceilingTools("read_only", []).includes("write_file"));
  assert.ok(!ceilingTools("terminal", ["move_file"]).includes("move_file"));
  assert.deepEqual(ceilingTools("lixo", []).includes("write_file"), false); // desconhecido → fail closed
});

test("pathAllowed: bloqueio vence; todos os diretórios; fora", () => {
  const p = { allowedDirs: ["/home/a"], blockedDirs: ["/home/a/segredos"], allowAllDirs: false };
  assert.deepEqual(pathAllowed(p, "/home/a/x"), { ok: true });
  assert.deepEqual(pathAllowed(p, "/home/a/segredos/k"), { ok: false, reason: "blocked" });
  assert.deepEqual(pathAllowed(p, "/home/a/segredos"), { ok: false, reason: "blocked" });
  assert.deepEqual(pathAllowed(p, "/etc/passwd"), { ok: false, reason: "outside" });
  const all = { allowedDirs: [], blockedDirs: ["/etc"], allowAllDirs: true };
  assert.deepEqual(pathAllowed(all, "/var/log/x"), { ok: true });
  assert.deepEqual(pathAllowed(all, "/etc/shadow"), { ok: false, reason: "blocked" });
  assert.deepEqual(pathAllowed({ ...all, blockedDirs: ["/home/a/.ssh"] }, "/home/a/../a/.ssh/id"), { ok: false, reason: "blocked" });
});

test("versionAtLeast", () => {
  assert.ok(versionAtLeast("0.3.0", "0.3.0"));
  assert.ok(versionAtLeast("0.10.0", "0.3.0"));
  assert.ok(versionAtLeast("1.0.0", "0.3.0"));
  assert.ok(!versionAtLeast("0.2.9", "0.3.0"));
  assert.ok(!versionAtLeast(null, "0.3.0"));
  assert.ok(!versionAtLeast("lixo", "0.3.0"));
});

test("sudo_for_all: todas as tools, acima de terminal, e só com teto explícito", () => {
  assert.deepEqual(new Set(toolsForPreset("sudo_for_all")), new Set(toolsForPreset("terminal")));
  assert.match(checkCeiling({ maxPreset: "terminal", disabledTools: [] }, { preset: "sudo_for_all" })!, /limite máximo/);
  assert.equal(checkCeiling({ maxPreset: "sudo_for_all", disabledTools: [] }, { preset: "sudo_for_all" }), null);
  assert.equal(checkCeiling({ maxPreset: "sudo_for_all", disabledTools: [] }, { preset: "terminal" }), null);
  // tool proibida pelo admin continua proibida mesmo em sudo
  assert.match(checkCeiling({ maxPreset: "sudo_for_all", disabledTools: ["move_file"] }, { preset: "sudo_for_all" })!, /proibidas/);
});
