// Run with: npm test (Node strips the TypeScript types on import).
import assert from "node:assert/strict";
import { test } from "node:test";
import { demoSources } from "../lib/demo-data.ts";
import { reconcile } from "../lib/reconcile.ts";

const toTxns = (sources) =>
  sources.flatMap((s) =>
    s.rows.map((r, i) => ({
      id: `${s.kind}-${i}`,
      source: s.name,
      reference: r.reference ?? null,
      date: r.date,
      description: r.description,
      amount: Math.round(r.amount * 100),
      expected: null,
      fee: r.fee === undefined ? null : Math.round(r.fee * 100),
      branch: r.branch ?? null,
    })),
  );
const configs = (sources) => sources.map((s) => ({ name: s.name, kind: s.kind, feeBps: s.feeBps, feeFixed: s.feeFixedHalalas, lagDays: s.lagDays }));
const txn = (id, source, date, amount, extra = {}) => ({ id, source, reference: null, date, description: "", amount, expected: null, fee: null, branch: null, ...extra });

test("demo data surfaces exactly the planted problems", () => {
  const sources = demoSources("2026-11-04");
  const result = reconcile(toTxns(sources), configs(sources), 100);
  const count = (type) => result.issues.filter((i) => i.type === type).length;
  assert.deepEqual(result.layers, ["sales-payments", "payments-bank"]);
  assert.equal(count("missing"), 3, "two sales absent from the gateway + one payout that never arrived");
  assert.equal(count("fee"), 2);
  assert.equal(count("short"), 1);
  assert.equal(result.issues.find((i) => i.type === "short").amount, 15000);
  assert.equal(count("duplicate"), 1);
  // The duplicate charge has no sale behind it, and the 5,000 transfer has no source.
  assert.equal(count("unknown"), 2);
  assert.ok(result.issues.some((i) => i.type === "unknown" && i.amount === 500000));
  assert.ok(result.totals.pending > 0, "the last two days are still in transit");
});

test("sales settle to the bank in daily batches after the agreed fee", () => {
  const cfg = [
    { name: "pos", kind: "sales", feeBps: 200, feeFixed: 0, lagDays: 3 },
    { name: "bank", kind: "bank", feeBps: 0, feeFixed: 0, lagDays: 3 },
  ];
  const txns = [
    txn("s1", "pos", "2026-10-01", 10000),
    txn("s2", "pos", "2026-10-01", 20000),
    txn("s3", "pos", "2026-10-02", 5000),
    txn("b1", "bank", "2026-10-03", 29400), // 300 SAR less 2%
    txn("b2", "bank", "2026-10-09", 1000),
  ];
  const result = reconcile(txns, cfg, 100);
  assert.equal(result.matches[0].via, "batch");
  assert.deepEqual(result.matches[0].expectedIds.sort(), ["s1", "s2"]);
  // s3 is overdue by the last bank date; b2 has no sale behind it.
  assert.deepEqual(result.issues.map((i) => i.type).sort(), ["missing", "unknown"]);
});

test("same reference with a lower amount is a short payment", () => {
  const cfg = [
    { name: "store", kind: "sales", feeBps: 0, feeFixed: 0, lagDays: 2 },
    { name: "gateway", kind: "payments", feeBps: 0, feeFixed: 0, lagDays: 2 },
  ];
  const result = reconcile([txn("s", "store", "2026-10-01", 50000, { reference: "INV-1" }), txn("p", "gateway", "2026-10-01", 42000, { reference: "inv 1" })], cfg, 100);
  assert.equal(result.matches[0].via, "reference");
  assert.equal(result.issues[0].type, "short");
  assert.equal(result.issues[0].amount, 8000);
});

test("only sales means nothing to match yet", () => {
  const result = reconcile([txn("s", "store", "2026-10-01", 100)], [{ name: "store", kind: "sales", feeBps: 0, feeFixed: 0, lagDays: 2 }], 100);
  assert.equal(result.layers.length, 0);
  assert.match(result.hint, /كشف البنك/);
});
