import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const VERSION = "0.3.0";
export const SERVICE = "mortality-relay";

export const configDir = () => join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "mortality");
export const devicePath = () => join(configDir(), "device.json");
export const policyPath = () => join(configDir(), "policy.json");
export const pausedPath = () => join(configDir(), "paused");

export interface DeviceConfig { server: string; device_token: string; device_id: string; device_name: string }

export function ensureConfigDir() {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  chmodSync(configDir(), 0o700);
}

export function saveDevice(c: DeviceConfig) {
  ensureConfigDir();
  writeFileSync(devicePath(), JSON.stringify(c, null, 2), { mode: 0o600 });
  chmodSync(devicePath(), 0o600);
}

export function loadDevice(): DeviceConfig | null {
  try { return JSON.parse(readFileSync(devicePath(), "utf8")) as DeviceConfig; } catch { return null; }
}

export const isPaused = () => existsSync(pausedPath());
export function setPaused(v: boolean) {
  ensureConfigDir();
  if (v) writeFileSync(pausedPath(), "", { mode: 0o600 }); else rmSync(pausedPath(), { force: true });
}
