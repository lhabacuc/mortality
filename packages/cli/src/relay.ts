import { appendFileSync } from "node:fs";
import { arch, platform } from "node:os";
import { VERSION, isPaused, loadDevice } from "./config.ts";
import { loadPolicy, type JobPermissions } from "./policy.ts";
import { backend, logFile } from "./service.ts";
import { tools } from "./tools/index.ts";
import { killAllSessions } from "./tools/process.ts";

interface Job { id: string; clientId: string; tool: string; args: Record<string, unknown>; permissions: JobPermissions }

const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));
// Nunca regista tokens nem conteúdo. Em Windows (sem journald) também grava em ficheiro.
const log = (m: string) => {
  const line = `[${new Date().toISOString()}] ${m}`;
  console.log(line);
  if (process.platform === "win32") { try { appendFileSync(logFile(), line + "\n"); } catch { /* sem log */ } }
};

class Revoked extends Error {}

async function post(server: string, token: string, path: string, body: unknown) {
  const res = await fetch(new URL(path, server), {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 401 || res.status === 403) throw new Revoked();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<any>;
}

async function execute(job: Job): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  const policy = loadPolicy(); // relido a cada job: restrições locais têm efeito imediato
  const tool = tools[job.tool];
  if (!tool) return { ok: false, error: `Tool "${job.tool}" não suportada por este relay.` };
  try {
    const run = Promise.resolve().then(() => tool(job.args, { permissions: job.permissions, policy, clientId: job.clientId }));
    const timeout = new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error("Tempo limite excedido.")), policy.max_job_seconds * 1000));
    const result = await Promise.race([run, timeout]);
    const text = JSON.stringify(result) ?? "null";
    if (text.length > policy.max_output_bytes) return { ok: false, error: "Resultado excede max_output_bytes." };
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "erro" };
  }
}

export async function runRelay(opts: { service: boolean }) {
  const cfg = loadDevice();
  if (!cfg) { console.error("Dispositivo não emparelhado. Corre `mortality install`."); process.exit(1); }
  log(`relay ${VERSION} a ligar a ${cfg.server} como "${cfg.device_name}"`);

  const stop = () => { killAllSessions(); process.exit(0); };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  process.on("exit", killAllSessions);

  let failures = 0;
  for (;;) {
    try {
      const paused = isPaused();
      const r = await post(cfg.server, cfg.device_token, "/api/relay/poll", { paused, version: VERSION, os: `${platform()}-${arch()}` });
      failures = 0;
      if (r.status === "job" && !paused) {
        const job = r.job as Job;
        const out = await execute(job);
        log(`job ${job.id} ${job.tool} ${out.ok ? "ok" : "erro"}`);
        await post(cfg.server, cfg.device_token, "/api/relay/result", {
          job_id: job.id, ok: out.ok,
          ...(out.ok ? { result: out.result } : { error: out.error }),
        });
        continue;
      }
      await sleep(Math.min(Math.max(Number(r.next_poll_seconds) || 5, 0.25), 60));
    } catch (e) {
      if (e instanceof Revoked) {
        log("dispositivo revogado ou token inválido — a parar o serviço.");
        if (opts.service) backend().stop();
        process.exit(0);
      }
      failures++;
      const backoff = Math.min(60, 2 ** Math.min(failures, 6)) * (0.5 + Math.random() / 2);
      log(`erro de ligação (${e instanceof Error ? e.message : "?"}); nova tentativa em ${backoff.toFixed(0)}s`);
      await sleep(backoff);
    }
  }
}
