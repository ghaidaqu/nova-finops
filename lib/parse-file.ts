// Reads CSV and Excel exports in the browser and turns them into import rows.
// Handles Arabic headers and digits, thousands separators, "SAR"/"ر.س" suffixes,
// day-first dates, and bank statements with separate credit and debit columns.

export type Cell = string | number | boolean | Date | null;
export type Table = { headers: string[]; rows: Cell[][] };
export type Field = "date" | "amount" | "credit" | "debit" | "reference" | "description" | "fee" | "branch" | "expected";
export type Mapping = Partial<Record<Field, number>>;
export type ParsedRow = { date: string; amount: number; reference?: string; description?: string; fee?: number; branch?: string; expected?: number };

const arabicDigits = /[٠-٩۰-۹]/g;
const toLatin = (text: string) => text.replace(arabicDigits, (d) => String((d.charCodeAt(0) & 0xf) % 10)).replace(/٫/g, ".").replace(/٬/g, ",");

export function parseCsv(text: string): Cell[][] {
  const clean = text.replace(/^﻿/, "");
  // Judge by the first lines together: exports often start with a title row that has no delimiter.
  const sample = clean.split("\n", 6).join("\n");
  const delimiter = [",", ";", "\t", "|"].map((d) => [d, sample.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) {
      if (c === '"' && clean[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === delimiter) {
      row.push(field.trim());
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && clean[i + 1] === "\n") i++;
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) rows.push([...row, field.trim()]);
  return rows.filter((r) => r.some((cell) => cell !== ""));
}

// The header is the first row with at least two text cells among the first ten rows.
export function toTable(cells: Cell[][]): Table {
  const headerIndex = Math.max(0, cells.slice(0, 10).findIndex((r) => r.filter((c) => typeof c === "string" && c.trim() && !/^[\d.,\s-]+$/.test(c)).length >= 2));
  const width = Math.max(...cells.map((r) => r.length), 0);
  const headers = Array.from({ length: width }, (_, i) => String(cells[headerIndex]?.[i] ?? "").trim() || `عمود ${i + 1}`);
  return { headers, rows: cells.slice(headerIndex + 1).filter((r) => r.some((c) => c !== null && c !== "")) };
}

export async function readFile(file: File): Promise<Table> {
  if (/\.xlsx$/i.test(file.name)) {
    const { readSheet } = await import("read-excel-file/browser");
    return toTable((await readSheet(file)) as Cell[][]);
  }
  if (/\.xls$/i.test(file.name)) throw new Error("صيغة xls القديمة غير مدعومة. احفظ الملف بصيغة xlsx أو CSV.");
  return toTable(parseCsv(await file.text()));
}

const synonyms: Record<Field, string[]> = {
  date: ["date", "التاريخ", "تاريخ", "transaction date", "order date", "payout date", "value date", "posting date", "created", "تاريخ العملية", "تاريخ الطلب", "تاريخ الحركة", "day"],
  credit: ["credit", "دائن", "إيداع", "ايداع", "deposit", "deposits", "وارد", "مبلغ دائن"],
  debit: ["debit", "مدين", "سحب", "withdrawal", "withdrawals", "صادر", "مبلغ مدين"],
  amount: ["amount", "المبلغ", "مبلغ", "total", "الإجمالي", "الاجمالي", "gross", "القيمة", "قيمة", "value", "sales", "المبيعات", "net", "الصافي", "صافي", "actual", "grand total", "order total"],
  reference: ["reference", "ref", "رقم المرجع", "المرجع", "order id", "order", "رقم الطلب", "invoice", "رقم الفاتورة", "transaction id", "رقم العملية", "id", "receipt", "رقم الإيصال", "payment id"],
  description: ["description", "الوصف", "البيان", "بيان", "details", "التفاصيل", "narrative", "memo", "customer", "العميل", "name", "notes", "ملاحظات"],
  fee: ["fee", "fees", "الرسوم", "رسوم", "commission", "العمولة", "عمولة", "charges", "processing fee"],
  branch: ["branch", "الفرع", "فرع", "store", "location", "المتجر", "channel", "القناة"],
  expected: ["expected", "المتوقع", "متوقع"],
};

const normHeader = (h: string) => toLatin(h).toLowerCase().replace(/[_\-:()]/g, " ").replace(/\s+/g, " ").trim();

export function guessMapping(headers: string[]): Mapping {
  const mapping: Mapping = {};
  const used = new Set<number>();
  const order: Field[] = ["date", "credit", "debit", "fee", "expected", "reference", "branch", "amount", "description"];
  for (const field of order) {
    const names = synonyms[field];
    let index = headers.findIndex((h, i) => !used.has(i) && names.includes(normHeader(h)));
    if (index < 0) index = headers.findIndex((h, i) => !used.has(i) && names.some((n) => n.length > 3 && normHeader(h).includes(n)));
    if (index >= 0) {
      mapping[field] = index;
      used.add(index);
    }
  }
  // A plain amount column wins over a credit/debit pair only when both are missing.
  if (mapping.amount !== undefined && (mapping.credit !== undefined || mapping.debit !== undefined)) delete mapping.amount;
  return mapping;
}

export function parseAmount(value: Cell): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  let text = toLatin(value).trim();
  if (!text) return null;
  const negative = /^\(.*\)$/.test(text) || /-\s*$/.test(text) || /^-/.test(text.replace(/[^\d.,-]/g, ""));
  text = text.replace(/ر\.س|s\.?a\.?r/gi, "").replace(/[^\d.,]/g, "").replace(/[.,]+$/, "");
  // "1.234,50" (European) vs "1,234.50": the last separator is the decimal one when followed by 1-2 digits.
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  if (lastComma > lastDot && /,\d{1,2}$/.test(text)) text = text.replace(/\./g, "").replace(",", ".");
  else text = text.replace(/,/g, "");
  if (!text || Number.isNaN(Number(text))) return null;
  return negative ? -Number(text) : Number(text);
}

const pad = (n: number) => String(n).padStart(2, "0");

export function parseDate(value: Cell): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  if (typeof value === "number" && value > 20000 && value < 80000) {
    // Excel serial day number.
    return new Date(Date.UTC(1899, 11, 30) + value * 86_400_000).toISOString().slice(0, 10);
  }
  if (typeof value !== "string") return null;
  const text = toLatin(value).trim();
  let m = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    // Day first, as used in Saudi exports; fall back to month first when the day is impossible.
    return valid(year, +m[2], +m[1]) ?? valid(year, +m[1], +m[2]);
  }
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10);
}

