import {
  closeSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, existsSync, writeFileSync, appendFileSync,
} from "node:fs";
import { checkPath } from "../policy.ts";
import { assertWritable, optInt, optString, reqString, type Tool, type ToolContext } from "./util.ts";

const MAX_READ = 200_000;
const MAX_WRITE = 1_000_000;

function readSlice(path: string, offset: number, length: number) {
  const st = statSync(path);
  if (!st.isFile()) throw new Error("Não é um ficheiro.");
  const buf = Buffer.alloc(Math.min(length, Math.max(0, st.size - offset)));
  const fd = openSync(path, "r");
  try { readSync(fd, buf, 0, buf.length, offset); } finally { closeSync(fd); }
  return {
    path, offset, bytes_read: buf.length, total_size: st.size,
    truncated: offset + buf.length < st.size, content: buf.toString("utf8"),
  };
}

const cap = (ctx: ToolContext) => Math.min(ctx.policy.max_output_bytes, MAX_READ);

export const fsTools: Record<string, Tool> = {
  read_file(a, ctx) {
    const p = checkPath(reqString(a, "path"), ctx.permissions, ctx.policy);
    const max = cap(ctx);
    return readSlice(p, optInt(a, "offset", 0, Number.MAX_SAFE_INTEGER, 0), optInt(a, "length", 1, max, max));
  },

  read_multiple_files(a, ctx) {
    const paths = a.paths;
    if (!Array.isArray(paths) || paths.length === 0 || paths.length > 20 || paths.some((p) => typeof p !== "string")) {
      throw new Error("`paths` tem de ser uma lista de 1 a 20 caminhos.");
    }
    const per = Math.floor(cap(ctx) / paths.length);
    return (paths as string[]).map((raw) => {
      try { return readSlice(checkPath(raw, ctx.permissions, ctx.policy), 0, per); }
      catch (e) { return { path: raw, error: e instanceof Error ? e.message : "erro" }; }
    });
  },

  get_file_info(a, ctx) {
    const p = checkPath(reqString(a, "path"), ctx.permissions, ctx.policy);
    const s = statSync(p);
    return {
      path: p, type: s.isDirectory() ? "dir" : s.isFile() ? "file" : "other", size: s.size,
      modified: s.mtime.toISOString(), created: s.birthtime.toISOString(), mode: (s.mode & 0o777).toString(8),
    };
  },

  write_file(a, ctx) {
    assertWritable(ctx);
    const p = checkPath(reqString(a, "path"), ctx.permissions, ctx.policy);
    const content = typeof a.content === "string" ? a.content : null;
    if (content === null) throw new Error("`content` em falta.");
    if (Buffer.byteLength(content) > MAX_WRITE) throw new Error("Conteúdo excede 1 MB.");
    const mode = optString(a, "mode", 16) ?? "overwrite";
    if (mode !== "overwrite" && mode !== "append") throw new Error("`mode` tem de ser overwrite ou append.");
    if (mode === "append") appendFileSync(p, content); else writeFileSync(p, content);
    return { path: p, bytes_written: Buffer.byteLength(content), mode };
  },

  edit_block(a, ctx) {
    assertWritable(ctx);
    const p = checkPath(reqString(a, "path"), ctx.permissions, ctx.policy);
    const oldText = reqString(a, "old", MAX_WRITE);
    if (typeof a.new !== "string") throw new Error("`new` em falta.");
    if (a.new.length > MAX_WRITE) throw new Error("`new` demasiado grande.");
    const text = readFileSync(p, "utf8");
    const count = text.split(oldText).length - 1;
    if (count === 0) throw new Error("Texto `old` não encontrado.");
    if (count > 1) throw new Error(`Texto \`old\` aparece ${count} vezes; tem de ser único.`);
    const idx = text.indexOf(oldText);
    writeFileSync(p, text.slice(0, idx) + a.new + text.slice(idx + oldText.length));
    return { path: p, replaced: 1 };
  },

  create_directory(a, ctx) {
    assertWritable(ctx);
    const p = checkPath(reqString(a, "path"), ctx.permissions, ctx.policy);
    mkdirSync(p, { recursive: true });
    return { path: p, created: true };
  },

  move_file(a, ctx) {
    assertWritable(ctx);
    const from = checkPath(reqString(a, "source"), ctx.permissions, ctx.policy);
    const to = checkPath(reqString(a, "destination"), ctx.permissions, ctx.policy);
    if (!existsSync(from)) throw new Error("Origem não existe.");
    if (existsSync(to)) throw new Error("Destino já existe.");
    renameSync(from, to);
    return { source: from, destination: to };
  },
};
