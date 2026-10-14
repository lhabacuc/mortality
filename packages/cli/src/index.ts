#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { realpathSync, rmSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { arch, hostname, platform } from "node:os";
import { fileURLToPath } from "node:url";
import {
  SERVICE, VERSION, configDir, isPaused, loadDevice, policyPath, saveDevice, setPaused,
} from "./config.ts";
import { defaultPolicy, loadPolicy, savePolicy } from "./policy.ts";
import { runRelay } from "./relay.ts";
import { ctl, generateUnit, lingerEnabled, removeUnit, writeUnit } from "./service.ts";
import { existsSync } from "node:fs";

const HELP = `mortality ${VERSION} — relay local (sem acesso a ferramentas; tudo é controlado no painel web)

  mortality install [--server URL] [--name NOME] [--dir DIR]
  mortality status [--json]
  mortality logs [-f]
  mortality pause | resume
  mortality restart
  mortality policy show|edit
  mortality uninstall
  mortality run [--service]
`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const die = (m: string): never => { console.error(m); process.exit(1); };

async function install(args: string[]) {
  const server = (flag(args, "server") || process.env.MORTALITY_SERVER || "").replace(/\/$/, "");
  if (!server) die("Indica o servidor: mortality install --server https://o-teu-painel.vercel.app");
  const name = flag(args, "name") || hostname();

  let dir = flag(args, "dir");
  if (!dir && !existsSync(policyPath())) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const a = await rl.question(`Diretório de trabalho permitido [${process.cwd()}]: `);
    rl.close();
    dir = a.trim() || process.cwd();
  }

  const res = await fetch(`${server}/api/oauth/device`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ device_name: name, os: `${platform()}-${arch()}` }),
  });
  if (!res.ok) die(`Falha ao pedir emparelhamento (HTTP ${res.status}).`);
  const dc = await res.json() as any;

  console.log(`\nCódigo: ${dc.user_code}\nAbre ${dc.verification_uri_complete}\nConfirma que o código coincide e aprova no painel.\n`);
  spawn("xdg-open", [dc.verification_uri_complete], { stdio: "ignore", detached: true }).on("error", () => {}).unref();

  let interval = Number(dc.interval) || 5;
  const deadline = Date.now() + Number(dc.expires_in) * 1000;
  let paired: any;
  while (!paired) {
    if (Date.now() > deadline) die("Código expirado.");
    await sleep(interval * 1000);
    const r = await fetch(`${server}/api/oauth/device/token`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ device_code: dc.device_code }),
    });
    const b = await r.json() as any;
    if (r.ok) paired = b;
    else if (b.error === "slow_down") interval += 5;
    else if (b.error !== "authorization_pending") die(`Emparelhamento falhou: ${b.error}`);
  }

  saveDevice({ server, device_token: paired.device_token, device_id: paired.device_id, device_name: paired.device_name });
  if (dir) savePolicy(defaultPolicy(dir));

  const script = realpathSync(fileURLToPath(import.meta.url));
  const { backup } = writeUnit(generateUnit(process.execPath, script));
  if (backup) console.log(`Unit anterior guardada em ${backup}`);
  ctl("daemon-reload");
  const en = ctl("enable", "--now", SERVICE);
  if (!en.ok) die(`Não consegui iniciar o serviço: ${en.out}`);

  console.log(`\nDispositivo "${paired.device_name}" emparelhado.`);
  console.log(`Serviço: ${ctl("is-active", SERVICE).out}   Painel: ${server}`);
  if (lingerEnabled() === false) {
    console.log(`\nAviso: sem "linger" o relay só corre com sessão aberta.\nPara correr após reboot sem login:  loginctl enable-linger $USER  (pode exigir privilégios)`);
  }
  console.log(`\nAviso: as restrições de diretórios/comandos são guardrails, NÃO uma sandbox. Para risco alto usa um container/VM.`);
}

async function status(json: boolean) {
  const cfg = loadDevice();
  const s = {
    paired: !!cfg, device: cfg?.device_name ?? null, server: cfg?.server ?? null,
    service: ctl("is-active", SERVICE).out, paused: isPaused(), policy: loadPolicy(),
  };
  if (json) return console.log(JSON.stringify(s, null, 2));
  console.log(`Dispositivo: ${s.device ?? "(não emparelhado)"}\nServidor:    ${s.server ?? "-"}\nServiço:     ${s.service}\nPausa local: ${s.paused ? "sim" : "não"}\nDiretórios:  ${s.policy.allowed_dirs.join(", ") || "(nenhum)"}\nSó leitura:  ${s.policy.read_only}`);
}

async function uninstall() {
  const cfg = loadDevice();
  if (cfg) {
    try {
      await fetch(`${cfg.server}/api/relay/revoke`, { method: "POST", headers: { authorization: `Bearer ${cfg.device_token}` } });
    } catch { console.error("Aviso: não consegui revogar no servidor; revoga o dispositivo no painel."); }
  }
  ctl("disable", "--now", SERVICE);
  removeUnit();
  ctl("daemon-reload");
  rmSync(configDir(), { recursive: true, force: true });
  console.log("Relay removido e configuração apagada.");
}

const [cmd, ...rest] = process.argv.slice(2);
switch (cmd) {
  case "install": await install(rest); break;
  case "status": await status(rest.includes("--json")); break;
  case "logs": spawn("journalctl", ["--user", "-u", SERVICE, ...(rest.includes("-f") ? ["-f"] : ["-n", "100"])], { stdio: "inherit" }); break;
  case "pause": setPaused(true); console.log("Relay pausado localmente."); break;
  case "resume": setPaused(false); console.log("Relay retomado."); break;
  case "restart": console.log(ctl("restart", SERVICE).ok ? "Reiniciado." : "Falhou."); break;
  case "policy":
    if (rest[0] === "show") console.log(readFileSync(policyPath(), "utf8"));
    else if (rest[0] === "edit") {
      spawnSync(process.env.EDITOR || "nano", [policyPath()], { stdio: "inherit" });
      try { JSON.parse(readFileSync(policyPath(), "utf8")); console.log("Política guardada."); }
      catch { die("JSON inválido: a política local passa a negar tudo até ser corrigida."); }
    } else die(HELP);
    break;
  case "uninstall": await uninstall(); break;
  case "run": await runRelay({ service: rest.includes("--service") }); break;
  default: console.log(HELP);
}
