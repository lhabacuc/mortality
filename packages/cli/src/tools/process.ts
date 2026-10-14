import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { checkPath, commandBlocked } from "../policy.ts";
import { assertWritable, optInt, optString, reqString, type Tool, type ToolContext } from "./util.ts";

const READ_CHUNK = 64_000;
const GC_AFTER_MS = 15 * 60_000;

interface Session {
  id: string; owner: string; command: string; child: ChildProcess;
  buf: Buffer; dropped: number; readPos: number; cap: number;
  exited: boolean; code: number | null; signal: string | null; startedAt: number; endedAt?: number;
  timer?: NodeJS.Timeout;
}
const sessions = new Map<string, Session>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function push(s: Session, chunk: Buffer) {
  s.buf = Buffer.concat([s.buf, chunk]);
  if (s.buf.length > s.cap) {
    s.dropped += s.buf.length - s.cap;
    s.buf = s.buf.subarray(s.buf.length - s.cap);
  }
}

function drain(s: Session) {
  const lost = Math.max(0, s.dropped - s.readPos);
  const start = Math.max(s.readPos, s.dropped) - s.dropped;
  const slice = s.buf.subarray(start, start + READ_CHUNK);
  s.readPos = s.dropped + start + slice.length;
  return {
    output: slice.toString("utf8"), lost_bytes: lost,
    more: s.readPos < s.dropped + s.buf.length, running: !s.exited, exit_code: s.code, signal: s.signal,
  };
}

function mine(id: string, owner: string): Session {
  const s = sessions.get(id);
  if (!s || s.owner !== owner) throw new Error("Sessão não encontrada.");
  return s;
}

function kill(s: Session, sig: NodeJS.Signals) {
  try { process.kill(-s.child.pid!, sig); } catch { try { s.child.kill(sig); } catch { /* já terminou */ } }
}

function gc() {
  for (const s of sessions.values()) if (s.exited && Date.now() - (s.endedAt ?? 0) > GC_AFTER_MS) sessions.delete(s.id);
}

export function killAllSessions() {
  for (const s of sessions.values()) if (!s.exited) kill(s, "SIGKILL");
}

export const processTools: Record<string, Tool> = {
  async start_process(a, ctx: ToolContext) {
    assertWritable(ctx);
    gc();
    const command = reqString(a, "command", 8000);
    const hit = commandBlocked(command, [...ctx.permissions.blockedCommands, ...ctx.policy.blocked_commands]);
    if (hit) throw new Error(`Comando bloqueado: "${hit}".`);
    const live = [...sessions.values()].filter((s) => !s.exited).length;
    if (live >= ctx.policy.max_sessions) throw new Error(`Limite de ${ctx.policy.max_sessions} sessões atingido.`);

    const cwdArg = optString(a, "cwd");
    const cwd = checkPath(cwdArg ?? ctx.policy.allowed_dirs[0] ?? "", ctx.permissions, ctx.policy);
    const ttl = optInt(a, "timeout_seconds", 1, 3600, 3600);

    const win = process.platform === "win32";
    const child = spawn(win ? "cmd.exe" : "sh", win ? ["/c", command] : ["-c", command], {
      cwd, stdio: ["pipe", "pipe", "pipe"], detached: !win, env: process.env,
    });
    const s: Session = {
      id: randomUUID(), owner: ctx.clientId, command, child, buf: Buffer.alloc(0), dropped: 0, readPos: 0,
      cap: Math.max(10_000, ctx.policy.max_output_bytes), exited: false, code: null, signal: null, startedAt: Date.now(),
    };
    sessions.set(s.id, s);
    child.stdout!.on("data", (c: Buffer) => push(s, c));
    child.stderr!.on("data", (c: Buffer) => push(s, c));
    child.stdin!.on("error", () => {});
    child.on("error", (e) => push(s, Buffer.from(`[erro ao iniciar: ${e.message}]\n`)));
    child.on("close", (code, signal) => {
      s.exited = true; s.code = code; s.signal = signal; s.endedAt = Date.now();
      if (s.timer) clearTimeout(s.timer);
    });
    s.timer = setTimeout(() => kill(s, "SIGKILL"), ttl * 1000);

    const waitMs = optInt(a, "wait_ms", 0, 5000, 500);
    const until = Date.now() + waitMs;
    while (!s.exited && Date.now() < until) await sleep(50);
    return { session_id: s.id, pid: child.pid, ...drain(s) };
  },

  interact_with_process(a, ctx) {
    assertWritable(ctx);
    const s = mine(reqString(a, "session_id", 64), ctx.clientId);
    if (s.exited) throw new Error("A sessão já terminou.");
    const input = typeof a.input === "string" ? a.input : null;
    if (input === null || input.length > 100_000) throw new Error("`input` inválido.");
    s.child.stdin!.write(input);
    return { written: input.length };
  },

  async read_process_output(a, ctx) {
    const s = mine(reqString(a, "session_id", 64), ctx.clientId);
    const until = Date.now() + optInt(a, "wait_ms", 0, 10_000, 0);
    while (!s.exited && s.readPos >= s.dropped + s.buf.length && Date.now() < until) await sleep(100);
    return drain(s);
  },

  list_sessions(_a, ctx) {
    gc();
    return [...sessions.values()].filter((s) => s.owner === ctx.clientId).map((s) => ({
      session_id: s.id, pid: s.child.pid, command: s.command.slice(0, 200), running: !s.exited,
      exit_code: s.code, started_at: new Date(s.startedAt).toISOString(),
    }));
  },

  async terminate_session(a, ctx) {
    const s = mine(reqString(a, "session_id", 64), ctx.clientId);
    if (!s.exited) {
      kill(s, "SIGTERM");
      for (let i = 0; i < 30 && !s.exited; i++) await sleep(100);
      if (!s.exited) kill(s, "SIGKILL");
    }
    return { terminated: true, exit_code: s.code, signal: s.signal };
  },
};
