// Reads CSV and Excel exports in the browser and turns them into import rows.
// Built for what Saudi businesses actually export: bank statements (title blocks above the
// table, debit/credit columns or one amount with a Dr/Cr column, opening-balance rows),
// gateway and delivery-app reports (gross, fee, VAT on fee, failed/refunded rows), store,
// POS and invoice exports (order status, payment method), Arabic or English headers and
// digits, day-first or month-first dates, Hijri dates, UTF-8, UTF-16 and Windows-1256 text.

export type Cell = string | number | boolean | Date | null;
export type Sheet = { name: string; cells: Cell[][] };
export type Table = { headers: string[]; rows: Cell[][]; headerIndex: number };
export type Field = "date" | "amount" | "credit" | "debit" | "direction" | "reference" | "description" | "fee" | "tax" | "branch" | "method" | "status" | "expected";
export type Mapping = Partial<Record<Field, number>>;
export type ParsedRow = { date: string; amount: number; reference?: string; description?: string; fee?: number; branch?: string; method?: string; expected?: number };
export type Kind = "sales" | "payments" | "bank" | "expenses";

const toLatin = (text: string) => text.replace(/[٠-٩۰-۹]/g, (d) => String((d.charCodeAt(0) & 0xf) % 10)).replace(/٫/g, ".").replace(/٬/g, ",");

// ---------------------------------------------------------------- reading

export function decodeText(bytes: Uint8Array) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // Older Arabic Windows/Excel exports.
    return new TextDecoder("windows-1256").decode(bytes);
  }
}

