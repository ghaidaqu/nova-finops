import assert from "node:assert/strict";
import { test } from "node:test";
import { guessMapping, parseAmount, parseCsv, parseDate, toRows, toTable } from "../lib/parse-file.ts";

test("amounts in the formats Saudi exports use", () => {
  assert.equal(parseAmount("1,234.50"), 1234.5);
  assert.equal(parseAmount("١٬٢٣٤٫٥٠ ر.س"), 1234.5);
  assert.equal(parseAmount("SAR 980"), 980);
  assert.equal(parseAmount("(150.00)"), -150);
  assert.equal(parseAmount("-75"), -75);
  assert.equal(parseAmount("1.234,50"), 1234.5);
  assert.equal(parseAmount(""), null);
  assert.equal(parseAmount("n/a"), null);
});

test("dates: ISO, day-first, Arabic digits and Excel serials", () => {
  assert.equal(parseDate("2026-10-21 14:30"), "2026-10-21");
  assert.equal(parseDate("21/10/2026"), "2026-10-21");
  assert.equal(parseDate("٢١/١٠/٢٠٢٦"), "2026-10-21");
  assert.equal(parseDate("10/21/2026"), "2026-10-21");
  assert.equal(parseDate(46316), "2026-10-21");
  assert.equal(parseDate("31/02/2026"), null);
});

test("quoted CSV with an Arabic header and a title row above it", () => {
  const csv = '﻿كشف حساب\nالتاريخ;البيان;مدين;دائن\n21/10/2026;"تحويل; وارد";;"1,500.00"\n22/10/2026;إيجار;6500;\n';
  const table = toTable(parseCsv(csv));
  assert.deepEqual(table.headers, ["التاريخ", "البيان", "مدين", "دائن"]);
  const mapping = guessMapping(table.headers);
  assert.deepEqual(mapping, { date: 0, description: 1, debit: 2, credit: 3 });
  const { rows, invalid } = toRows(table, mapping);
  assert.equal(invalid, 0);
  assert.deepEqual(rows.map((r) => [r.date, r.amount, r.description]), [["2026-10-21", 1500, "تحويل; وارد"], ["2026-10-22", -6500, "إيجار"]]);
});

test("gateway export with fee and order id columns", () => {
  const table = toTable(parseCsv("Order ID,Created,Gross Amount,Processing Fee,Store\nA-1,2026-10-01,100,3.5,Online\nA-2,bad date,50,1,Online\n"));
  const mapping = guessMapping(table.headers);
  assert.equal(mapping.reference, 0);
  assert.equal(mapping.date, 1);
  assert.equal(mapping.amount, 2);
  assert.equal(mapping.fee, 3);
  assert.equal(mapping.branch, 4);
  const { rows, invalid } = toRows(table, mapping);
  assert.equal(invalid, 1);
  assert.deepEqual(rows[0], { date: "2026-10-01", amount: 100, reference: "A-1", description: undefined, fee: 3.5, branch: "Online", expected: undefined });
});

test("sample files import and reconcile end to end", async () => {
  const { readFileSync } = await import("node:fs");
  const { reconcile } = await import("../lib/reconcile.ts");
  const kinds = { sales: "sales", gateway: "payments", bank: "bank" };
  const txns = [];
  for (const file of Object.keys(kinds)) {
    const table = toTable(parseCsv(readFileSync(new URL(`../public/samples/${file}.csv`, import.meta.url), "utf8")));
    const { rows, invalid } = toRows(table, guessMapping(table.headers));
    assert.equal(invalid, 0, file);
    rows.forEach((r, i) => txns.push({ id: `${file}-${i}`, source: file, reference: r.reference ?? null, date: r.date, description: r.description ?? "", amount: Math.round(r.amount * 100), expected: null, fee: r.fee === undefined ? null : Math.round(r.fee * 100), branch: r.branch ?? null }));
  }
  const configs = Object.entries(kinds).map(([name, kind]) => ({ name, kind, feeBps: 0, feeFixed: 0, lagDays: 2 }));
  const types = reconcile(txns, configs, 100).issues.map((i) => i.type);
  const count = (t) => types.filter((x) => x === t).length;
  assert.deepEqual([count("missing"), count("short"), count("duplicate"), count("unknown"), count("fee")], [3, 1, 1, 2, 0]);
});
