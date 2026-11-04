// Real-world scenarios for lib/reconcile.ts: each test asserts what a small business would
// consider the sensible outcome (refunds, weekends, batch payouts, ambiguity, id stability, speed).
import assert from "node:assert/strict";
import { test } from "node:test";
import { reconcile, txn, cfg, buildShop, addDays, rng, shuffle, count } from "./support/engine-helpers.mjs";
import { demoSources } from "../lib/demo-data.ts";

const T = 100; // 1 SAR tolerance
const dbOrder = (txns) => [...txns].sort((a, b) => b.date.localeCompare(a.date)); // workspace-data: ORDER BY occurred_on DESC
const issuesOf = (r) => r.issues.map((i) => `${i.type}:${i.amount}[${i.txnIds}]`);
const POS_GW = [cfg("POS", "sales"), cfg("GW", "payments")];
const GW_BANK = [cfg("GW", "payments"), cfg("BANK", "bank")];

// ---------- refunds / zero ----------
test("refund row with the sale's reference (newest first, as the DB returns it) steals the sale's payment", () => {
  const r = reconcile(dbOrder([
    txn("sale", "POS", "2026-10-01", 50000, { reference: "INV-1" }),
    txn("refund", "POS", "2026-10-05", -50000, { reference: "INV-1" }),
    txn("pay", "GW", "2026-10-01", 50000, { reference: "INV-1" }),
    txn("later", "GW", "2026-10-09", 1000),
  ]), POS_GW, T);
  assert.ok(!r.issues.some((i) => i.type === "missing"), `sale was paid, got ${issuesOf(r)}`);
});

test("zero-amount void with the same reference steals the payment", () => {
  const r = reconcile(dbOrder([
    txn("sale", "POS", "2026-10-01", 30000, { reference: "INV-7" }), txn("void", "POS", "2026-10-02", 0, { reference: "INV-7" }),
    txn("pay", "GW", "2026-10-01", 30000, { reference: "INV-7" }), txn("later", "GW", "2026-10-09", 500),
  ]), POS_GW, T);
  assert.ok(!r.issues.some((i) => i.type === "missing"), issuesOf(r).join());
});

test("gateway refund netted from the daily payout breaks the payout match", () => {
  const r = reconcile([
    txn("p1", "GW", "2026-10-01", 10000), txn("p2", "GW", "2026-10-01", 10000), txn("p3", "GW", "2026-10-01", 10000),
    txn("refund", "GW", "2026-10-01", -10000), txn("payout", "BANK", "2026-10-03", 20000), txn("later", "BANK", "2026-10-09", 100),
  ], GW_BANK, T);
  assert.equal(count(r, "missing"), 0, issuesOf(r).join());
});

test("sales->bank: refund on the same day is netted in the batch", () => {
  const r = reconcile([
    txn("s1", "POS", "2026-10-01", 10000), txn("s2", "POS", "2026-10-01", 10000), txn("s3", "POS", "2026-10-01", -5000),
    txn("b1", "BANK", "2026-10-02", 14600), txn("later", "BANK", "2026-10-09", 100),
  ], [cfg("POS", "sales", 200), cfg("BANK", "bank")], T);
  assert.deepEqual(r.matches.map((m) => m.via), ["batch"]);
});

// ---------- ambiguity / cash ----------
test("near-equal amounts without references create false 'short' issues (tolerance chain)", () => {
  const r = reconcile([
    txn("s1", "POS", "2026-10-01", 9950), txn("s2", "POS", "2026-10-01", 10050), txn("s3", "POS", "2026-10-01", 10150),
    txn("p1", "GW", "2026-10-01", 10050), txn("p2", "GW", "2026-10-01", 10150), txn("p3", "GW", "2026-10-01", 9950),
  ], POS_GW, T);
  assert.equal(r.issues.length, 0, `every sale has an exact gateway row; got ${issuesOf(r)}`);
});

test("clean 20k-row shop without references still yields false shorts/missing", () => {
  const { txns, configs } = buildShop({ days: 60, perDay: 165, seed: 2, refs: false });
  const r = reconcile(dbOrder(txns), configs, T);
  assert.equal(r.issues.length, 0, `${r.issues.length} issues on perfectly clean data`);
});