export function parseCsv(text: string): Cell[][] {
  const clean = text.replace(/^﻿/, "");
  // Judge by the first lines together: exports often start with a title row that has no delimiter.
  const sample = clean.split("\n", 12).join("\n");
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

export async function readFile(file: File): Promise<Sheet[]> {
  if (/\.xlsx$/i.test(file.name)) {
    const { default: readXlsxFile } = await import("read-excel-file/browser");
    return (await readXlsxFile(file)).map((s) => ({ name: s.sheet, cells: s.data as Cell[][] }));
  }
  if (/\.xls$/i.test(file.name)) throw new Error("صيغة xls القديمة غير مدعومة. احفظ الملف بصيغة xlsx أو CSV.");
  return [{ name: file.name, cells: parseCsv(decodeText(new Uint8Array(await file.arrayBuffer()))) }];
}

// ---------------------------------------------------------------- headers

// Lowercase, Latin digits, no punctuation or Arabic diacritics, unified alef/ya/ta marbuta,
// and the definite article dropped from each word ("الإجمالي" -> "اجمالي").
export function normHeader(text: string) {
  return toLatin(text)
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ئ/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .map((w) => (w.startsWith("ال") && w.length > 3 ? w.slice(2) : w))
    .filter(Boolean)
    .join(" ");
}

type Rule = { names: string[]; exclude?: string[]; exactOnly?: string[] };

// Names are in priority order: earlier names win over later ones.
const rules: Record<Field, Rule> = {
  date: {
    names: ["transaction date", "posting date", "booking date", "business date", "order date", "invoice date", "issue date", "payment date", "settlement date", "created at", "created", "creation date", "date", "تاريخ عمليه", "تاريخ حركه", "تاريخ طلب", "تاريخ فاتوره", "تاريخ اصدار", "تاريخ دفع", "تاريخ قيد", "تاريخ", "value date", "order time", "transaction time", "وقت طلب", "time", "وقت", "day", "يوم"],
    exclude: ["due", "استحقاق", "هجري", "hijri", "opened", "closed", "expiry", "انتهاء", "birth", "ميلاد"],
  },
  amount: {
    names: ["amount", "مبلغ", "total price", "order total", "grand total", "invoice total", "total amount", "transaction amount", "order amount", "gross amount", "gross", "total", "اجمالي", "مبلغ اجمالي", "اجمالي مبلغ", "قيمه طلب", "قيمه", "مبلغ عمليه", "مبلغ حركه", "sales", "مبيعات", "net amount", "net", "صافي", "مبلغ صافي", "paid amount", "price"],
    exclude: ["date", "تاريخ", "time", "sub", "subtotal", "فرعي", "rate", "نسبه", "percent", "shipping", "شحن", "delivery", "توصيل", "status", "حاله", "balance", "رصيد", "id", "رقم", "no", "count", "عدد", "qty", "quantity", "كميه", "commission", "عموله", "fee", "fees", "رسوم", "discount", "خصم", "tax", "vat", "ضريبه", "before", "قبل", "due", "متبقي", "refunded", "مسترد", "tip", "اكراميه", "currency", "عمله"],
    exactOnly: ["value", "قيمه"],
  },
  credit: { names: ["credit", "credits", "credit amount", "دائن", "مبلغ دائن", "ايداع", "ايداعات", "deposit", "deposits", "وارد", "money in", "paid in"], exclude: ["debit", "مدين", "card", "بطاقه"] },
  debit: { names: ["debit", "debits", "debit amount", "مدين", "مبلغ مدين", "سحب", "سحوبات", "withdrawal", "withdrawals", "صادر", "money out", "paid out"], exclude: ["credit", "دائن", "داين", "card", "بطاقه"] },
  direction: { names: ["dr cr", "cr dr", "drcr", "d c", "c d", "debit credit", "credit debit", "مدين داين", "داين مدين", "transaction type", "نوع عمليه", "نوع حركه", "indicator"], exactOnly: ["type", "نوع"] },
  reference: {
    names: ["order id", "order number", "order no", "رقم طلب", "invoice number", "invoice no", "رقم فاتوره", "merchant reference", "order reference", "reference number", "reference no", "reference", "ref", "رقم مرجع", "مرجع", "receipt number", "رقم ايصال", "transaction id", "رقم عمليه", "رقم حركه", "payment id", "charge id", "order", "طلب", "invoice", "فاتوره"],
    exclude: ["status", "حاله", "date", "تاريخ", "time", "type", "نوع", "amount", "مبلغ", "total", "اجمالي", "merchant id", "terminal", "batch", "customer", "عميل", "account", "حساب", "iban", "phone", "جوال", "قيمه"],
    exactOnly: ["id"],
  },
  description: { names: ["description", "وصف", "بيان", "بند", "details", "تفاصيل", "تفاصيل عمليه", "category", "تصنيف", "narrative", "narration", "memo", "particulars", "remarks", "notes", "ملاحظات", "customer name", "اسم عميل", "customer", "عميل", "contact", "name"], exclude: ["date", "تاريخ", "id", "رقم", "phone", "جوال", "email"] },
  fee: { names: ["fee", "fees", "processing fee", "transaction fee", "mdr fee", "mdr", "commission amount", "مبلغ عموله", "commission", "عموله", "رسوم", "رسوم معالجه", "رسوم بوابه", "charges", "platform fee", "service fee"], exclude: ["rate", "نسبه", "percent", "shipping", "شحن", "delivery", "توصيل", "vat", "tax", "ضريبه"] },
  tax: { names: ["vat on fee", "fee vat", "vat on fees", "vat on commission", "commission vat", "vat on mdr", "mdr vat", "tax on fee", "ضريبه رسوم", "ضريبه عموله"], exactOnly: ["tax", "vat", "ضريبه", "ضريبه قيمه مضافه"] },
  branch: { names: ["branch", "فرع", "store", "متجر", "location", "outlet", "shop", "channel", "قناه", "نقطه بيع"], exclude: ["sub", "فرعي", "id", "رقم", "store credit"] },
  method: { names: ["payment method", "payment methods", "payment type", "طريقه دفع", "نوع دفع", "وسيله دفع", "tender", "source type", "method"] },
  status: { names: ["order status", "payment status", "transaction status", "status", "حاله طلب", "حاله دفع", "حاله", "state", "result"] },
  expected: { names: ["expected amount", "expected", "مبلغ متوقع", "متوقع"] },
};
const compiled = Object.fromEntries(
  Object.entries(rules).map(([field, rule]) => [
    field,
    { names: rule.names.map(normHeader), exclude: (rule.exclude || []).map(normHeader), exactOnly: (rule.exactOnly || []).map(normHeader) },
  ]),
) as Record<Field, { names: string[]; exclude: string[]; exactOnly: string[] }>;

const containsWords = (header: string, phrase: string) => ` ${header} `.includes(` ${phrase} `);

// Higher is better; 0 means the header can't be this field.
function headerScore(rawHeader: string, field: Field, kind: Kind) {
  const header = normHeader(rawHeader);
  if (!header) return 0;
  const rule = compiled[field];
  if (/%/.test(rawHeader) && field !== "description") return 0;
  if (field === "tax" && kind !== "payments" && !rule.names.some((n) => containsWords(header, n))) return 0;
  // A header naming both sides ("مدين/دائن", "Debit/Credit") says which side each row is on.
  const both = /(^| )(debit|dr|مدين)( |$)/.test(header) && /(^| )(credit|cr|داين)( |$)/.test(header);
  if (both && field !== "direction") return 0;
  if (both && field === "direction") return 1000;
  if (rule.exclude.some((x) => containsWords(header, x)) && !rule.names.some((n) => n === header)) return 0;
  const words = header.split(" ").length;
  let best = 0;
  // An exact name beats a name found inside a longer header ("Gross Amount" over "Net Amount"
  // containing "amount"); within each, earlier names win.
  rule.names.forEach((name, rank) => {
    if (name === header) best = Math.max(best, 1300 - rank * 10);
    else if (containsWords(header, name)) best = Math.max(best, 1000 - rank * 10 - (words - name.split(" ").length) * 2);
  });
  rule.exactOnly.forEach((name) => {
    if (name === header) best = Math.max(best, 400);
  });
  return best;
}

// The header row is the one, among the first 30, that names the most known fields.
export function detectHeader(cells: Cell[][]) {
  let best = -1;
  let bestScore = 1;
  cells.slice(0, 30).forEach((row, i) => {
    const texts = row.filter((c): c is string => typeof c === "string" && c.trim() !== "" && !/^[\d\s.,:/-]+$/.test(toLatin(c)));
    if (texts.length < 2) return;
    const fields = new Set<Field>();
    for (const t of texts) for (const f of Object.keys(rules) as Field[]) if (headerScore(t, f, "payments") > 0) fields.add(f);
    const score = fields.size + (fields.has("date") ? 1 : 0) + (fields.has("amount") || fields.has("credit") || fields.has("debit") ? 1 : 0);
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  if (best >= 0) return best;
  return Math.max(0, cells.slice(0, 10).findIndex((r) => r.filter((c) => typeof c === "string" && c.trim() && !/^[\d.,\s-]+$/.test(c)).length >= 2));
}

export function toTable(cells: Cell[][], headerIndex = detectHeader(cells)): Table {
  const width = Math.max(...cells.map((r) => r.length), 0);
  const headers = Array.from({ length: width }, (_, i) => String(cells[headerIndex]?.[i] ?? "").trim() || `عمود ${i + 1}`);
  return { headers, rows: cells.slice(headerIndex + 1).filter((r) => r.some((c) => c !== null && c !== "")), headerIndex };
}

export function bestSheet(sheets: Sheet[]) {
  let best = 0;
  let bestScore = -1;
  sheets.forEach((s, i) => {
    const table = toTable(s.cells);
    const mapping = guessMapping(table.headers, "sales", table.rows);
    const score = Object.keys(mapping).length * 10 + Math.min(table.rows.length, 9);
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best;
}

const signals = {
  bank: ["balance", "رصيد", "iban", "ايبان", "narrative", "narration", "posting date", "value date", "debit", "credit", "مدين", "داين", "cheque", "شيك", "withdrawal", "deposit", "ايداع", "سحب", "statement", "كشف", "bank", "بنك", "مصرف", "dr cr", "account statement", "كشف حساب"],
  payments: ["fee", "fees", "mdr", "رسوم", "عموله", "commission", "payout", "settlement", "تسويه", "gateway", "net", "صافي", "charge", "captured", "moyasar", "ميسر", "tap", "hyperpay", "paytabs", "stripe", "tabby", "tamara", "تابي", "تمارا", "jahez", "جاهز", "hungerstation", "هنقرستيشن", "keeta", "كيتا", "mrsool", "مرسول", "ninja", "نينجا", "toyou", "careem", "chefz"],
  expenses: ["expense", "expenses", "مصروف", "مصاريف", "مصروفات", "cost", "costs", "تكلفه", "تكاليف", "رواتب", "salary", "salaries", "payroll", "ايجار", "rent", "مورد", "موردين", "supplier", "vendor", "مشتريات", "purchase", "purchases", "bill", "bills", "فواتير مشتريات", "category", "تصنيف", "بند"],
  sales: ["order", "طلب", "invoice", "فاتوره", "customer", "عميل", "branch", "فرع", "item", "صنف", "product", "منتج", "subtotal", "discount", "خصم", "shipping", "شحن", "pos", "cashier", "كاشير"],
};

// Which kind of source a file looks like, from its name and headers.
export function guessKind(fileName: string, headers: string[]): Kind {
  const texts = [normHeader(fileName.replace(/\.[^.]+$/, "")), ...headers.map(normHeader)];
  const hits = (list: string[]) => list.filter((s) => texts.some((t) => containsWords(t, normHeader(s)))).length;
  const bankStrong = texts.some((t) => /(^| )(balance|رصيد|iban|ايبان)( |$)/.test(t)) || headers.some((h) => headerScore(h, "direction", "bank") >= 1000) || (texts.some((t) => /(^| )(debit|مدين)( |$)/.test(t)) && texts.some((t) => /(^| )(credit|داين)( |$)/.test(t)));
  // A running balance or an IBAN only appears on bank statements.
  if (headers.map(normHeader).some((t) => /(^| )(balance|رصيد|iban|ايبان)( |$)/.test(t))) return "bank";
  if (bankStrong && hits(signals.bank) >= 2) return "bank";
  // Expense files: named so, or full of cost words (suppliers, salaries, rent, categories).
  const namedExpenses = /(^| )(مصروف|مصاريف|مصروفات|تكاليف|expense|expenses|costs)( |$)/.test(texts[0]);
  if (namedExpenses || (hits(signals.expenses) >= 2 && hits(signals.expenses) > hits(signals.sales))) return "expenses";
  if (headers.some((h) => headerScore(h, "fee", "payments") > 0)) return "payments";
  return hits(signals.payments) > hits(signals.sales) ? "payments" : "sales";
}

// ---------------------------------------------------------------- values

const SUFFIX_DEBIT = /(\bdr\b|\bdebit\b|مدين)\s*$/i;
const SUFFIX_CREDIT = /(\bcr\b|\bcredit\b|دائن|داين)\s*$/i;

export function parseAmount(value: Cell): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  let text = toLatin(value).replace(/−/g, "-").trim();
  if (!text || /%/.test(text)) return null;
  // Dates and times are not amounts.
  if (/\d[/:]\d/.test(text) || /^\d{4}-\d{1,2}-\d{1,2}/.test(text)) return null;
  const debitSuffix = SUFFIX_DEBIT.test(text);
  text = text.replace(SUFFIX_DEBIT, "").replace(SUFFIX_CREDIT, "").trim();
  const negative = debitSuffix || /^\(.*\)$/.test(text) || /-\s*$/.test(text) || /^-/.test(text.replace(/[^\d.,-]/g, ""));
  text = text.replace(/ر\.\s*س|s\.?\s*r\.?|sar|ريال|﷼/gi, "").replace(/[^\d.,]/g, "").replace(/[.,]+$/, "");
  // "1.234,50" (European) vs "1,234.50": the last separator is the decimal one when followed by 1-2 digits.
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  if (lastComma > lastDot && /,\d{1,2}$/.test(text)) text = text.replace(/\./g, "").replace(",", ".");
  else text = text.replace(/,/g, "");
  if (!text || Number.isNaN(Number(text))) return null;
  return negative ? -Number(text) : Number(text);
}

const pad = (n: number) => String(n).padStart(2, "0");
const DAY = 86_400_000;

function valid(year: number, month: number, day: number) {
  if (year >= 1400 && year <= 1500) return hijri(year, month, day);
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1990 || year > 2100) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCDate() === day ? `${year}-${pad(month)}-${pad(day)}` : null;
}

// Umm al-Qura Hijri date to Gregorian: start from the arithmetic calendar, then let the
// built-in Umm al-Qura calendar confirm the exact day.
const hijriFormat = (() => {
  try {
    return new Intl.DateTimeFormat("en-u-ca-islamic-umalqura-nu-latn", { day: "numeric", month: "numeric", year: "numeric", timeZone: "UTC" });
  } catch {
    return null;
  }
})();
function hijri(year: number, month: number, day: number) {
  if (month < 1 || month > 12 || day < 1 || day > 30) return null;
  const jd = Math.floor((11 * year + 3) / 30) + 354 * year + 30 * month - Math.floor((month - 1) / 2) + day + 1948440 - 385;
  const guess = (jd - 2440588) * DAY;
  for (const shift of [0, -1, 1, -2, 2, -3, 3]) {
    const t = guess + shift * DAY;
    const parts = hijriFormat?.formatToParts(new Date(t));
    const get = (type: string) => Number(parts?.find((p) => p.type === type)?.value);
    if (!parts || (get("year") === year && get("month") === month && get("day") === day)) return new Date(t).toISOString().slice(0, 10);
  }
  return null;
}

const months: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  يناير: 1, فبراير: 2, مارس: 3, ابريل: 4, أبريل: 4, مايو: 5, يونيو: 6, يوليو: 7, اغسطس: 8, أغسطس: 8, سبتمبر: 9, اكتوبر: 10, أكتوبر: 10, نوفمبر: 11, ديسمبر: 12,
};
const monthOf = (word: string) => months[word.toLowerCase()] ?? months[word.toLowerCase().slice(0, 3)];

export type DateOrder = "dmy" | "mdy";

export function parseDate(value: Cell, order: DateOrder = "dmy"): string | null {
  // Excel stores the wall-clock date; the reader hands it over as UTC.
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
  if (typeof value === "number") {
    // Excel serial day number.
    return value > 20000 && value < 80000 ? new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * DAY).toISOString().slice(0, 10) : null;
  }
  if (typeof value !== "string") return null;
  const text = toLatin(value).trim();
  // Timestamps with a zone (gateway APIs export UTC): the business day is the Saudi one.
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
    const t = Date.parse(text.replace(" ", "T"));
    return Number.isNaN(t) ? null : new Date(t + 3 * 3_600_000).toISOString().slice(0, 10);
  }
  let m = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return order === "mdy" ? (valid(year, +m[1], +m[2]) ?? valid(year, +m[2], +m[1])) : (valid(year, +m[2], +m[1]) ?? valid(year, +m[1], +m[2]));
  }
  m = text.match(/^(\d{1,2})[\s\-./]+([\p{L}]+)[\s\-.,/]+(\d{4})/u);
  if (m && monthOf(m[2])) return valid(+m[3], monthOf(m[2]), +m[1]);
  m = text.match(/^([\p{L}]+)[\s\-.]+(\d{1,2}),?[\s\-.]+(\d{4})/u);
  if (m && monthOf(m[1])) return valid(+m[3], monthOf(m[1]), +m[2]);
  return null;
}

