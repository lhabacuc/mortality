"use server";

import { and, eq, gt } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "./audit";
import { db, schema } from "./db";
import { requireUser } from "./guard";

const Op = z.object({ jobId: z.string().uuid(), decision: z.enum(["approve", "deny"]) });

export async function decideApproval(form: FormData) {
  const user = await requireUser();
  const { jobId, decision } = Op.parse(Object.fromEntries(form));
  // Só o dono do job, só se ainda pendente e não expirado.
  const res = await db().update(schema.jobs).set(
    decision === "approve" ? { status: "queued" } : { status: "denied", error: "denied_by_user", completedAt: new Date() },
  ).where(and(
    eq(schema.jobs.id, jobId), eq(schema.jobs.userId, user.id),
    eq(schema.jobs.status, "awaiting_approval"), gt(schema.jobs.expiresAt, new Date()),
  )).returning({ tool: schema.jobs.tool, deviceId: schema.jobs.deviceId, clientId: schema.jobs.clientId });
  if (res.length) {
    await audit({
      userId: user.id, deviceId: res[0].deviceId, clientId: res[0].clientId, actor: "user",
      action: decision === "approve" ? "approval.granted" : "approval.denied", tool: res[0].tool, ok: decision === "approve",
    });
  }
  revalidatePath("/approvals");
}
