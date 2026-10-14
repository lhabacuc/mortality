import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { RelayJob } from "@mortality/shared";
import { db, schema } from "@/lib/db";
import { authRelay, json } from "@/lib/relay-auth";

const Body = z.object({
  paused: z.boolean().default(false),
  version: z.string().max(40).optional(),
  os: z.string().max(60).optional(),
});

const num = (v: string | undefined, d: number) => (Number(v) > 0 ? Number(v) : d);

export async function POST(req: Request) {
  const auth = await authRelay(req);
  if (!auth) return json({ error: "unauthorized" }, 401);
  const { device } = auth;
  const body = Body.parse(await req.json().catch(() => ({})));

  // Caminho idle barato: 1 UPDATE do dispositivo + 1 statement que reclama job e devolve o último job.
  await db().update(schema.devices).set({
    lastSeenAt: new Date(), pausedLocally: body.paused,
    ...(body.version ? { relayVersion: body.version } : {}),
    ...(body.os ? { os: body.os } : {}),
  }).where(eq(schema.devices.id, device.id));

  const idle = num(process.env.RELAY_POLL_IDLE_SECONDS, 20);
  const active = num(process.env.RELAY_POLL_ACTIVE_SECONDS, 1);
  const windowMs = num(process.env.RELAY_ACTIVE_WINDOW_MINUTES, 5) * 60_000;

  // Estado "armado": painel ativo E relay não pausado localmente.
  if (!device.enabled || body.paused) return json({ status: "idle", next_poll_seconds: idle });

  // Limpeza preguiçosa (o claim já ignora jobs expirados): ~5% dos polls.
  if (Math.random() < 0.05) {
    await db().execute(sql`update jobs set status = 'expired'
      where device_id = ${device.id} and status in ('queued','claimed') and expires_at < now()`);
  }

  // Um só round-trip: reclama (SKIP LOCKED) e devolve também o instante do último job (modo ativo).
  const res = await db().execute(sql`
    with claimed as (
      update jobs set status = 'claimed', claimed_at = now()
      where id = (select id from jobs where device_id = ${device.id} and status = 'queued' and expires_at > now()
                  order by created_at limit 1 for update skip locked)
      returning id, client_id, tool, args, expires_at
    )
    select c.id, c.client_id, c.tool, c.args, c.expires_at,
           (select max(created_at) from jobs where device_id = ${device.id}) as last_job_at
    from (select 1) x left join claimed c on true`);

  const row = res.rows[0] as {
    id: string | null; client_id: string | null; tool: string;
    args: { args: Record<string, unknown>; permissions: RelayJob["permissions"] }; expires_at: string; last_job_at: string | null;
  };
  if (row.id) {
    const job: RelayJob = {
      id: row.id, clientId: row.client_id ?? "", tool: row.tool, args: row.args.args, permissions: row.args.permissions,
      timeoutSeconds: Math.max(1, Math.ceil((new Date(row.expires_at).getTime() - Date.now()) / 1000)),
    };
    return json({ status: "job", job, next_poll_seconds: 0 });
  }
  const isActive = !!row.last_job_at && Date.now() - new Date(row.last_job_at).getTime() < windowMs;
  return json({ status: "idle", next_poll_seconds: isActive ? active : idle });
}