test("issue ids depend on DB row order when amounts repeat (coffee shop)", () => {
  const { txns, configs } = buildShop({ days: 20, perDay: 60, cashShare: 0.15, refs: false, seed: 3, priceList: [1200, 1500, 1800] });
  const a = new Set(reconcile(dbOrder(txns), configs, T).issues.map((i) => i.id));
  const b = reconcile(dbOrder(shuffle(txns, rng(9))), configs, T).issues.map((i) => i.id);
  assert.equal(b.filter((id) => !a.has(id)).length, 0, "same data, different tie order");
});

test("cash sales without a payment method column: one 'missing' issue per day (documented)", (t) => {
  const { txns, configs } = buildShop({ days: 30, perDay: 30, cashShare: 0.3, seed: 7 });
  const r = reconcile(txns, configs, T);
  t.diagnostic(`30 days -> ${count(r, "missing")} high-severity missing issues`);
  assert.ok(count(r, "missing") >= 25);
});

// ---------- batching / calendar ----------
test("KSA weekend: T+1 business-day payouts with the default payments lag (2) flag Thu-Sat every week", () => {
  const next = (date) => { let d = addDays(date, 1); while ([5, 6].includes(new Date(d).getUTCDay())) d = addDays(d, 1); return d; };
  const tx = [];
  const payout = new Map();
  for (let d = 0; d < 28; d++) {
    const date = addDays("2026-10-01", d);
    for (let i = 0; i < 5; i++) { const a = 5000 + d * 100 + i * 7; tx.push(txn(`p${d}-${i}`, "GW", date, a)); payout.set(next(date), (payout.get(next(date)) || 0) + a); }
  }
  for (const [d, v] of payout) tx.push(txn(`b${d}`, "BANK", d, v));
  const r = reconcile(dbOrder(tx), [cfg("GW", "payments", 0, 0, 2), cfg("BANK", "bank")], T);
  assert.equal(count(r, "missing"), 0, `${count(r, "missing")} missing, ${count(r, "unknown")} unknown`);
});

test("Thu+Fri+Sat paid in one Sunday deposit (month end) when lag is 3", () => {
  const r = reconcile([
    txn("thu", "POS", "2026-10-29", 10000), txn("fri", "POS", "2026-10-30", 20000), txn("sat", "POS", "2026-10-31", 30000),
    txn("b", "BANK", "2026-11-01", 58800),
  ], [cfg("POS", "sales", 200, 0, 3), cfg("BANK", "bank")], T);
  assert.deepEqual(r.matches.map((m) => m.via), ["batch"]);
  assert.equal(r.issues.length, 0);
});

test("year boundary Dec 30 - Jan 1 batched into Jan 2", () => {
  const r = reconcile([
    txn("a", "POS", "2026-12-30", 10000), txn("b", "POS", "2026-12-31", 20000), txn("c", "POS", "2027-01-01", 30000), txn("d", "BANK", "2027-01-02", 60000),
  ], [cfg("POS", "sales", 0, 0, 3), cfg("BANK", "bank")], T);
  assert.equal(r.issues.length, 0);
});

test("two gateways paying separate daily payouts into one bank", () => {
  const r = reconcile([
    txn("m1", "MADA", "2026-10-01", 10000), txn("m2", "MADA", "2026-10-01", 20000),
    txn("t1", "TABBY", "2026-10-01", 40000), txn("t2", "TABBY", "2026-10-01", 15000),
    txn("bm", "BANK", "2026-10-02", 30000), txn("bt", "BANK", "2026-10-03", 55000), txn("later", "BANK", "2026-10-10", 1),
  ], [cfg("MADA", "payments"), cfg("TABBY", "payments"), cfg("BANK", "bank")], T);
  assert.equal(count(r, "missing"), 0, issuesOf(r).join());
});

test("two branches (sales sources) with separate terminal batches", () => {
  const r = reconcile([
    txn("a1", "BR1", "2026-10-01", 10000), txn("a2", "BR1", "2026-10-01", 20000), txn("c1", "BR2", "2026-10-01", 5000), txn("c2", "BR2", "2026-10-01", 7000),
    txn("ba", "BANK", "2026-10-02", 29400), txn("bc", "BANK", "2026-10-02", 11760), txn("later", "BANK", "2026-10-09", 1),
  ], [cfg("BR1", "sales", 200, 0, 3), cfg("BR2", "sales", 200, 0, 3), cfg("BANK", "bank")], T);
  assert.equal(count(r, "missing"), 0, issuesOf(r).join());
});