function valid(year: number, month: number, day: number) {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1990 || year > 2100) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCDate() === day ? `${year}-${pad(month)}-${pad(day)}` : null;
}

const cellText = (value: Cell) => (value instanceof Date ? parseDate(value) || "" : value === null || value === undefined ? "" : String(value).trim());

export function toRows(table: Table, mapping: Mapping) {
  const rows: ParsedRow[] = [];
  let invalid = 0;
  const at = (row: Cell[], field: Field) => (mapping[field] === undefined ? null : row[mapping[field]!] ?? null);
  for (const row of table.rows) {
    const date = parseDate(at(row, "date"));
    let amount = parseAmount(at(row, "amount"));
    if (mapping.amount === undefined && (mapping.credit !== undefined || mapping.debit !== undefined)) {
      const credit = parseAmount(at(row, "credit")) ?? 0;
      const debit = parseAmount(at(row, "debit")) ?? 0;
      amount = credit || debit ? credit - Math.abs(debit) : null;
    }
    if (!date || amount === null) {
      invalid++;
      continue;
    }
    const fee = parseAmount(at(row, "fee"));
    const expected = parseAmount(at(row, "expected"));
    rows.push({
      date,
      amount,
      reference: cellText(at(row, "reference")) || undefined,
      description: cellText(at(row, "description")) || undefined,
      fee: fee === null ? undefined : Math.abs(fee),
      branch: cellText(at(row, "branch")) || undefined,
      expected: expected ?? undefined,
    });
  }
  return { rows, invalid };
}
