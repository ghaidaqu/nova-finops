import { sql } from "drizzle-orm";
import { integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("users_email_unique").on(table.email)]);

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  sector: text("sector"),
  // Differences at or below this amount are treated as rounding, not issues.
  toleranceHalalas: integer("tolerance_halalas").notNull().default(100),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  tokenHash: text("token_hash").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("sessions_token_hash_unique").on(table.tokenHash)]);

export const connections = sqliteTable("connections", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  source: text("source").notNull(),
  status: text("status").notNull().default("connected"),
  // sales: what was sold or invoiced; payments: gateway/platform reports; bank: bank statement.
  kind: text("kind").notNull().default("sales"),
  // Agreed fee: basis points of the gross amount plus a fixed amount per transaction.
  feeBps: integer("fee_bps").notNull().default(0),
  feeFixedHalalas: integer("fee_fixed_halalas").notNull().default(0),
  // How many days money from this source usually takes to arrive.
  lagDays: integer("lag_days").notNull().default(3),
  lastSyncAt: text("last_sync_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("connections_workspace_source_unique").on(table.workspaceId, table.source)]);

export const transactions = sqliteTable("transactions", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  source: text("source").notNull(),
  reference: text("reference"),
  occurredOn: text("occurred_on").notNull(),
  description: text("description").notNull().default(""),
  amountHalalas: integer("amount_halalas").notNull(),
  expectedHalalas: integer("expected_halalas"),
  kind: text("kind").notNull().default("sale"),
  feeHalalas: integer("fee_halalas"),
  branch: text("branch"),
  // Stable hash of the imported row, so importing the same file twice adds nothing.
  fingerprint: text("fingerprint"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("transactions_workspace_fingerprint_unique").on(table.workspaceId, table.fingerprint)]);

// Only issues the user acted on are stored; everything else is open.
export const issueStates = sqliteTable("issue_states", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id),
  issueId: text("issue_id").notNull(),
  status: text("status").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [primaryKey({ columns: [table.workspaceId, table.issueId] })]);