test("delivery app paying weekly (7 days > BATCH_DAYS=3)", () => {
  const tx = [];
  let total = 0;
  for (let d = 0; d < 7; d++) for (let i = 0; i < 3; i++) { const a = 5000 + d * 100 + i * 37; tx.push(txn(`j${d}-${i}`, "JAHEZ", addDays("2026-10-01", d), a)); total += a - Math.round(a * 0.18); }
  tx.push(txn("weekly", "BANK", "2026-10-10", total), txn("later", "BANK", "2026-10-25", 1));
  const r = reconcile(tx, [cfg("JAHEZ", "sales", 1800, 0, 10), cfg("BANK", "bank")], T);
  assert.equal(count(r, "missing"), 0, issuesOf(r).join());
});

test("delivery app (sales + 18% commission) next to a card gateway: its sales are expected in the gateway", () => {
  const tx = [];
  for (let d = 0; d < 21; d++) {
    const date = addDays("2026-10-01", d);
    tx.push(txn(`s${d}`, "POS", date, 10000 + d), txn(`p${d}`, "GW", date, 10000 + d), txn(`b${d}`, "BANK", addDays(date, 1), 10000 + d));
    tx.push(txn(`j${d}`, "JAHEZ", date, 20000 + d), txn(`bj${d}`, "BANK", addDays(date, 2), 20000 + d - Math.round((20000 + d) * 0.18)));
  }
  const r = reconcile(dbOrder(tx), [cfg("POS", "sales"), cfg("JAHEZ", "sales", 1800, 0, 3), cfg("GW", "payments"), cfg("BANK", "bank")], T);
  assert.equal(count(r, "missing"), 0, `${count(r, "missing")} missing, ${count(r, "unknown")} unknown, fees=${r.totals.fees}`);
});

test.todo("late-night shop (needs many-to-many matching): after-midnight sales close in the previous day's terminal batch", () => {
  const rand = rng(3);
  const tx = [];
  const batch = new Map();
  for (let d = 0; d < 20; d++) {
    const date = addDays("2026-10-01", d);
    for (let i = 0; i < 20; i++) {
      const a = 2000 + Math.floor(rand() * 20000);
      tx.push(txn(`s${d}-${i}`, "POS", date, a));
      const bd = i < 2 && d > 0 ? addDays(date, -1) : date;
      batch.set(bd, (batch.get(bd) || 0) + a);
    }
  }
  for (const [d, v] of batch) tx.push(txn(`b${d}`, "BANK", addDays(d, 1), v));
  const r = reconcile(tx, [cfg("POS", "sales", 0, 0, 2), cfg("BANK", "bank")], T);
  assert.equal(count(r, "short"), 0, `${count(r, "short")} short, ${count(r, "missing")} missing, ${count(r, "unknown")} unknown`);
});

// ---------- source combinations ----------
test("only bank / only payments / payments+bank", () => {
  const r1 = reconcile([txn("b1", "BANK", "2026-10-01", 5000), txn("b2", "BANK", "2026-10-02", -300)], [cfg("BANK", "bank")], T);
  assert.equal(r1.layers.length, 0);
  assert.equal(r1.totals.received, 5000);
  const r2 = reconcile([txn("p1", "GW", "2026-10-01", 10000, { fee: 500 }), txn("p2", "GW", "2026-10-01", 10000)], [cfg("GW", "payments", 250, 0)], T);
  assert.deepEqual(r2.issues.map((i) => i.type), ["fee"]);
  assert.equal(r2.totals.fees, 750);
  const r3 = reconcile([txn("p1", "GW", "2026-10-01", 10000, { fee: 250 }), txn("p2", "GW", "2026-10-01", 20000), txn("b", "BANK", "2026-10-02", 29250)], [cfg("GW", "payments", 250, 0), cfg("BANK", "bank")], T);
  assert.equal(r3.issues.length, 0);
});

