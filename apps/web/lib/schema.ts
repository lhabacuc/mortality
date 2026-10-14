import {
  pgTable, uuid, text, timestamp, boolean, integer, jsonb, uniqueIndex, index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const id = () => uuid("id").primaryKey().defaultRandom();
const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts("created_at").notNull().defaultNow();

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  role: text("role", { enum: ["admin", "user"] }).notNull().default("user"),
  status: text("status", { enum: ["pending", "active", "suspended"] }).notNull().default("pending"),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  // Tetos definidos pelo admin: nenhum grant do utilizador os pode exceder.
  maxPreset: text("max_preset", { enum: ["read_only", "read_write", "terminal"] }).notNull().default("terminal"),
  maxDevices: integer("max_devices").notNull().default(5),
  disabledTools: text("disabled_tools").array().notNull().default(sql`'{}'`),
  createdAt: createdAt(),
  approvedBy: uuid("approved_by"),
  approvedAt: ts("approved_at"),
});

export const devices = pgTable("devices", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  os: text("os"),
  relayVersion: text("relay_version"),
  enabled: boolean("enabled").notNull().default(true),
  pausedLocally: boolean("paused_locally").notNull().default(false),
  lastSeenAt: ts("last_seen_at"),
  revokedAt: ts("revoked_at"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("devices_user_name").on(t.userId, t.name)]);

export const deviceTokens = pgTable("device_tokens", {
  id: id(),
  deviceId: uuid("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: createdAt(),
  lastUsedAt: ts("last_used_at"),
  revokedAt: ts("revoked_at"),
});

export const oauthClients = pgTable("oauth_clients", {
  id: id(),
  clientId: text("client_id").notNull().unique(),
  clientSecretHash: text("client_secret_hash"),
  redirectUris: text("redirect_uris").array().notNull(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const authCodes = pgTable("auth_codes", {
  codeHash: text("code_hash").primaryKey(),
  clientId: text("client_id").notNull(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  redirectUri: text("redirect_uri").notNull(),
  codeChallenge: text("code_challenge").notNull(),
  resource: text("resource"),
  scope: text("scope").notNull(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
});

export const accessTokens = pgTable("access_tokens", {
  id: id(),
  tokenHash: text("token_hash").notNull().unique(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  clientId: text("client_id"),
  kind: text("kind", { enum: ["oauth", "pat"] }).notNull(),
  name: text("name"),
  scope: text("scope").notNull(),
  resource: text("resource"),
  familyId: uuid("family_id"),
  expiresAt: ts("expires_at"),
  revokedAt: ts("revoked_at"),
  lastUsedAt: ts("last_used_at"),
  createdAt: createdAt(),
});

export const refreshTokens = pgTable("refresh_tokens", {
  id: id(),
  tokenHash: text("token_hash").notNull().unique(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  clientId: text("client_id").notNull(),
  familyId: uuid("family_id").notNull(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  revokedAt: ts("revoked_at"),
});

export const deviceCodes = pgTable("device_codes", {
  deviceCodeHash: text("device_code_hash").primaryKey(),
  userCode: text("user_code").notNull().unique(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  deviceName: text("device_name"),
  os: text("os"),
  status: text("status", { enum: ["pending", "approved", "denied", "used"] }).notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  interval: integer("interval").notNull().default(5),
  expiresAt: ts("expires_at").notNull(),
});

export const clientGrants = pgTable("client_grants", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  clientId: text("client_id").notNull(),
  deviceId: uuid("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  preset: text("preset", { enum: ["read_only", "read_write", "terminal", "custom"] }).notNull(),
  allowedTools: text("allowed_tools").array().notNull().default(sql`'{}'`),
  allowedDirs: text("allowed_dirs").array().notNull().default(sql`'{}'`),
  blockedCommands: text("blocked_commands").array().notNull().default(sql`'{}'`),
  readOnly: boolean("read_only").notNull().default(false),
  requireApprovalFor: text("require_approval_for").array().notNull().default(sql`'{}'`),
  expiresAt: ts("expires_at"),
  revokedAt: ts("revoked_at"),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("grants_active_unique").on(t.clientId, t.deviceId).where(sql`${t.revokedAt} is null`),
]);

export const jobs = pgTable("jobs", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  deviceId: uuid("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  clientId: text("client_id"),
  tool: text("tool").notNull(),
  args: jsonb("args").notNull(),
  status: text("status", {
    enum: ["awaiting_approval", "queued", "claimed", "done", "error", "expired", "denied"],
  }).notNull().default("queued"),
  result: jsonb("result"),
  error: text("error"),
  createdAt: createdAt(),
  claimedAt: ts("claimed_at"),
  completedAt: ts("completed_at"),
  expiresAt: ts("expires_at").notNull(),
}, (t) => [index("jobs_queue").on(t.deviceId, t.status)]);

export const auditLog = pgTable("audit_log", {
  id: id(),
  userId: uuid("user_id"),
  deviceId: uuid("device_id"),
  clientId: text("client_id"),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  tool: text("tool"),
  argsSummary: text("args_summary"),
  ok: boolean("ok").notNull().default(true),
  ip: text("ip"),
  createdAt: createdAt(),
});

export const rateLimits = pgTable("rate_limits", {
  key: text("key").notNull(),
  windowStart: ts("window_start").notNull(),
  count: integer("count").notNull().default(0),
}, (t) => [uniqueIndex("rate_limits_pk").on(t.key, t.windowStart)]);

export const invites = pgTable("invites", {
  id: id(),
  tokenHash: text("token_hash").notNull().unique(),
  email: text("email"),
  createdBy: uuid("created_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  usedBy: uuid("used_by"),
});
