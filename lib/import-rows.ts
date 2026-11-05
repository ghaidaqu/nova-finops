import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { connections } from "@/db/schema";
import { digest } from "@/lib/auth";
import type { SourceKind } from "@/lib/reconcile";

// Amounts arrive in riyals from the client and are stored in halalas.
export type ImportRow = { date?: string; description?: string; amount?: number; expected?: number | null; reference?: string; fee?: number | null; branch?: string; method?: string };

export const sourceKinds: SourceKind[] = ["sales", "payments", "bank", "expenses"];
export const defaultLag: Record<SourceKind, number> = { sales: 3, payments: 2, bank: 2, expenses: 0 };

// Anything beyond 10 billion riyals in one row is a parsing mistake, not a transaction.
const halalas = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && Math.abs(value) < 1e10 ? Math.round(value * 100) : null);
const validDate = (value: unknown) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const year = Number(value.slice(0, 4));
  return year >= 2000 && year <= 2100 && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value) ? value : null;
};
const text = (value: unknown, max: number) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);

// `system`/`origin` record which outside system fed the source and whether by file or API.
export async function importRows(workspaceId: string, source: string, kind: SourceKind, rows: ImportRow[], config?: { feeBps?: number; feeFixedHalalas?: number; lagDays?: number; system?: string | null; origin?: "file" | "api" }) {
  const db = getDb();
  const occurrences = new Map<string, number>();
  const records = [];
  let invalid = 0;
  for (const row of rows) {
    const amount = halalas(row.amount);
    const date = validDate(row.date);
    if (amount === null || !date) {
      invalid++;
      continue;
    }
    const record = {
      id: crypto.randomUUID(),
      date,
      amount,
      reference: text(row.reference, 100),
      description: text(row.description, 300) || "",
      expected: halalas(row.expected),
      fee: halalas(row.fee),
      branch: text(row.branch, 80),
      method: text(row.method, 40),
      fingerprint: "",
    };
    // Identical rows inside one file are kept apart by their position among duplicates.
    const key = [source, record.date, record.amount, record.reference, record.description, record.branch, record.fee, record.method].join("|");
    const seen = occurrences.get(key) || 0;
    occurrences.set(key, seen + 1);
    record.fingerprint = await digest(`${key}|${seen}`);
    records.push(record);
  }

  await db
    .insert(connections)
    .values({ id: crypto.randomUUID(), workspaceId, source, kind, status: "connected", lastSyncAt: new Date().toISOString(), lagDays: config?.lagDays ?? defaultLag[kind], feeBps: config?.feeBps ?? 0, feeFixedHalalas: config?.feeFixedHalalas ?? 0, system: config?.system ?? null, origin: config?.origin ?? "file" })
    .onConflictDoUpdate({ target: [connections.workspaceId, connections.source], set: { status: "connected", lastSyncAt: new Date().toISOString() } });

  // One JSON parameter per chunk keeps us far below D1's 100 bound parameters per query.
  let imported = 0;
  for (let i = 0; i < records.length; i += 400) {
    const chunk = JSON.stringify(records.slice(i, i + 400));
    const result = await db.run(sql`
      INSERT OR IGNORE INTO transactions (id, workspace_id, source, reference, occurred_on, description, amount_halalas, expected_halalas, kind, fee_halalas, branch, method, fingerprint)
      SELECT json_extract(value, '$.id'), ${workspaceId}, ${source}, json_extract(value, '$.reference'), json_extract(value, '$.date'), json_extract(value, '$.description'),
             json_extract(value, '$.amount'), json_extract(value, '$.expected'), ${kind}, json_extract(value, '$.fee'), json_extract(value, '$.branch'), json_extract(value, '$.method'), json_extract(value, '$.fingerprint')
      FROM json_each(${chunk})`);
    imported += result.meta.changes ?? 0;
  }
  return { imported, skipped: records.length - imported, invalid };
}
