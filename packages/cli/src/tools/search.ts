import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { checkPath, isBlocked, type JobPermissions, type Policy } from "../policy.ts";
import { optInt, optString, reqString, type Tool } from "./util.ts";

const MAX_SEARCHES = 10;
const MAX_SCANNED = 50_000;
const MAX_FILE = 1_000_000;
const MAX_SECONDS = 60;

interface Search {
  id: string; owner: string; results: unknown[]; done: boolean; stop: boolean;
  scanned: number; error?: string; startedAt: number;
}
const searches = new Map<string, Search>();

function mine(id: string, owner: string): Search {
  const s = searches.get(id);
  if (!s || s.owner !== owner) throw new Error("Pesquisa não encontrada.");
  return s;
}

async function run(s: Search, root: string, pattern: string, mode: "name" | "content", max: number, perms: JobPermissions, policy: Policy) {
  const needle = pattern.toLowerCase();
  const stack = [root];
  let tick = 0;
  try {
    while (stack.length && !s.stop && s.results.length < max) {
      if (s.scanned >= MAX_SCANNED || Date.now() - s.startedAt > MAX_SECONDS * 1000) break;
      const dir = stack.pop()!;
      let entries;
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (s.stop || s.results.length >= max) break;
        s.scanned++;
        const full = join(dir, e.name);
        if (e.isSymbolicLink()) continue; // nunca segue symlinks
        if (isBlocked(full, perms, policy)) continue; // bloqueado: nem entra nem lista
        if (e.isDirectory()) { stack.push(full); if (mode === "name" && e.name.toLowerCase().includes(needle)) s.results.push({ path: full, type: "dir" }); continue; }
        if (!e.isFile()) continue;
        if (mode === "name") {
          if (e.name.toLowerCase().includes(needle)) s.results.push({ path: full, type: "file" });
        } else {
          try {
            if (statSync(full).size > MAX_FILE) continue;
            const text = readFileSync(full, "utf8");
            if (text.includes("\0")) continue;
            const lines = text.split("\n");
            for (let i = 0; i < lines.length && s.results.length < max; i++) {
              if (lines[i].toLowerCase().includes(needle)) s.results.push({ path: full, line: i + 1, text: lines[i].slice(0, 200) });
            }
          } catch { /* ficheiro ilegível */ }
        }
        if (++tick % 200 === 0) await new Promise((r) => setImmediate(r)); // não bloqueia o poll
      }
    }
  } catch (e) {
    s.error = e instanceof Error ? e.message : "erro";
  } finally {
    s.done = true;
  }
}

export const searchTools: Record<string, Tool> = {
  start_search(a, ctx) {
    const root = checkPath(reqString(a, "path"), ctx.permissions, ctx.policy);
    const pattern = reqString(a, "pattern", 200);
    const mode = optString(a, "mode", 16) ?? "name";
    if (mode !== "name" && mode !== "content") throw new Error("`mode` tem de ser name ou content.");
    const max = optInt(a, "max_results", 1, 1000, 200);

    if (searches.size >= MAX_SEARCHES) {
      const old = [...searches.values()].find((s) => s.done);
      if (!old) throw new Error("Demasiadas pesquisas ativas.");
      searches.delete(old.id);
    }
    const s: Search = { id: randomUUID(), owner: ctx.clientId, results: [], done: false, stop: false, scanned: 0, startedAt: Date.now() };
    searches.set(s.id, s);
    void run(s, root, pattern, mode, max, ctx.permissions, ctx.policy);
    return { search_id: s.id };
  },

  get_search_results(a, ctx) {
    const s = mine(reqString(a, "search_id", 64), ctx.clientId);
    const offset = optInt(a, "offset", 0, 1_000_000, 0);
    const limit = optInt(a, "limit", 1, 500, 100);
    return {
      done: s.done, scanned: s.scanned, total: s.results.length, error: s.error,
      results: s.results.slice(offset, offset + limit),
    };
  },

  stop_search(a, ctx) {
    const s = mine(reqString(a, "search_id", 64), ctx.clientId);
    s.stop = true;
    return { stopped: true, total: s.results.length };
  },
};

export const _searchesForTest = searches;
