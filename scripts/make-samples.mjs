// Writes public/samples/*.csv from the demo business, shaped like real exports:
// an Arabic POS export, an English gateway report, a bank statement with a title row, and an
// expenses list.
// Run: node scripts/make-samples.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { demoSources } from "../lib/demo-data.ts";

const [sales, gateway, bank, expenses] = demoSources("2026-11-01");
const dmy = (iso) => iso.split("-").reverse().join("/");
const csv = (rows) => "﻿" + rows.map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(",")).join("\n") + "\n";

mkdirSync("public/samples", { recursive: true });
writeFileSync("public/samples/sales.csv", csv([["رقم الطلب", "التاريخ", "الفرع", "الوصف", "الإجمالي"], ...sales.rows.map((r) => [r.reference, dmy(r.date), r.branch, r.description, r.amount.toFixed(2)])]));
writeFileSync("public/samples/gateway.csv", csv([["Order ID", "Date", "Amount", "Fee", "Description"], ...gateway.rows.map((r) => [r.reference, r.date, r.amount.toFixed(2), r.fee.toFixed(2), r.description])]));
let balance = 25000;
writeFileSync("public/samples/bank.csv", csv([["كشف حساب جاري - مؤسسة تجريبية"], ["التاريخ", "البيان", "مدين", "دائن", "الرصيد"], ...[...bank.rows].sort((a, b) => a.date.localeCompare(b.date)).map((r) => {
  balance += r.amount;
  return [dmy(r.date), `${r.description} ${r.reference}`, r.amount < 0 ? (-r.amount).toFixed(2) : "", r.amount > 0 ? r.amount.toFixed(2) : "", balance.toFixed(2)];
})]));
writeFileSync("public/samples/expenses.csv", csv([["التاريخ", "البند", "المورد / الجهة", "المبلغ"], ...expenses.rows.map((r) => [dmy(r.date), r.description, r.reference, r.amount.toFixed(2)])]));
console.log("samples:", sales.rows.length, gateway.rows.length, bank.rows.length, expenses.rows.length);
