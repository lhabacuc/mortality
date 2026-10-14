import { currentUser } from "@/lib/session";
import { parseFilters, queryAudit } from "@/lib/audit-query";

// Mitiga injeção de fórmulas em folhas de cálculo e escapa aspas.
const cell = (v: unknown) => {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

export async function GET(req: Request) {
  const u = await currentUser();
  if (!u || u.role !== "admin" || u.mustChangePassword || u.status !== "active") return new Response("forbidden", { status: 403 });
  const rows = await queryAudit(parseFilters(new URL(req.url).searchParams, 5000));
  const head = ["created_at", "user_email", "actor", "action", "tool", "device", "ok", "ip", "args_summary"];
  const lines = rows.map(({ a, email, device }) => [
    a.createdAt.toISOString(), email, a.actor, a.action, a.tool, device, a.ok, a.ip, a.argsSummary,
  ].map(cell).join(","));
  return new Response([head.join(","), ...lines].join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="audit-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
}
