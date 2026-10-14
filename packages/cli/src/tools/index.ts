import { VERSION } from "../config.ts";
import { checkPath } from "../policy.ts";
import { readdirSync, statSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { fsTools } from "./fs.ts";
import { processTools } from "./process.ts";
import { searchTools } from "./search.ts";
import { systemTools } from "./system.ts";
import { reqString, type Tool } from "./util.ts";

export type { ToolContext } from "./util.ts";
const MAX_ENTRIES = 1000;

export const tools: Record<string, Tool> = {
  ping_device() {
    return { pong: true, time: new Date().toISOString(), relay_version: VERSION };
  },

  list_directory(args, ctx) {
    const dir = checkPath(reqString(args, "path"), ctx.permissions, ctx.policy);
    if (!statSync(dir).isDirectory()) throw new Error("Não é um diretório.");
    const names = readdirSync(dir).sort();
    const entries = names.slice(0, MAX_ENTRIES).map((name) => {
      try {
        const s = lstatSync(join(dir, name));
        return { name, type: s.isDirectory() ? "dir" : s.isSymbolicLink() ? "symlink" : "file", size: s.size };
      } catch { return { name, type: "unknown", size: 0 }; }
    });
    return { path: dir, entries, truncated: names.length > MAX_ENTRIES };
  },

  ...fsTools,
  ...systemTools,
  ...searchTools,
  ...processTools,
};