test("sales->bank with 18% delivery commission, daily payouts; totals", () => {
  const r = reconcile([txn("j1", "JAHEZ", "2026-10-01", 10000), txn("j2", "JAHEZ", "2026-10-01", 20000), txn("b", "BANK", "2026-10-03", 24600)], [cfg("JAHEZ", "sales", 1800, 0, 3), cfg("BANK", "bank")], T);
  assert.deepEqual(r.totals, { sales: 30000, salesCount: 2, cash: 0, fees: 5400, received: 24600, pending: 0, matchedSales: 2 });
});

// ---------- references ----------
test("'INV-001' vs 'inv 001' match by reference; '001' falls back to amount", () => {
  const r = reconcile([
    txn("s1", "POS", "2026-10-01", 20000, { reference: "INV-001" }), txn("p1", "GW", "2026-10-01", 15000, { reference: "inv 001" }),
    txn("s2", "POS", "2026-10-01", 7000, { reference: "INV-002" }), txn("p2", "GW", "2026-10-01", 7000, { reference: "002" }),
  ], POS_GW, T);
  assert.deepEqual(r.matches.map((m) => m.via).sort(), ["amount", "reference"]);
  assert.deepEqual(r.issues.map((i) => i.type), ["short"]);
});

test("reference collision months apart (short numeric ids) matches regardless of date/amount", () => {
  const r = reconcile([
    txn("s1", "POS", "2026-10-01", 20000, { reference: "1001" }), txn("old", "GW", "2026-06-01", 5000, { reference: "1001" }), txn("p1", "GW", "2026-10-01", 20000, { reference: "TX-88" }),
  ], POS_GW, T);
  assert.equal(count(r, "short"), 0, issuesOf(r).join());
});

// ---------- fees / tolerance / lag ----------
test("fixed-fee-only contract flags a 2.00 fee against 1.50; fee null uses the agreement", () => {
  const r = reconcile([txn("p1", "GW", "2026-10-01", 10000), txn("p2", "GW", "2026-10-01", 20000, { fee: 200 }), txn("b", "BANK", "2026-10-02", 29650)], [cfg("GW", "payments", 0, 150), cfg("BANK", "bank")], 0);
  assert.deepEqual(r.issues.map((i) => `${i.type}:${i.amount}`), ["fee:50"]);
});

test("tolerance 0: payout a few halalas ABOVE the computed net (fee rounding) -> whole day missing + unknown", () => {
  const amounts = [1234, 5678, 9101, 1213, 1415, 1617, 1819, 2021];
  const tx = amounts.map((a, i) => txn(`p${i}`, "GW", "2026-10-01", a));
  tx.push(txn("b", "BANK", "2026-10-03", amounts.reduce((s, a) => s + a - Math.floor((a * 275) / 10000), 0)), txn("later", "BANK", "2026-10-09", 1));
  const r = reconcile(tx, [cfg("GW", "payments", 275, 0, 2), cfg("BANK", "bank")], 0);
  assert.equal(count(r, "missing"), 0, issuesOf(r).join());
});

test("overpayment is invisible: by reference it is silently accepted", () => {
  const r = reconcile([txn("s1", "POS", "2026-10-01", 10000, { reference: "A1" }), txn("p1", "GW", "2026-10-01", 1500000, { reference: "a-1" })], POS_GW, T);
  assert.ok(r.issues.length > 0, "15,000 SAR received against a 100 SAR sale raised nothing");
});

// ---------- duplicates ----------
test("split card payment (same ref, same amount twice) -> short + duplicate + unknown", () => {
  const r = reconcile([
    txn("s1", "POS", "2026-10-01", 100000, { reference: "INV-9" }), txn("p1", "GW", "2026-10-01", 50000, { reference: "INV-9" }), txn("p2", "GW", "2026-10-01", 50000, { reference: "INV-9" }),
  ], POS_GW, T);
  assert.equal(r.issues.length, 0, issuesOf(r).join());
});

test("recurring rent with the same bank reference is reported as a duplicate", () => {
  const r = reconcile(["08", "09", "10"].map((m) => txn(`r${m}`, "BANK", `2026-${m}-01`, -650000, { reference: "RENT" })), [cfg("BANK", "bank")], T);
  assert.equal(count(r, "duplicate"), 0, issuesOf(r).join());
});

