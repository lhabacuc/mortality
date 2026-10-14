import { and, eq } from "drizzle-orm";
import type { EffectivePermissions } from "@mortality/shared";
import { db, schema } from "./db";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class JobError extends Error {}

export async function runJob(p: {
  userId: string; deviceId: string; clientId: string; tool: string;
  args: Record<string, unknown>; permissions: EffectivePermissions;
  /** Resumo legível para o ecrã de aprovação (sem conteúdo de ficheiros). */
  approval?: { summary: string };
}): Promise<unknown> {
  const timeout = Number(process.env.JOB_TIMEOUT_SECONDS) > 0 ? Number(process.env.JOB_TIMEOUT_SECONDS) : 50;
  const approvalWindow = Number(process.env.APPROVAL_TIMEOUT_SECONDS) > 0 ? Number(process.env.APPROVAL_TIMEOUT_SECONDS) : 30;
  const deadline = Date.now() + timeout * 1000;
  const approvalDeadline = Date.now() + Math.min(approvalWindow, timeout - 5) * 1000;
  const [job] = await db().insert(schema.jobs).values({
    userId: p.userId, deviceId: p.deviceId, clientId: p.clientId, tool: p.tool,
    args: { args: p.args, permissions: p.permissions, summary: p.approval?.summary },
    status: p.approval ? "awaiting_approval" : "queued",
    expiresAt: new Date(deadline),
  }).returning({ id: schema.jobs.id });

  while (Date.now() < deadline) {
    await sleep(400);
    const [row] = await db().select({ status: schema.jobs.status, result: schema.jobs.result, error: schema.jobs.error })
      .from(schema.jobs).where(eq(schema.jobs.id, job.id)).limit(1);
    if (row.status === "done") return row.result;
    if (row.status === "error") throw new JobError(row.error ?? "erro no dispositivo");
    if (row.status === "denied") throw new JobError("Pedido negado pelo utilizador no painel.");
    if (row.status === "awaiting_approval" && Date.now() > approvalDeadline) {
      // Timeout de aprovação → negado (só se ainda estiver pendente).
      await db().update(schema.jobs).set({ status: "denied", error: "approval_timeout", completedAt: new Date() })
        .where(and(eq(schema.jobs.id, job.id), eq(schema.jobs.status, "awaiting_approval")));
      throw new JobError("Aprovação não concedida a tempo: pedido negado.");
    }
  }
  await db().update(schema.jobs).set({ status: "expired" }).where(eq(schema.jobs.id, job.id));
  throw new JobError("O dispositivo não respondeu a tempo.");
}
