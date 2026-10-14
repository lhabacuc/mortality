import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { SERVICE } from "./config.ts";

export const unitPath = () => join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "systemd", "user", `${SERVICE}.service`);

const q = (p: string) => `"${p.replace(/(["\\])/g, "\\$1").replace(/%/g, "%%")}"`;

/** Caminhos absolutos resolvidos em tempo de instalação (funciona com nvm/volta/pnpm). */
export function generateUnit(nodePath: string, scriptPath: string): string {
  return `[Unit]
Description=Mortality relay (user)
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
Type=simple
ExecStart=${q(nodePath)} ${q(scriptPath)} run --service
Restart=always
RestartSec=5
NoNewPrivileges=yes
PrivateTmp=yes

[Install]
WantedBy=default.target
`;
}

export function ctl(...args: string[]) {
  const r = spawnSync("systemctl", ["--user", ...args], { encoding: "utf8" });
  return { ok: r.status === 0, out: (r.stdout || r.stderr || "").trim() };
}

export function writeUnit(content: string): { backup?: string } {
  const p = unitPath();
  mkdirSync(dirname(p), { recursive: true });
  let backup: string | undefined;
  if (existsSync(p)) { backup = `${p}.bak`; copyFileSync(p, backup); }
  writeFileSync(p, content, { mode: 0o644 });
  return { backup };
}

export function removeUnit() { rmSync(unitPath(), { force: true }); }

export function lingerEnabled(): boolean | null {
  const r = spawnSync("loginctl", ["show-user", process.env.USER || "", "-p", "Linger"], { encoding: "utf8" });
  if (r.status !== 0) return null;
  return /Linger=yes/.test(r.stdout);
}