// ---------- partial-pass false positives ----------
test("an unrelated deposit steals one payment 1:1 and breaks the whole day's payout", () => {
  const r = reconcile([
    txn("p1", "GW", "2026-10-01", 10000), txn("p2", "GW", "2026-10-01", 20000), txn("p3", "GW", "2026-10-01", 30000),
    txn("owner", "BANK", "2026-10-02", 20000), txn("payout", "BANK", "2026-10-03", 60000), txn("later", "BANK", "2026-10-09", 1),
  ], GW_BANK, T);
  assert.equal(count(r, "missing"), 0, issuesOf(r).join());
});

test("unrelated deposit within 10% of a still-pending sale becomes a 'short' issue", () => {
  const r = reconcile([
    txn("s1", "POS", "2026-10-01", 50000), txn("b1", "BANK", "2026-10-02", 50000),
    txn("s2", "POS", "2026-10-05", 31000), txn("s3", "POS", "2026-10-05", 12000), txn("supplierRefund", "BANK", "2026-10-05", 29500),
  ], [cfg("POS", "sales", 0, 0, 3), cfg("BANK", "bank")], T);
  assert.equal(count(r, "short"), 0, issuesOf(r).join());
});

// ---------- asOf ----------
test("one bank statement exported earlier makes the other account's payouts 'missing'", () => {
  const tx = [];
  for (let d = 0; d < 30; d++) {
    const date = addDays("2026-10-01", d);
    tx.push(txn(`a${d}`, "GW-A", date, 10000 + d), txn(`b${d}`, "GW-B", date, 20000 + d), txn(`ba${d}`, "BANK-A", addDays(date, 1), 10000 + d));
    if (d < 15) tx.push(txn(`bb${d}`, "BANK-B", addDays(date, 1), 20000 + d));
  }
  const r = reconcile(tx, [cfg("GW-A", "payments"), cfg("GW-B", "payments"), cfg("BANK-A", "bank"), cfg("BANK-B", "bank")], T);
  assert.equal(count(r, "missing"), 0, `${count(r, "missing")} missing`);
});

test("a date like 2026-13-01 (passes the import regex) turns every open item into 'missing' with 'NaN' text", () => {
  const r = reconcile([txn("s1", "POS", "2026-10-08", 10000), txn("b1", "BANK", "2026-10-02", 7000), txn("bad", "BANK", "2026-13-01", 1)], [cfg("POS", "sales", 0, 0, 3), cfg("BANK", "bank")], T);
  assert.ok(!r.issues.some((i) => i.detail.includes("NaN")), r.issues.map((i) => i.detail).join(" | "));
});

// ---------- totals ----------
test("totals for a hand-computed case", () => {
  const r = reconcile([
    txn("s1", "POS", "2026-10-01", 10000, { reference: "A" }), txn("s2", "POS", "2026-10-01", 20000, { reference: "B" }),
    txn("s3", "POS", "2026-10-02", -5000), txn("s4", "POS", "2026-10-06", 30000, { reference: "D" }),
    txn("p1", "GW", "2026-10-01", 10000, { reference: "A", fee: 300 }), txn("p2", "GW", "2026-10-01", 20000, { reference: "B" }),
    txn("b1", "BANK", "2026-10-03", 29100), txn("b2", "BANK", "2026-10-06", -2000), txn("b3", "BANK", "2026-10-06", 777),
  ], [cfg("POS", "sales"), cfg("GW", "payments", 250, 100), cfg("BANK", "bank")], T);
  assert.deepEqual(r.totals, { sales: 55000, salesCount: 4, cash: 0, fees: 900, received: 29877, pending: 30000, matchedSales: 2 });
  assert.deepEqual(issuesOf(r), ["unknown:777[b3]"]);
});

test("pending counts gateway rows at gross, not the net that will reach the bank", () => {
  const r = reconcile([txn("p1", "GW", "2026-10-01", 10000), txn("b", "BANK", "2026-10-02", 9650), txn("p2", "GW", "2026-10-02", 10000)], [cfg("GW", "payments", 250, 100), cfg("BANK", "bank")], T);
  assert.equal(r.totals.pending, 9650);
});

