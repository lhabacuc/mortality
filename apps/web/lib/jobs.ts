import { eq } from "drizzle-orm";
import type { EffectivePermissions } from "@mortality/shared";
import { db, schema } from "./db";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class JobError extends Error {}

export async function runJob(p: {
  userId: string; deviceId: string; clientId: string; tool: string;
  args: Record<string, unknown>; permissions: EffectivePermissions;
}): Promise<unknown> {
  const timeout = Number(process.env.JOB_TIMEOUT_SECONDS) > 0 ? Number(process.env.JOB_TIMEOUT_SECONDS) : 50;
  const deadline = Date.now() + timeout * 1000;
  const [job] = await db().insert(schema.jobs).values({
    userId: p.userId, deviceId: p.deviceId, clientId: p.clientId, tool: p.tool,
    args: { args: p.args, permissions: p.permissions }, status: "queued",
    expiresAt: new Date(deadline),
  }).returning({ id: schema.jobs.id });

  while (Date.now() < deadline) {
    await sleep(400);
    const [row] = await db().select({ status: schema.jobs.status, result: schema.jobs.result, error: schema.jobs.error })
      .from(schema.jobs).where(eq(schema.jobs.id, job.id)).limit(1);
    if (row.status === "done") return row.result;
    if (row.status === "error") throw new JobError(row.error ?? "erro no dispositivo");
    if (row.status === "denied") throw new JobError("Negado.");
  }
  await db().update(schema.jobs).set({ status: "expired" }).where(eq(schema.jobs.id, job.id));
  throw new JobError("O dispositivo não respondeu a tempo.");
}
