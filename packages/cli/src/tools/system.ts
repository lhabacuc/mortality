import { execFileSync } from "node:child_process";
import { arch, cpus, freemem, hostname, platform, release, totalmem, uptime, userInfo } from "node:os";
import type { Tool } from "./util.ts";

export const systemTools: Record<string, Tool> = {
  get_system_info() {
    return {
      hostname: hostname(), platform: platform(), release: release(), arch: arch(),
      cpus: cpus().length, total_mem: totalmem(), free_mem: freemem(),
      uptime_seconds: Math.floor(uptime()), user: userInfo().username, node: process.version,
    };
  },

  list_system_processes() {
    const attempts: string[][] = [
      ["-eo", "pid,user,pcpu,pmem,comm", "--sort=-pcpu"],
      ["-Aco", "pid,user,pcpu,pmem,comm"],
    ];
    for (const args of attempts) {
      try {
        const out = execFileSync("ps", args, { encoding: "utf8", timeout: 5000, maxBuffer: 2_000_000 });
        const lines = out.trim().split("\n");
        return { header: lines[0], processes: lines.slice(1, 101), truncated: lines.length > 101 };
      } catch { /* tenta o formato seguinte */ }
    }
    throw new Error("Não foi possível listar processos neste sistema.");
  },
};