// ---------- id stability ----------
test("appending a new month keeps month-1 issue ids (clean append)", () => {
  let gone = 0, total = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const { txns, configs } = buildShop({ days: 60, perDay: 25, cashShare: 0.1, missingRate: 0.01, seed });
    const r1 = reconcile(dbOrder(txns.filter((t) => t.date <= "2026-07-30")), configs, T);
    const ids2 = new Set(reconcile(dbOrder(txns), configs, T).issues.map((i) => i.id));
    total += r1.issues.length;
    gone += r1.issues.filter((i) => !ids2.has(i.id)).length;
  }
  assert.ok(gone / total < 0.02, `${gone}/${total} ids changed`);
});

test("one late row on a date that already has a 'missing' group re-opens it under a new id", () => {
  const { txns, configs } = buildShop({ days: 30, perDay: 20, cashShare: 0.2, seed: 4 });
  const r = reconcile(dbOrder(txns), configs, T);
  const m = r.issues.find((i) => i.type === "missing");
  const r2 = reconcile(dbOrder([...txns, txn("late", m.source, m.date, 4321)]), configs, T);
  assert.ok(r2.issues.some((i) => i.id === m.id), "resolved state is lost");
});

// ---------- regression ----------
test("demo data still surfaces exactly the planted problems", () => {
  const sources = demoSources("2026-11-04");
  const txns = sources.flatMap((s) => s.rows.map((row, i) => ({ id: `${s.kind}-${i}`, source: s.name, reference: row.reference ?? null, date: row.date, description: row.description, amount: Math.round(row.amount * 100), expected: null, fee: row.fee === undefined ? null : Math.round(row.fee * 100), branch: row.branch ?? null })));
  const r = reconcile(txns, sources.map((s) => ({ name: s.name, kind: s.kind, feeBps: s.feeBps, feeFixed: s.feeFixedHalalas, lagDays: s.lagDays })), 100);
  assert.deepEqual(r.issues.map((i) => i.type).sort(), ["duplicate", "fee", "fee", "missing", "missing", "missing", "short", "unknown", "unknown"]);
});

// ---------- performance (Cloudflare Worker budget ~1s) ----------
const timed = (txns, configs) => { const t0 = performance.now(); reconcile(txns, configs, T); return performance.now() - t0; };
test("perf: 20k-row coffee shop (5 prices, no refs) under 1s", () => {
  const { txns, configs } = buildShop({ days: 60, perDay: 180, seed: 2, refs: false, cashShare: 0.15, priceList: [900, 1200, 1500, 1800, 2200] });
  const ms = timed(dbOrder(txns), configs);
  assert.ok(ms < 1000, `${ms.toFixed(0)} ms`);
});

test("perf: 5k rows where nothing matches under 1s", () => {
  const rand = rng(1);
  const tx = [];
  for (let i = 0; i < 1666; i++) {
    const date = addDays("2026-07-01", Math.floor((i / 1666) * 60));
    for (const [p, s] of [["s", "POS"], ["p", "GW"], ["b", "BANK"]]) tx.push(txn(`${p}${i}`, s, date, 1000 + Math.floor(rand() * 90000)));
  }
  const ms = timed(dbOrder(tx), [cfg("POS", "sales"), cfg("GW", "payments", 250, 100), cfg("BANK", "bank")]);
  assert.ok(ms < 1000, `${ms.toFixed(0)} ms`);
});

test("sales marked as cash are not expected in the gateway or the bank", () => {
  const { txns, configs } = buildShop({ days: 30, perDay: 30, cashShare: 0.3, seed: 7 });
  const r = reconcile(txns.map((t) => (t.source === "POS" && !txns.some((o) => o.source === "GW" && o.reference && o.reference === t.reference) ? { ...t, method: "نقدي" } : t)), configs, T);
  assert.ok(count(r, "missing") <= 2, `${count(r, "missing")} missing`);
  assert.ok(r.totals.cash > 0);
});

test("perf: 10k sales + 10k unrelated bank rows under 2s", () => {
  const rand = rng(5);
  const tx = [];
  for (let i = 0; i < 10000; i++) {
    const date = addDays("2026-01-01", Math.floor(rand() * 300));
    tx.push(txn(`s${i}`, "POS", date, 5000 + Math.floor(rand() * 90000)), txn(`b${i}`, "BANK", date, 5000 + Math.floor(rand() * 90000)));
  }
  const ms = timed(tx, [cfg("POS", "sales", 0, 0, 3), cfg("BANK", "bank")]);
  assert.ok(ms < 2000, `${ms.toFixed(0)} ms`);
});
