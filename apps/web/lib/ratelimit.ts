import { sql } from "drizzle-orm";
import { db } from "./db";

/** Janela fixa em Postgres. Devolve true se ainda dentro do limite. */
export async function allow(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000;
  const res = await db().execute(sql`
    insert into rate_limits (key, window_start, count)
    values (${key}, ${new Date(bucket).toISOString()}, 1)
    on conflict (key, window_start) do update set count = rate_limits.count + 1
    returning count`);
  return Number((res.rows[0] as { count: number }).count) <= limit;
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
}
