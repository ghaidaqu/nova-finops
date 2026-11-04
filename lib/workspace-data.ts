import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { connections, issueStates, transactions, workspaces } from "@/db/schema";
import type { CurrentUser } from "@/lib/auth";
import { reconcile, type Issue, type SourceKind, type Txn } from "@/lib/reconcile";

export type IssueStatus = "open" | "resolved" | "snoozed";

export type SourceSummary = { name: string; kind: SourceKind; feeBps: number; feeFixed: number; lagDays: number; count: number; total: number; from: string | null; to: string | null; lastSyncAt: string };

export type TxnView = { id: string; source: string; date: string; amount: number; fee: number | null; reference: string | null; description: string };

// Everything the app screens need, computed in one pass. Amounts are in halalas.
export type WorkspaceData = {
  user: { name: string; email: string };
  workspace: { name: string; sector: string | null; tolerance: number };
  sources: SourceSummary[];
  totals: { records: number; sales: number; salesCount: number; received: number; fees: number; pending: number; matchedSales: number; openIssues: number; openAmount: number };
  issues: (Issue & { status: IssueStatus })[];
  matches: { via: string; layer: string; expected: number; received: number; date: string; receivedDate: string; count: number; sources: string[] }[];
  txns: Record<string, TxnView>;
  daily: { date: string; sales: number; received: number }[];
  branches: { name: string; total: number; count: number }[];
  hint: string | null;
};

export async function workspaceData(user: CurrentUser): Promise<WorkspaceData> {
  const db = getDb();
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, user.workspace.id)).limit(1);
  const rows = await db.select().from(transactions).where(eq(transactions.workspaceId, user.workspace.id)).orderBy(desc(transactions.occurredOn)).limit(20000);
  const linked = await db.select().from(connections).where(eq(connections.workspaceId, user.workspace.id)).orderBy(desc(connections.lastSyncAt));
  const states = await db.select().from(issueStates).where(eq(issueStates.workspaceId, user.workspace.id));

  const txns: Txn[] = rows.map((r) => ({ id: r.id, source: r.source, reference: r.reference, date: r.occurredOn, description: r.description, amount: r.amountHalalas, expected: r.expectedHalalas, fee: r.feeHalalas, branch: r.branch }));
  const configs = linked.map((c) => ({ name: c.source, kind: c.kind as SourceKind, feeBps: c.feeBps, feeFixed: c.feeFixedHalalas, lagDays: c.lagDays }));
  const result = reconcile(txns, configs, workspace.toleranceHalalas);

  const statusOf = new Map(states.map((s) => [s.issueId, s.status as IssueStatus]));
  const issues = result.issues.map((issue) => ({ ...issue, status: statusOf.get(issue.id) || "open" }));
  const open = issues.filter((i) => i.status === "open");

  const byId = new Map(txns.map((t) => [t.id, t]));
  const view = (id: string): TxnView | null => {
    const t = byId.get(id);
    return t ? { id, source: t.source, date: t.date, amount: t.amount, fee: t.fee, reference: t.reference, description: t.description } : null;
  };
  const shown: Record<string, TxnView> = {};
  for (const issue of issues) for (const id of [...issue.txnIds, ...issue.relatedIds].slice(0, 60)) {
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

  const sources: SourceSummary[] = linked.map((c) => {
    const own = txns.filter((t) => t.source === c.source);
    const dates = own.map((t) => t.date).sort();
    return { name: c.source, kind: c.kind as SourceKind, feeBps: c.feeBps, feeFixed: c.feeFixedHalalas, lagDays: c.lagDays, count: own.length, total: own.reduce((s, t) => s + t.amount, 0), from: dates[0] || null, to: dates.at(-1) || null, lastSyncAt: c.lastSyncAt };
  });

  return {
    user: { name: user.name, email: user.email },
    workspace: { name: workspace.name, sector: workspace.sector, tolerance: workspace.toleranceHalalas },
    sources,
    totals: { records: txns.length, ...result.totals, openIssues: open.length, openAmount: open.filter((i) => i.type !== "unknown").reduce((s, i) => s + i.amount, 0) },
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
