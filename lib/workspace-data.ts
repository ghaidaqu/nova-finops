import { count, desc, eq, max, min, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { connections, issueStates, transactions, workspaces } from "@/db/schema";
import { isAdmin, type CurrentUser } from "@/lib/auth";
import { reconcile, type Issue, type SettlesVia, type SourceKind, type Txn } from "@/lib/reconcile";

export type IssueStatus = "open" | "resolved" | "snoozed";

export type SourceSummary = { name: string; kind: SourceKind; feeBps: number; feeFixed: number; lagDays: number; settlesVia: SettlesVia; system: string | null; origin: "file" | "api"; count: number; total: number; from: string | null; to: string | null; lastSyncAt: string };

export type TxnView = { id: string; source: string; date: string; amount: number; fee: number | null; reference: string | null; description: string };

// Everything the app screens need, computed in one pass. Amounts are in halalas.
export type WorkspaceData = {
  user: { name: string; email: string; admin: boolean };
  workspace: { name: string; sector: string | null; tolerance: number };
  sources: SourceSummary[];
  totals: { records: number; sales: number; salesCount: number; cash: number; received: number; fees: number; expenses: number; pending: number; matchedSales: number; openIssues: number; openAmount: number };
  issueCounts: Record<IssueStatus, number>;
  // Set when the workspace holds more rows than one reconciliation reads (the newest are used).
  truncated: { read: number; stored: number } | null;
  // txnIds/relatedIds are trimmed to what the detail view shows; rowCount is the full number.
  issues: (Issue & { status: IssueStatus; rowCount: number })[];
  matches: { via: string; layer: string; expected: number; received: number; date: string; receivedDate: string; count: number; sources: string[] }[];
  txns: Record<string, TxnView>;
  daily: { date: string; sales: number; received: number }[];
  branches: { name: string; total: number; count: number }[];
  hint: string | null;
};

// How many of the newest rows one reconciliation reads; the engine handles this well inside a Worker.
const ROW_LIMIT = 60000;

export async function workspaceData(user: CurrentUser): Promise<WorkspaceData> {
  const db = getDb();
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, user.workspace.id)).limit(1);
  const rows = await db.select().from(transactions).where(eq(transactions.workspaceId, user.workspace.id)).orderBy(desc(transactions.occurredOn)).limit(ROW_LIMIT);
  const stats = await db
    .select({ source: transactions.source, count: count(), total: sql<number>`coalesce(sum(${transactions.amountHalalas}), 0)`, from: min(transactions.occurredOn), to: max(transactions.occurredOn) })
    .from(transactions)
    .where(eq(transactions.workspaceId, user.workspace.id))
    .groupBy(transactions.source);
  const stored = stats.reduce((s, x) => s + x.count, 0);
  const linked = await db.select().from(connections).where(eq(connections.workspaceId, user.workspace.id)).orderBy(desc(connections.lastSyncAt));
  const states = await db.select().from(issueStates).where(eq(issueStates.workspaceId, user.workspace.id));

  const txns: Txn[] = rows.map((r) => ({ id: r.id, source: r.source, reference: r.reference, date: r.occurredOn, description: r.description, amount: r.amountHalalas, expected: r.expectedHalalas, fee: r.feeHalalas, branch: r.branch, method: r.method }));
  const configs = linked.map((c) => ({ name: c.source, kind: c.kind as SourceKind, feeBps: c.feeBps, feeFixed: c.feeFixedHalalas, lagDays: c.lagDays, settlesVia: c.settlesVia as SettlesVia }));
  const result = reconcile(txns, configs, workspace.toleranceHalalas);

  const statusOf = new Map(states.map((s) => [s.issueId, s.status as IssueStatus]));
  const all = result.issues.map((issue) => ({ ...issue, status: statusOf.get(issue.id) || "open" }));
  const open = all.filter((i) => i.status === "open");
  // Keep the response small: the most important issues per status (already sorted by severity and amount).
  const issueCounts = { open: 0, resolved: 0, snoozed: 0 };
  const issues = all
    .filter((i) => ++issueCounts[i.status] <= (i.status === "open" ? 300 : 100))
    .map((i) => ({ ...i, rowCount: i.txnIds.length + i.relatedIds.length, txnIds: i.txnIds.slice(0, 12), relatedIds: i.relatedIds.slice(0, 12) }));

  const byId = new Map(txns.map((t) => [t.id, t]));
  const view = (id: string): TxnView | null => {
    const t = byId.get(id);
    return t ? { id, source: t.source, date: t.date, amount: t.amount, fee: t.fee, reference: t.reference, description: t.description } : null;
  };
  const shown: Record<string, TxnView> = {};
  for (const issue of issues) for (const id of [...issue.txnIds, ...issue.relatedIds]) {
    const v = view(id);
    if (v) shown[id] = v;
  }

  const kindOf = new Map(configs.map((c) => [c.name, c.kind]));
  const daily = new Map<string, { sales: number; received: number }>();
  const branches = new Map<string, { total: number; count: number }>();
  for (const t of txns) {
    const kind = kindOf.get(t.source) || "sales";
    const day = daily.get(t.date) || { sales: 0, received: 0 };
    if (kind === "sales") {
      day.sales += t.amount;
      if (t.branch) {
        const b = branches.get(t.branch) || { total: 0, count: 0 };
        branches.set(t.branch, { total: b.total + t.amount, count: b.count + 1 });
      }
    } else if (kind === "bank" && t.amount > 0) day.received += t.amount;
    daily.set(t.date, day);
  }

  const statsOf = new Map(stats.map((x) => [x.source, x]));
  const sources: SourceSummary[] = linked.map((c) => {
    const own = statsOf.get(c.source);
    return { name: c.source, kind: c.kind as SourceKind, feeBps: c.feeBps, feeFixed: c.feeFixedHalalas, lagDays: c.lagDays, settlesVia: c.settlesVia as SettlesVia, system: c.system, origin: c.origin === "api" ? "api" : "file", count: own?.count || 0, total: Number(own?.total || 0), from: own?.from || null, to: own?.to || null, lastSyncAt: c.lastSyncAt };
  });

  return {
    user: { name: user.name, email: user.email, admin: isAdmin(user) },
    workspace: { name: workspace.name, sector: workspace.sector, tolerance: workspace.toleranceHalalas },
    sources,
    totals: { records: stored, ...result.totals, openIssues: open.length, openAmount: open.filter((i) => i.type !== "unknown").reduce((s, i) => s + i.amount, 0) },
    issueCounts,
    truncated: stored > rows.length ? { read: rows.length, stored } : null,
    issues,
    matches: result.matches
      .sort((a, b) => b.receivedDate.localeCompare(a.receivedDate))
      .slice(0, 150)
      .map((m) => ({ via: m.via, layer: m.layer, expected: m.expected, received: m.received, date: m.date, receivedDate: m.receivedDate, count: m.expectedIds.length, sources: [...new Set([...m.expectedIds, ...m.receivedIds].map((id) => byId.get(id)?.source || ""))] })),
    txns: shown,
    daily: [...daily.entries()].map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date)),
    branches: [...branches.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.total - a.total),
    hint: result.hint,
  };
}
