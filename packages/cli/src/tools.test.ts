import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tools } from "./tools/index.ts";
import { killAllSessions } from "./tools/process.ts";
import { commandBlocked, defaultPolicy } from "./policy.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "mt-tools-")));
const ctx = (over: Record<string, unknown> = {}) => ({
  permissions: { allowedDirs: [root], blockedCommands: [], readOnly: false },
  policy: defaultPolicy(root), clientId: "c1", ...over,
}) as any;
const call = async (name: string, args: Record<string, unknown>, c = ctx()) => tools[name](args, c);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("commandBlocked", () => {
  assert.equal(commandBlocked("rm -rf /", ["rm"]), "rm");
  assert.equal(commandBlocked("ls && sudo rm x", ["rm"]), "rm");
  assert.equal(commandBlocked("/bin/rm x", ["rm"]), "rm");
  assert.equal(commandBlocked("echo $(rm x)", ["rm"]), "rm");
  assert.equal(commandBlocked("git push --force", ["git push"]), "git push");
  assert.equal(commandBlocked("git status", ["git push"]), null);
  assert.equal(commandBlocked("echo rm", ["rm"]), null);
  assert.equal(commandBlocked("anything", []), null);
});

test("ficheiros: write/read/edit/move/mkdir + limites", async () => {
  const f = join(root, "a.txt");
  await call("write_file", { path: f, content: "olá mundo mundo" });
  assert.equal((await call("read_file", { path: f }) as any).content, "olá mundo mundo");
  await assert.rejects(call("edit_block", { path: f, old: "mundo", new: "x" }), /2 vezes/);
  await assert.rejects(call("edit_block", { path: f, old: "nada", new: "x" }), /não encontrado/);
  await call("edit_block", { path: f, old: "olá", new: "oi" });
  assert.equal(readFileSync(f, "utf8"), "oi mundo mundo");
  await call("write_file", { path: f, content: "!", mode: "append" });
  const part = await call("read_file", { path: f, offset: 3, length: 5 }) as any;
  assert.equal(part.content, "mundo");
  assert.equal(part.truncated, true);

  await call("create_directory", { path: join(root, "d/e") });
  await call("move_file", { source: f, destination: join(root, "d/e/b.txt") });
  assert.ok(existsSync(join(root, "d/e/b.txt")));
  await assert.rejects(call("move_file", { source: join(root, "d/e/b.txt"), destination: "/tmp/fora-xyz" }), /fora/);
  const info = await call("get_file_info", { path: join(root, "d") }) as any;
  assert.equal(info.type, "dir");
  const multi = await call("read_multiple_files", { paths: [join(root, "d/e/b.txt"), "/etc/passwd"] }) as any[];
  assert.ok(multi[0].content);
  assert.match(multi[1].error, /fora/);
});

test("só leitura (grant ou política local) bloqueia escrita e processos", async () => {
  for (const c of [ctx({ permissions: { allowedDirs: [root], blockedCommands: [], readOnly: true } }),
                   ctx({ policy: { ...defaultPolicy(root), read_only: true } })]) {
    await assert.rejects(call("write_file", { path: join(root, "z"), content: "x" }, c), /só leitura/);
    await assert.rejects(call("create_directory", { path: join(root, "zz") }, c), /só leitura/);
    await assert.rejects(call("start_process", { command: "echo hi" }, c), /só leitura/);
  }
  assert.equal(existsSync(join(root, "z")), false);
});

test("pesquisa por nome e conteúdo, com posse por cliente", async () => {
  writeFileSync(join(root, "d/needle.txt"), "linha1\nO Segredo está aqui\n");
  const { search_id } = await call("start_search", { path: root, pattern: "needle" }) as any;
  let r: any;
  for (let i = 0; i < 50; i++) { r = await call("get_search_results", { search_id }); if (r.done) break; await sleep(50); }
  assert.ok(r.done);
  assert.ok(r.results.some((x: any) => x.path.endsWith("needle.txt")));

  const c = await call("start_search", { path: root, pattern: "segredo", mode: "content" }) as any;
  for (let i = 0; i < 50; i++) { r = await call("get_search_results", { search_id: c.search_id }); if (r.done) break; await sleep(50); }
  assert.equal(r.results[0].line, 2);

  await assert.rejects(call("get_search_results", { search_id }, ctx({ clientId: "outro" })), /não encontrada/);
  await assert.rejects(call("start_search", { path: "/etc", pattern: "x" }), /fora/);
});

test("processos: output, interação, posse, blocklist, terminação", async () => {
  const start = await call("start_process", { command: "echo ola; sleep 30", wait_ms: 800 }) as any;
  assert.match(start.output, /ola/);
  assert.equal(start.running, true);

  await assert.rejects(call("read_process_output", { session_id: start.session_id }, ctx({ clientId: "outro" })), /não encontrada/);
  const list = await call("list_sessions", {}) as any[];
  assert.equal(list.length >= 1, true);
  assert.equal((await call("list_sessions", {}, ctx({ clientId: "outro" })) as any[]).length, 0);

  const t = await call("terminate_session", { session_id: start.session_id }) as any;
  assert.equal(t.terminated, true);
  assert.equal((await call("read_process_output", { session_id: start.session_id }) as any).running, false);

  const cat = await call("start_process", { command: "cat", wait_ms: 100 }) as any;
  await call("interact_with_process", { session_id: cat.session_id, input: "eco\n" });
  const out = await call("read_process_output", { session_id: cat.session_id, wait_ms: 3000 }) as any;
  assert.match(out.output, /eco/);
  await call("terminate_session", { session_id: cat.session_id });

  await assert.rejects(call("start_process", { command: "rm -rf x" }, ctx({
    permissions: { allowedDirs: [root], blockedCommands: ["rm"], readOnly: false } })), /bloqueado/);
  await assert.rejects(call("start_process", { command: "ls", cwd: "/etc" }), /fora/);
});

test("buffer circular descarta o mais antigo e reporta lost_bytes", async () => {
  const c = ctx({ policy: { ...defaultPolicy(root), max_output_bytes: 10_000 } });
  const s = await call("start_process", { command: "head -c 50000 /dev/zero | tr '\\0' x", wait_ms: 2000 }, c) as any;
  assert.equal(s.output.length <= 10_000, true);
  assert.equal(s.lost_bytes, 40_000); // 50 000 produzidos, 10 000 retidos
  const next = await call("read_process_output", { session_id: s.session_id }, c) as any;
  assert.equal(next.running, false);
  assert.equal(next.exit_code, 0);
});

test("limite de sessões", async () => {
  const c = ctx({ policy: { ...defaultPolicy(root), max_sessions: 1 } });
  const a = await call("start_process", { command: "sleep 30", wait_ms: 0 }, c) as any;
  await assert.rejects(call("start_process", { command: "sleep 30", wait_ms: 0 }, c), /Limite/);
  await call("terminate_session", { session_id: a.session_id }, c);
});

test("sistema", async () => {
  assert.equal(typeof (await call("get_system_info", {}) as any).hostname, "string");
  assert.ok(((await call("list_system_processes", {}) as any).processes).length > 0);
});

test.after(() => killAllSessions());