// Decide day-first or month-first once for a whole column, from the values that can only be one.
export function dateOrder(values: Cell[]): DateOrder {
  let dayFirst = 0;
  let monthFirst = 0;
  for (const v of values) {
    if (typeof v !== "string") continue;
    const m = toLatin(v).trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/);
    if (!m) continue;
    if (+m[1] > 12) dayFirst++;
    if (+m[2] > 12) monthFirst++;
  }
  return monthFirst > dayFirst ? "mdy" : "dmy";
}

// ---------------------------------------------------------------- mapping

// \b only knows Latin letters, so the word end is "not followed by a letter".
const DEBIT_WORD = /^(dr|d|debit|مدين|سحب|withdrawal|out)(?!\p{L})/iu;
const CREDIT_WORD = /^(cr|c|credit|دائن|داين|ايداع|إيداع|deposit|in)(?!\p{L})/iu;

export function guessMapping(headers: string[], kind: Kind = "sales", rows: Cell[][] = []): Mapping {
  const candidates: { field: Field; index: number; score: number }[] = [];
  for (const field of Object.keys(rules) as Field[]) {
    headers.forEach((h, index) => {
      const score = headerScore(h, field, kind);
      if (score > 0) candidates.push({ field, index, score });
    });
  }
  // Best pairs first; each field and each column used once.
  candidates.sort((a, b) => b.score - a.score || a.index - b.index);
  const mapping: Mapping = {};
  const used = new Set<number>();
  for (const c of candidates) {
    if (mapping[c.field] !== undefined || used.has(c.index)) continue;
    mapping[c.field] = c.index;
    used.add(c.index);
  }
  const sample = rows.slice(0, 50);
  const values = (i: number) => sample.map((r) => r[i]).filter((v) => v !== null && v !== undefined && v !== "");
  // A direction column must actually hold Dr/Cr words.
  if (mapping.direction !== undefined) {
    const v = values(mapping.direction).map((x) => toLatin(String(x)).trim());
    if (v.length && v.filter((x) => DEBIT_WORD.test(x) || CREDIT_WORD.test(x)).length < v.length * 0.6) delete mapping.direction;
  }
  // If the named date column doesn't hold dates, use the column that does.
  if (sample.length && (mapping.date === undefined || values(mapping.date).filter((v) => parseDate(v)).length < values(mapping.date).length / 2)) {
    const better = headers.findIndex((_, i) => !used.has(i) && values(i).length && values(i).filter((v) => parseDate(v)).length >= values(i).length * 0.8);
    if (better >= 0) {
      if (mapping.date !== undefined) used.delete(mapping.date);
      mapping.date = better;
      used.add(better);
    }
  }
  // One amount column, or a credit/debit pair, not both.
  if (mapping.amount !== undefined && mapping.credit !== undefined && mapping.debit !== undefined) delete mapping.amount;
  if (mapping.amount !== undefined && (mapping.credit === undefined) !== (mapping.debit === undefined)) {
    delete mapping.credit;
    delete mapping.debit;
  }
  if (mapping.tax !== undefined && mapping.fee === undefined) delete mapping.tax;
  return mapping;
}

