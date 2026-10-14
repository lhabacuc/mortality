import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { authRelay, json } from "@/lib/relay-auth";

const MAX_BODY = 2_000_000;
const Body = z.object({
  job_id: z.string().uuid(),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().max(2000).optional(),
});

export async function POST(req: Request) {
  const auth = await authRelay(req);
  if (!auth) return json({ error: "unauthorized" }, 401);
  const text = await req.text();
  if (text.length > MAX_BODY) return json({ error: "too_large" }, 413);
  const body = Body.safeParse(JSON.parse(text || "null"));
  if (!body.success) return json({ error: "invalid_request" }, 400);

  const updated = await db().update(schema.jobs).set({
    status: body.data.ok ? "done" : "error",
    result: body.data.ok ? (body.data.result ?? null) : null,
    error: body.data.ok ? null : (body.data.error ?? "erro"),
    completedAt: new Date(),
  }).where(and(
    eq(schema.jobs.id, body.data.job_id),
    eq(schema.jobs.deviceId, auth.device.id),
    eq(schema.jobs.status, "claimed"),
  )).returning({ id: schema.jobs.id });
  return json({ accepted: updated.length > 0 });
}
