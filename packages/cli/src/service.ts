import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { SERVICE, configDir } from "./config.ts";

// ── Geração de ficheiros (puras, testáveis em qualquer SO) ───────────────────
const q = (p: string) => `"${p.replace(/(["\\])/g, "\\$1").replace(/%/g, "%%")}"`;

/** systemd --user: caminhos absolutos resolvidos em tempo de instalação (nvm/volta/pnpm). */
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

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const LAUNCHD_LABEL = "com.mortality.relay";

/** launchd (LaunchAgent do utilizador): arranca no login e reinicia se falhar. */
export function generatePlist(nodePath: string, scriptPath: string, logPath: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(nodePath)}</string>
    <string>${xml(scriptPath)}</string>
    <string>run</string>
    <string>--service</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>${xml(logPath)}</string>
  <key>StandardErrorPath</key><string>${xml(logPath)}</string>
</dict>
</plist>
`;
}

export const TASK_NAME = "MortalityRelay";

/** Task Scheduler: tarefa ao iniciar sessão, com o nível mais baixo de privilégios. */
export function generateSchtasksCreate(nodePath: string, scriptPath: string): string[] {
  const tr = `"${nodePath}" "${scriptPath}" run --service`;
  return ["/Create", "/TN", TASK_NAME, "/TR", tr, "/SC", "ONLOGON", "/RL", "LIMITED", "/F"];
}

// ── Backends ────────────────────────────────────────────────────────────────
export interface Result { ok: boolean; out: string }
export interface Backend {
  name: "systemd" | "launchd" | "task-scheduler";
  install(nodePath: string, scriptPath: string): { ok: boolean; out: string; backup?: string; file?: string };
  isActive(): string;
  restart(): Result;
  stop(): Result;
  uninstall(): void;
  logs(follow: boolean): { cmd: string; args: string[] } | { file: string };
}

const run = (cmd: string, args: string[]): Result => {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return { ok: r.status === 0, out: (r.stdout || r.stderr || "").trim() };
};

export const logFile = () => join(configDir(), "relay.log");

function writeWithBackup(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  let backup: string | undefined;
  if (existsSync(path)) { backup = `${path}.bak`; copyFileSync(path, backup); }
  writeFileSync(path, content, { mode: 0o644 });
  return backup;
}

const systemd: Backend = {
  name: "systemd",
  install(node, script) {
    const file = unitPath();
    const backup = writeWithBackup(file, generateUnit(node, script));
    run("systemctl", ["--user", "daemon-reload"]);
    const r = run("systemctl", ["--user", "enable", "--now", SERVICE]);
    return { ...r, backup, file };
  },
  isActive: () => run("systemctl", ["--user", "is-active", SERVICE]).out,
  restart: () => run("systemctl", ["--user", "restart", SERVICE]),
  stop: () => run("systemctl", ["--user", "disable", "--now", SERVICE]),
  uninstall() {
    run("systemctl", ["--user", "disable", "--now", SERVICE]);
    rmSync(unitPath(), { force: true });
    run("systemctl", ["--user", "daemon-reload"]);
  },
  logs: (follow) => ({ cmd: "journalctl", args: ["--user", "-u", SERVICE, ...(follow ? ["-f"] : ["-n", "100"])] }),
};

const plistPath = () => join(homedir(), "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
const uid = () => String(process.getuid?.() ?? 501);

const launchd: Backend = {
  name: "launchd",
  install(node, script) {
    const file = plistPath();
    mkdirSync(configDir(), { recursive: true, mode: 0o700 });
    run("launchctl", ["bootout", `gui/${uid()}`, file]); // idempotente
    const backup = writeWithBackup(file, generatePlist(node, script, logFile()));
    const r = run("launchctl", ["bootstrap", `gui/${uid()}`, file]);
    return { ...r, backup, file };
  },
  isActive() {
    const r = run("launchctl", ["print", `gui/${uid()}/${LAUNCHD_LABEL}`]);
    return r.ok ? (/state = running/.test(r.out) ? "active" : "loaded") : "inactive";
  },
  restart: () => run("launchctl", ["kickstart", "-k", `gui/${uid()}/${LAUNCHD_LABEL}`]),
  stop: () => run("launchctl", ["bootout", `gui/${uid()}`, plistPath()]),
  uninstall() {
    run("launchctl", ["bootout", `gui/${uid()}`, plistPath()]);
    rmSync(plistPath(), { force: true });
  },
  logs: () => ({ file: logFile() }),
};

const windows: Backend = {
  name: "task-scheduler",
  install(node, script) {
    const r = run("schtasks", generateSchtasksCreate(node, script));
    if (r.ok) run("schtasks", ["/Run", "/TN", TASK_NAME]);
    return r;
  },
  isActive() {
    const r = run("schtasks", ["/Query", "/TN", TASK_NAME, "/FO", "LIST"]);
    if (!r.ok) return "inactive";
    return /Running/i.test(r.out) ? "active" : "loaded";
  },
  restart() {
    run("schtasks", ["/End", "/TN", TASK_NAME]);
    return run("schtasks", ["/Run", "/TN", TASK_NAME]);
  },
  stop: () => run("schtasks", ["/End", "/TN", TASK_NAME]),
  uninstall() {
    run("schtasks", ["/End", "/TN", TASK_NAME]);
    run("schtasks", ["/Delete", "/TN", TASK_NAME, "/F"]);
  },
  logs: () => ({ file: logFile() }),
};

export function unitPath() {
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "systemd", "user", `${SERVICE}.service`);
}

export function backend(platform: NodeJS.Platform = process.platform): Backend {
  if (platform === "darwin") return launchd;
  if (platform === "win32") return windows;
  return systemd;
}

export function lingerEnabled(): boolean | null {
  if (process.platform !== "linux") return null;
  const r = spawnSync("loginctl", ["show-user", process.env.USER || "", "-p", "Linger"], { encoding: "utf8" });
  if (r.status !== 0) return null;
  return /Linger=yes/.test(r.stdout);
}