// ---------------------------------------------------------------- rows

// Rows that are not real money movements.
// Matched against the normalized status (so "بإنتظار" and "ملغاة" are caught too).
const SKIP_STATUS = /fail|declin|void|cancel|abandon|refund|return|draft|reject|authori[sz]|expire|pending|initiated|ملغ|مسترجع|مرتجع|مسترد|فاشل|مرفوض|مسود|انتظار|معلق|غير مكتمل/i;
const BALANCE_ROW = /رصيد افتتاحي|رصيد مرحل|رصيد سابق|رصيد ختامي|رصيد اقفال|رصيد إقفال|opening balance|closing balance|brought forward|carried forward|balance b\/?f|\bb\/f\b|\bc\/f\b/i;
const TOTAL_ROW = /^(total|totals|grand total|sum|subtotal|الإجمالي|الاجمالي|إجمالي|اجمالي|المجموع|مجموع|الإجماليات)$/i;

const cellText = (value: Cell) => (value instanceof Date ? parseDate(value) || "" : value === null || value === undefined ? "" : String(value).trim());

export function toRows(table: Table, mapping: Mapping) {
  const rows: ParsedRow[] = [];
  let invalid = 0;
  const skipped = { status: 0, summary: 0 };
  const at = (row: Cell[], field: Field) => (mapping[field] === undefined ? null : (row[mapping[field]!] ?? null));
  const order = mapping.date === undefined ? "dmy" : dateOrder(table.rows.map((r) => r[mapping.date!]));
  for (const row of table.rows) {
    const texts = row.map((c) => (typeof c === "string" ? c.trim() : ""));
    if (texts.some((t) => BALANCE_ROW.test(t)) || texts.some((t) => TOTAL_ROW.test(t))) {
      skipped.summary++;
      continue;
    }
    const status = cellText(at(row, "status"));
    if (status && SKIP_STATUS.test(normHeader(status))) {
      skipped.status++;
      continue;
    }
    const date = parseDate(at(row, "date"), order);
    let amount = parseAmount(at(row, "amount"));
    if (mapping.amount === undefined && (mapping.credit !== undefined || mapping.debit !== undefined)) {
      const credit = parseAmount(at(row, "credit")) ?? 0;
      const debit = parseAmount(at(row, "debit")) ?? 0;
      amount = credit || debit ? Math.abs(credit) - Math.abs(debit) : null;
    }
    if (amount !== null && mapping.direction !== undefined) {
      const side = toLatin(cellText(at(row, "direction")));
      if (DEBIT_WORD.test(side)) amount = -Math.abs(amount);
      else if (CREDIT_WORD.test(side)) amount = Math.abs(amount);
    }
    if (!date || amount === null) {
      invalid++;
      continue;
    }
    const fee = parseAmount(at(row, "fee"));
    const tax = parseAmount(at(row, "tax"));
    const expected = parseAmount(at(row, "expected"));
    rows.push({
      date,
      amount,
      reference: cellText(at(row, "reference")).replace(/^#/, "") || undefined,
      description: cellText(at(row, "description")) || undefined,
      fee: fee === null ? undefined : Math.round((Math.abs(fee) + Math.abs(tax ?? 0)) * 100) / 100,
      branch: cellText(at(row, "branch")) || undefined,
      method: cellText(at(row, "method")) || undefined,
      expected: expected ?? undefined,
    });
  }
  return { rows, invalid, skipped };
}

// Which known system a file was exported from, by its name and tell-tale columns.
const systemSigns: [string, RegExp, RegExp?][] = [
  ["moyasar", /moyasar|ميسر/i, /metadata\[|source type/i],
  ["tap", /(^|[^a-z])tap([^a-z]|$)|تاب/i, /charge id/i],
  ["wafeq", /wafeq|وافق/i],
  ["qoyod", /qoyod|قيود/i],
  ["salla", /salla|سلة|سله/i],
  ["zid", /(^|[^a-z])zid([^a-z]|$)|زد/i],
  ["foodics", /foodics|فودكس/i, /business date/i],
];
export function guessSystem(fileName: string, headers: string[]) {
  const joined = headers.join(" | ");
  return systemSigns.find(([, name, cols]) => name.test(fileName) || (cols ? cols.test(joined) : false))?.[0] ?? "";
}
