import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkPath, defaultPolicy } from "./policy.ts";
import { tools } from "./tools/index.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "mt-dirs-")));
const ok = join(root, "projeto"), secret = join(ok, "segredos"), outside = join(root, "fora");
mkdirSync(secret, { recursive: true }); mkdirSync(outside);
writeFileSync(join(ok, "a.txt"), "ola"); writeFileSync(join(secret, "chave.txt"), "TOP-SECRET-VALUE"); writeFileSync(join(outside, "x.txt"), "x");

const perms = (o: Record<string, unknown> = {}) => ({ allowedDirs: [ok], blockedDirs: [], allowAllDirs: false, blockedCommands: [], readOnly: false, ...o }) as any;
const ctx = (p = perms(), policy = defaultPolicy(ok)) => ({ permissions: p, policy, clientId: "c" }) as any;

test("bloqueio vence a permissão (servidor)", () => {
  const p = perms({ blockedDirs: [secret] });
  assert.equal(checkPath(join(ok, "a.txt"), p, defaultPolicy(ok)), join(ok, "a.txt"));
  assert.throws(() => checkPath(join(secret, "chave.txt"), p, defaultPolicy(ok)), /bloqueado pelo servidor/);
  assert.throws(() => checkPath(secret, p, defaultPolicy(ok)), /bloqueado pelo servidor/);
  assert.throws(() => checkPath(join(ok, "x", "..", "segredos", "chave.txt"), p, defaultPolicy(ok)), /bloqueado/);
});

test("bloqueio local vence mesmo com tudo permitido", () => {
  const policy = { ...defaultPolicy(ok), allow_all_dirs: true, blocked_dirs: [secret] };
  assert.throws(() => checkPath(join(secret, "chave.txt"), perms({ allowAllDirs: true }), policy), /bloqueado pela política local/);
});

test("symlink num diretório permitido para um bloqueado continua bloqueado", () => {
  const link = join(ok, "atalho");
  symlinkSync(secret, link);
  assert.throws(() => checkPath(join(link, "chave.txt"), perms({ blockedDirs: [secret] }), defaultPolicy(ok)), /bloqueado/);
  // e um symlink cujo ALVO é o diretório bloqueado, mas bloqueado via o próprio link
  assert.throws(() => checkPath(link, perms({ blockedDirs: [link] }), defaultPolicy(ok)), /bloqueado/);
});

test("todos os diretórios: servidor e local têm de concordar", () => {
  const all = perms({ allowAllDirs: true, allowedDirs: [] });
  // local restrito → continua a limitar
  assert.throws(() => checkPath(join(outside, "x.txt"), all, defaultPolicy(ok)), /política local/);
  // local aberto → passa
  const open = { ...defaultPolicy(ok), allow_all_dirs: true };
  assert.equal(checkPath(join(outside, "x.txt"), all, open), join(outside, "x.txt"));
  // local aberto mas servidor restrito → servidor limita
  assert.throws(() => checkPath(join(outside, "x.txt"), perms(), open), /servidor/);
  // relativo continua recusado
  assert.throws(() => checkPath("x.txt", all, open), /absoluto/);
});

test("list_directory não revela diretórios bloqueados", async () => {
  const r = await tools.list_directory({ path: ok }, ctx(perms({ blockedDirs: [secret] }))) as any;
  assert.ok(r.entries.some((e: any) => e.name === "a.txt"));
  assert.ok(!r.entries.some((e: any) => e.name === "segredos"));
});

test("pesquisa por conteúdo não entra em diretórios bloqueados", async () => {
  const c = ctx(perms({ blockedDirs: [secret] }));
  const { search_id } = await tools.start_search({ path: ok, pattern: "TOP-SECRET", mode: "content" }, c) as any;
  let r: any;
  for (let i = 0; i < 50; i++) { r = await tools.get_search_results({ search_id }, c); if (r.done) break; await new Promise((s) => setTimeout(s, 40)); }
  assert.ok(r.done);
  assert.equal(r.results.length, 0);
  // controlo: sem bloqueio encontra
  const c2 = ctx();
  const s2 = await tools.start_search({ path: ok, pattern: "TOP-SECRET", mode: "content" }, c2) as any;
  for (let i = 0; i < 50; i++) { r = await tools.get_search_results({ search_id: s2.search_id }, c2); if (r.done) break; await new Promise((s) => setTimeout(s, 40)); }
  assert.ok(r.results.length >= 1);
});

test("read_file recusa ficheiro bloqueado", () => {
  assert.throws(() => tools.read_file({ path: join(secret, "chave.txt") }, ctx(perms({ blockedDirs: [secret] }))), /bloqueado/);
});
