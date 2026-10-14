import { z } from "zod";

const P = z.string().min(1).max(4096);
const device = z.string().max(80).optional().describe("Nome do dispositivo (opcional se só houver um)");
const sessionId = z.string().min(1).max(64);

export interface ToolDef {
  description: string;
  shape: z.ZodRawShape;
  readOnly: boolean;
  destructive?: boolean;
  /** Argumentos que são caminhos (validados contra allowed_dirs antes de ir para a fila). */
  paths?: string[];
  pathLists?: string[];
}

/** Tools que correm no relay. `list_devices`/`whoami` são resolvidas no servidor. */
export const RELAY_TOOLS: Record<string, ToolDef> = {
  ping_device: { description: "Verifica se o dispositivo responde.", shape: { device }, readOnly: true },
  list_directory: { description: "Lista ficheiros e pastas de um diretório.", shape: { path: P, device }, readOnly: true, paths: ["path"] },
  read_file: {
    description: "Lê um ficheiro de texto (por bytes: offset/length). Resultado truncado se grande.",
    shape: { path: P, offset: z.number().int().min(0).optional(), length: z.number().int().min(1).max(200_000).optional(), device },
    readOnly: true, paths: ["path"],
  },
  read_multiple_files: { description: "Lê até 20 ficheiros de texto.", shape: { paths: z.array(P).min(1).max(20), device }, readOnly: true, pathLists: ["paths"] },
  get_file_info: { description: "Metadados de um ficheiro ou pasta.", shape: { path: P, device }, readOnly: true, paths: ["path"] },
  start_search: {
    description: "Inicia uma pesquisa assíncrona por nome ou conteúdo (texto simples). Devolve search_id.",
    shape: { path: P, pattern: z.string().min(1).max(200), mode: z.enum(["name", "content"]).optional(), max_results: z.number().int().min(1).max(1000).optional(), device },
    readOnly: true, paths: ["path"],
  },
  get_search_results: {
    description: "Resultados (parciais ou finais) de uma pesquisa.",
    shape: { search_id: sessionId, offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(500).optional(), device },
    readOnly: true,
  },
  stop_search: { description: "Para uma pesquisa em curso.", shape: { search_id: sessionId, device }, readOnly: true },
  get_system_info: { description: "Informação do sistema (SO, CPU, memória).", shape: { device }, readOnly: true },
  list_system_processes: { description: "Lista os processos do sistema (top por CPU).", shape: { device }, readOnly: true },

  write_file: {
    description: "Escreve um ficheiro (overwrite ou append; máx. 1 MB).",
    shape: { path: P, content: z.string().max(1_000_000), mode: z.enum(["overwrite", "append"]).optional(), device },
    readOnly: false, destructive: true, paths: ["path"],
  },
  edit_block: {
    description: "Substitui um bloco de texto exato por outro; falha se `old` não for único.",
    shape: { path: P, old: z.string().min(1).max(1_000_000), new: z.string().max(1_000_000), device },
    readOnly: false, destructive: true, paths: ["path"],
  },
  create_directory: { description: "Cria um diretório (recursivo).", shape: { path: P, device }, readOnly: false, paths: ["path"] },
  move_file: {
    description: "Move/renomeia; falha se o destino existir.",
    shape: { source: P, destination: P, device }, readOnly: false, destructive: true, paths: ["source", "destination"],
  },

  start_process: {
    description: "Inicia um comando em background (sh -c). Devolve session_id e o output inicial.",
    shape: {
      command: z.string().min(1).max(8000), cwd: P.optional(),
      wait_ms: z.number().int().min(0).max(5000).optional(), timeout_seconds: z.number().int().min(1).max(3600).optional(), device,
    },
    readOnly: false, destructive: true, paths: ["cwd"],
  },
  interact_with_process: { description: "Envia texto para o stdin de uma sessão.", shape: { session_id: sessionId, input: z.string().max(100_000), device }, readOnly: false, destructive: true },
  read_process_output: {
    description: "Lê o output novo de uma sessão (incremental).",
    shape: { session_id: sessionId, wait_ms: z.number().int().min(0).max(10_000).optional(), device }, readOnly: true,
  },
  list_sessions: { description: "Lista as sessões de processo deste cliente.", shape: { device }, readOnly: true },
  terminate_session: { description: "Termina uma sessão (SIGTERM, depois SIGKILL).", shape: { session_id: sessionId, device }, readOnly: false, destructive: true },
};

const REDACT = new Set(["content", "old", "new", "input"]);

/** Resumo para o audit: sem conteúdo de ficheiros nem texto enviado a processos. */
export function summarizeArgs(args: Record<string, unknown>): string {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (REDACT.has(k)) out[k] = `<${typeof v === "string" ? v.length : 0} chars>`;
    else out[k] = typeof v === "string" ? v.slice(0, 120) : v;
  }
  return JSON.stringify(out);
}

export const MAX_RESPONSE_CHARS = 100_000;

/** O que o utilizador vê ao aprovar: o comando/caminho concretos, nunca o conteúdo de ficheiros. */
export function describeForApproval(tool: string, args: Record<string, unknown>): string {
  const str = (k: string, max = 1000) => (typeof args[k] === "string" ? String(args[k]).slice(0, max) : "");
  switch (tool) {
    case "start_process": return `Executar: ${str("command")}${args.cwd ? `\n(em ${str("cwd", 300)})` : ""}`;
    case "interact_with_process": return `Enviar ${str("input", 100_000).length} caracteres para a sessão ${str("session_id", 64)}`;
    case "write_file": return `Escrever ${str("content", 2_000_000).length} caracteres em ${str("path", 500)} (${str("mode", 16) || "overwrite"})`;
    case "edit_block": return `Editar ${str("path", 500)} (substituir ${str("old", 2_000_000).length} por ${str("new", 2_000_000).length} caracteres)`;
    case "move_file": return `Mover ${str("source", 500)} → ${str("destination", 500)}`;
    case "terminate_session": return `Terminar a sessão ${str("session_id", 64)}`;
    default: return `${tool} ${summarizeArgs(args)}`;
  }
}
