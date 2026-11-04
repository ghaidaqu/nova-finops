import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { connections } from "@/db/schema";
import { digest } from "@/lib/auth";
import type { SourceKind } from "@/lib/reconcile";

// Amounts arrive in riyals from the client and are stored in halalas.
export type ImportRow = { date?: string; description?: string; amount?: number; expected?: number | null; reference?: string; fee?: number | null; branch?: string };

export const sourceKinds: SourceKind[] = ["sales", "payments", "bank"];
export const defaultLag: Record<SourceKind, number> = { sales: 3, payments: 2, bank: 2 };

const halalas = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? Math.round(value * 100) : null);
const text = (value: unknown, max: number) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);

export async function importRows(workspaceId: string, source: string, kind: SourceKind, rows: ImportRow[], config?: { feeBps?: number; feeFixedHalalas?: number; lagDays?: number }) {
  const db = getDb();
  const occurrences = new Map<string, number>();
  const records = [];
  let invalid = 0;
  for (const row of rows) {
    const amount = halalas(row.amount);
    const date = typeof row.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.date) ? row.date : null;
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
      fingerprint: "",
    };
    // Identical rows inside one file are kept apart by their position among duplicates.
    const key = [source, record.date, record.amount, record.reference, record.description, record.branch, record.fee].join("|");
    const seen = occurrences.get(key) || 0;
    occurrences.set(key, seen + 1);
    record.fingerprint = await digest(`${key}|${seen}`);
    records.push(record);
  }

  await db
    .insert(connections)
    .values({ id: crypto.randomUUID(), workspaceId, source, kind, status: "connected", lastSyncAt: new Date().toISOString(), lagDays: config?.lagDays ?? defaultLag[kind], feeBps: config?.feeBps ?? 0, feeFixedHalalas: config?.feeFixedHalalas ?? 0 })
    .onConflictDoUpdate({ target: [connections.workspaceId, connections.source], set: { kind, status: "connected", lastSyncAt: new Date().toISOString() } });

  // One JSON parameter per chunk keeps us far below D1's 100 bound parameters per query.
  let imported = 0;
  for (let i = 0; i < records.length; i += 400) {
    const chunk = JSON.stringify(records.slice(i, i + 400));
    const result = await db.run(sql`
      INSERT OR IGNORE INTO transactions (id, workspace_id, source, reference, occurred_on, description, amount_halalas, expected_halalas, kind, fee_halalas, branch, fingerprint)
      SELECT json_extract(value, '$.id'), ${workspaceId}, ${source}, json_extract(value, '$.reference'), json_extract(value, '$.date'), json_extract(value, '$.description'),
             json_extract(value, '$.amount'), json_extract(value, '$.expected'), ${kind}, json_extract(value, '$.fee'), json_extract(value, '$.branch'), json_extract(value, '$.fingerprint')
      FROM json_each(${chunk})`);
    imported += result.meta.changes ?? 0;
  }
  return { imported, skipped: records.length - imported, invalid };
}
