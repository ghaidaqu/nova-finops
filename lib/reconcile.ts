// Reconciliation engine. Pure functions, amounts in halalas, dates as YYYY-MM-DD.
//
// Money moves through up to three layers of sources:
//   sales (what was sold) -> payments (gateway/platform reports) -> bank (what arrived).
// Each sales source settles either through the payment sources or straight to the bank
// (cash sales do neither). Every layer is matched in this order:
//   1. same reference, close in date and amount (several receipts may share one reference)
//   2. exact amounts one to one, then amounts within the tolerance
//   3. a deposit equal to the total of consecutive days from one source (batch payouts)
//   4. a deposit slightly below a single amount or a day total (possible short payment)
// For bank deposits, step 3 runs before step 2 so a stray transfer can't take one payment
// out of a daily payout. What is left becomes pending (still inside its window), missing
// (overdue) or an unknown incoming amount. Settlement windows skip the Saudi weekend.

export type SourceKind = "sales" | "payments" | "bank";
export type SettlesVia = "auto" | "payments" | "bank";

export type Txn = {
  id: string;
  source: string;
  reference: string | null;
  date: string;
  description: string;
  amount: number;
  expected: number | null;
  fee: number | null;
  branch: string | null;
  method?: string | null;
};

export type SourceConfig = { name: string; kind: SourceKind; feeBps: number; feeFixed: number; lagDays: number; settlesVia?: SettlesVia };

export type IssueType = "missing" | "short" | "fee" | "unknown" | "duplicate" | "expected";

export type Issue = {
  id: string;
  type: IssueType;
  severity: "high" | "medium" | "low";
  amount: number;
  date: string;
  source: string;
  title: string;
  detail: string;
  txnIds: string[];
  relatedIds: string[];
};

export type Layer = "sales-payments" | "sales-bank" | "payments-bank";

export type Match = {
  layer: Layer;
  via: "reference" | "amount" | "batch" | "partial";
  expectedIds: string[];
  receivedIds: string[];
  expected: number;
  received: number;
  date: string;
  receivedDate: string;
};

export type Reconciliation = {
  layers: Layer[];
  matches: Match[];
  issues: Issue[];
  pendingIds: string[];
  totals: {
    sales: number;
    salesCount: number;
    cash: number;
    fees: number;
    received: number;
    pending: number;
    matchedSales: number;
  };
  hint: string | null;
};

type Item = { ids: string[]; date: string; day: number; amount: number; ref: string | null; source: string; lag: number; layer: Layer };

const DAY = 86_400_000;
const SHORT_SINGLE = 0.03; // one receipt up to 3% below one expected amount
const SHORT_GROUP = 0.1; // one deposit up to 10% below a day total
const MAX_SPAN = 8; // longest run of days one payout may cover
const REF_WINDOW = 45; // days a reference may sit from its counterpart

export const dayNumber = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY);
const normRef = (ref: string | null) =>
  ref ? ref.replace(/[٠-٩۰-۹]/g, (d) => String((d.charCodeAt(0) & 0xf) % 10)).toLowerCase().replace(/[^\p{L}\p{N}]/gu, "") || null : null;
const CASH = /\b(cash|cod)\b|نقد|نقدي|نقداً|كاش|الدفع عند الاستلام/i;
export const isCash = (method: string | null | undefined) => Boolean(method && CASH.test(method));

// Day 0 (1970-01-01) was a Thursday; Friday and Saturday are the Saudi weekend.
const isWeekend = (day: number) => {
  const weekday = (day + 4) % 7;
  return weekday === 5 || weekday === 6;
};
// Working days from `from` (exclusive) to `to` (inclusive).
function workingGap(from: number, to: number) {
  let gap = to - from;
  for (let d = from + 1; d <= to; d++) if (isWeekend(d)) gap--;
  return gap;
}
const inWindow = (e: Item, rDay: number) => rDay - e.day >= -1 && workingGap(e.day, rDay) <= e.lag;

// Arabic counted nouns: 3-10 take the plural, everything else the singular ("5 أيام", "21 يومًا").
export const counted = (n: number, few: string, other: string) => `${n.toLocaleString("en-US")} ${n >= 3 && n <= 10 ? few : other}`;
const daysText = (n: number) => (n === 1 ? "يوم واحد" : n === 2 ? "يومان" : counted(n, "أيام", "يومًا"));
const workDaysText = (n: number) => (n === 1 ? "يوم عمل" : n === 2 ? "يومي عمل" : counted(n, "أيام عمل", "يوم عمل"));
const opsText = (n: number) => (n === 1 ? "عملية" : n === 2 ? "عمليتين" : counted(n, "عمليات", "عملية"));

export const formatSar = (halalas: number) =>
  // `+ 0` turns -0 into 0 so empty totals never read "-0".
  new Intl.NumberFormat("en-US", { minimumFractionDigits: halalas % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(halalas / 100 + 0) + " ر.س";

// 53-bit string hash (cyrb53): ids stay short and practically collision-free.
function hash(text: string) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// Ids are keyed on what the issue is about (a deposit, a source and day...), not on every
// row involved, so a resolved issue stays resolved when more data is imported later.
const issueId = (type: IssueType, key: string) => `${type}:${hash(key)}`;

export function agreedFee(amount: number, config: SourceConfig | undefined) {
  if (!config || amount <= 0) return 0;
  return Math.round((amount * config.feeBps) / 10_000) + config.feeFixed;
}

function lowerBound(items: Item[], amount: number) {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid].amount < amount) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const sum = (items: Item[]) => items.reduce((total, item) => total + item.amount, 0);

function matchLayer(expected: Item[], received: Item[], tolerance: number, toBank: boolean) {
  const matches: Match[] = [];
  const issues: Issue[] = [];
  const usedE = new Set<Item>();
  const usedR = new Set<Item>();
  const take = (via: Match["via"], es: Item[], rs: Item[]) => {
    es.forEach((e) => usedE.add(e));
    rs.forEach((r) => usedR.add(r));
    const total = sum(es);
    const got = sum(rs);
    const ids = es.flatMap((e) => e.ids);
    const rIds = rs.flatMap((r) => r.ids);
    const first = es.reduce((a, b) => (a.day <= b.day ? a : b));
    matches.push({ layer: es[0].layer, via, expectedIds: ids, receivedIds: rIds, expected: total, received: got, date: first.date, receivedDate: rs[0].date });
    if (total - got > Math.max(tolerance, es.length > 1 ? es.length : 0)) {
      const sure = via === "reference";
      issues.push({
        id: issueId("short", rIds.join(",")),
        type: "short",
        severity: sure ? "high" : "medium",
        amount: total - got,
        date: rs[0].date,
        source: es[0].source,
        title: sure ? "وصل مبلغ أقل من المتوقع" : "يبدو أن مبلغًا وصل ناقصًا",
        detail: `توقعنا ${formatSar(total)} مقابل ${ids.length > 1 ? opsText(ids.length) : "العملية"} من ${es[0].source}، ووصل ${formatSar(got)} في ${rs[0].source} بتاريخ ${rs[0].date}. الفرق ${formatSar(total - got)}.${sure ? "" : " طابقنا بالمبلغ والتاريخ، فراجع التفاصيل للتأكد."}`,
        txnIds: ids,
        relatedIds: rIds,
      });
    }
  };
  const byDate = [...received].sort((a, b) => a.day - b.day || a.amount - b.amount || a.ids[0].localeCompare(b.ids[0]));
  const positives = expected.filter((e) => e.amount > 0).sort((a, b) => a.amount - b.amount || a.day - b.day || a.ids[0].localeCompare(b.ids[0]));

  // 1. Same reference. A sale paid in parts may have several receipts with its reference.
  const byRef = new Map<string, Item[]>();
  for (const r of byDate) {
    const ref = normRef(r.ref);
    if (ref) byRef.set(ref, [...(byRef.get(ref) || []), r]);
  }
  for (const e of positives) {
    const ref = normRef(e.ref);
    if (!ref || usedE.has(e)) continue;
    const near = (byRef.get(ref) || []).filter((r) => !usedR.has(r) && Math.abs(r.day - e.day) <= REF_WINDOW);
    if (!near.length) continue;
    if (near.length > 1 && Math.abs(sum(near) - e.amount) <= tolerance) {
      take("reference", [e], near);
      continue;
    }
    const best = near.sort((a, b) => Math.abs(a.amount - e.amount) - Math.abs(b.amount - e.amount))[0];
    // A shared short reference (e.g. "1001") on a very different amount is a different payment.
    if (best.amount >= e.amount / 2 && best.amount <= e.amount * 2) take("reference", [e], [best]);
  }

  // 2. One to one: exact amounts first so near-equal prices don't chain, then the tolerance.
  const oneToOne = (limit: number) => {
    for (const r of byDate) {
      if (usedR.has(r)) continue;
      let best: Item | null = null;
      let bestScore = Infinity;
      for (let i = lowerBound(positives, r.amount - limit); i < positives.length && positives[i].amount <= r.amount + limit; i++) {
        const e = positives[i];
        if (usedE.has(e) || !inWindow(e, r.day)) continue;
        const score = Math.abs(e.amount - r.amount) * 1000 + Math.abs(r.day - e.day);
        if (score < bestScore) {
          best = e;
          bestScore = score;
        }
      }
      if (best) take("amount", [best], [r]);
    }
  };

  // 3. Day totals per source (and across sources as a fallback). Groups shrink as they are used.
  const groups = new Map<string, Map<number, Item[]>>();
  for (const e of expected) {
    if (e.amount === 0) continue;
    const bySource = groups.get(e.source) || new Map<number, Item[]>();
    const list = bySource.get(e.day);
    if (list) list.push(e);
    else bySource.set(e.day, [e]);
    groups.set(e.source, bySource);
  }
  const dayItems = (source: string | null, day: number): Item[] => {
    if (source) return (groups.get(source)?.get(day) || []).filter((e) => !usedE.has(e));
    return [...groups.keys()].flatMap((s) => dayItems(s, day));
  };
  const maxLag = Math.max(0, ...expected.map((e) => e.lag));
  // Each candidate window: the items of `span` consecutive days ending `offset` days before the deposit.
  const windows = function* (r: Item) {
    for (const source of [...[...groups.keys()].sort(), null]) {
      for (let offset = 0; offset <= maxLag + 3; offset++) {
        const items: Item[] = [];
        for (let span = 1; span <= MAX_SPAN; span++) {
          const day = r.day - offset - span + 1;
          const add = dayItems(source, day);
          if (!add.length) {
            if (span === 1) break;
            continue;
          }
          items.push(...add);
          if (!add.every((e) => inWindow(e, r.day))) break;
          yield items;
        }
      }
    }
  };
  // Fees are rounded per row, so a payout of several rows may be off by a halala per row.
  const slack = (items: Item[]) => (items.length > 1 ? items.length : 0);
  const batch = (limit: number) => {
    for (const r of byDate) {
      if (usedR.has(r)) continue;
      for (const items of windows(r)) {
        if (Math.abs(sum(items) - r.amount) <= Math.max(limit, slack(items))) {
          take("batch", [...items], [r]);
          break;
        }
      }
    }
  };

  // Exact before approximate everywhere, so a near-equal amount never takes another's match.
  if (toBank) {
    batch(0);
    oneToOne(0);
    batch(tolerance);
    oneToOne(tolerance);
  } else {
    oneToOne(0);
    oneToOne(tolerance);
    batch(0);
    batch(tolerance);
  }

  // 4. Possible short payments: only when exactly one candidate fits.
  for (const r of byDate) {
    if (usedR.has(r)) continue;
    const singles: Item[] = [];
    for (let i = lowerBound(positives, r.amount + tolerance + 1); i < positives.length && positives[i].amount * (1 - SHORT_SINGLE) <= r.amount; i++) {
      if (!usedE.has(positives[i]) && inWindow(positives[i], r.day)) singles.push(positives[i]);
    }
    if (singles.length === 1) {
      take("partial", singles, [r]);
      continue;
    }
    if (singles.length > 1) continue;
    // The same rows can come from a per-source window and the all-sources one; count them once.
    const fits = new Map<string, Item[]>();
    for (const items of windows(r)) {
      const total = sum(items);
      if (total - r.amount > Math.max(tolerance, slack(items)) && total - r.amount <= total * SHORT_GROUP) fits.set(items.flatMap((e) => e.ids).sort().join(","), [...items]);
      if (fits.size > 1) break;
    }
    if (fits.size === 1) take("partial", [...fits.values()][0], [r]);
  }

  return { matches, issues, usedE, usedR };
}

export function reconcile(txns: Txn[], sourceConfigs: SourceConfig[], tolerance: number): Reconciliation {
  const configs = new Map(sourceConfigs.map((c) => [c.name, c]));
  // Stable order regardless of how the database returned the rows.
  const all = txns
    .filter((t) => Number.isFinite(dayNumber(t.date)))
    .sort((a, b) => a.date.localeCompare(b.date) || a.amount - b.amount || a.id.localeCompare(b.id));
  const kindOf = (t: Txn) => configs.get(t.source)?.kind || "sales";
  const sales = all.filter((t) => kindOf(t) === "sales");
  const payments = all.filter((t) => kindOf(t) === "payments");
  const bank = all.filter((t) => kindOf(t) === "bank");
  const lag = (source: string) => configs.get(source)?.lagDays ?? 3;
  const item = (t: Txn, amount: number, layer: Layer, lagDays = lag(t.source)): Item => ({ ids: [t.id], date: t.date, day: dayNumber(t.date), amount, ref: t.reference, source: t.source, lag: lagDays, layer });
  const paymentFee = (t: Txn) => (t.amount > 0 ? (t.fee ?? agreedFee(t.amount, configs.get(t.source))) : 0);
  // A sales source with its own commission (delivery apps, marketplaces) usually pays the bank directly.
  const viaPayments = (source: string) => {
    const c = configs.get(source);
    const via = c?.settlesVia || "auto";
    if (via !== "auto") return via === "payments";
    return payments.length > 0 && !(c && (c.feeBps || c.feeFixed));
  };

  const issues: Issue[] = [];
  const matches: Match[] = [];
  const pending: Item[] = [];
  const layers = new Set<Layer>();
  let fees = 0;

  const run = (expected: Item[], received: Item[], toBank: boolean) => {
    if (!expected.length || !received.length) {
      // Nothing to compare against yet: everything waits.
      if (expected.length) pending.push(...expected.filter((e) => e.amount > 0));
      return;
    }
    expected.forEach((e) => layers.add(e.layer));
    const result = matchLayer(expected, received, tolerance, toBank);
    matches.push(...result.matches);
    issues.push(...result.issues);
    // Overdue relative to the oldest "latest date" among the receiving sources, so a statement
    // exported earlier than another doesn't make the other one's money look missing.
    const latest = new Map<string, number>();
    for (const r of received) latest.set(r.source, Math.max(latest.get(r.source) ?? r.day, r.day));
    const asOf = Math.min(...latest.values());
    const overdue = new Map<string, Item[]>();
    for (const e of expected) {
      if (result.usedE.has(e) || e.amount <= 0) continue;
      if (workingGap(e.day, asOf) <= e.lag) pending.push(e);
      else {
        const key = `${e.layer}|${e.source}|${e.date}`;
        overdue.set(key, [...(overdue.get(key) || []), e]);
      }
    }
    for (const [key, items] of overdue) {
      const ids = items.flatMap((e) => e.ids);
      const total = sum(items);
      issues.push({
        id: issueId("missing", key),
        type: "missing",
        severity: "high",
        amount: total,
        date: items[0].date,
        source: items[0].source,
        title: `لم يصل مقابل ${opsText(ids.length)} من ${items[0].source}`,
        detail: `${formatSar(total)} بتاريخ ${items[0].date} لم نجد ما يقابلها ${items[0].layer === "sales-payments" ? "في تقرير الدفع" : "في البنك"}، ومضى ${daysText(asOf - items[0].day)} والمعتاد أن يصل خلال ${workDaysText(items[0].lag)}.`,
        txnIds: ids,
        relatedIds: [],
      });
    }
    for (const r of received) {
      if (result.usedR.has(r)) continue;
      issues.push({
        id: issueId("unknown", r.ids.join(",")),
        type: "unknown",
        severity: "low",
        amount: r.amount,
        date: r.date,
        source: r.source,
        title: "مبلغ وارد لا نعرف مصدره",
        detail: `${formatSar(r.amount)} في ${r.source} بتاريخ ${r.date} لا يقابله بيع أو تسوية مسجلة.`,
        txnIds: r.ids,
        relatedIds: [],
      });
    }
  };

  const nonCash = sales.filter((t) => !isCash(t.method));
  // Gateways report each sale at its gross amount, usually the same or next working day.
  run(
    nonCash.filter((t) => viaPayments(t.source)).map((t) => item(t, t.amount, "sales-payments", Math.min(lag(t.source), 2))),
    payments.filter((t) => t.amount > 0).map((t) => item(t, t.amount, "sales-payments")),
    false,
  );
  const toBank: Item[] = [];
  if (bank.length) {
    for (const t of nonCash) {
      if (viaPayments(t.source)) continue;
      const fee = t.amount > 0 ? (t.fee ?? agreedFee(t.amount, configs.get(t.source))) : 0;
      fees += fee;
      toBank.push(item(t, t.amount - fee, "sales-bank"));
    }
    // Gateway refunds stay in, so they net against the day's payout.
    for (const t of payments) if (t.amount) toBank.push(item(t, t.amount - paymentFee(t), "payments-bank"));
    run(toBank, bank.filter((t) => t.amount > 0).map((t) => item(t, t.amount, "payments-bank")), true);
  }
  for (const t of payments) {
    if (t.amount <= 0) continue;
    fees += paymentFee(t);
    const config = configs.get(t.source);
    if (t.fee === null || !config || (!config.feeBps && !config.feeFixed)) continue;
    const agreed = agreedFee(t.amount, config);
    if (t.fee - agreed > tolerance) {
      issues.push({
        id: issueId("fee", t.id),
        type: "fee",
        severity: "medium",
        amount: t.fee - agreed,
        date: t.date,
        source: t.source,
        title: "رسوم أعلى من المتفق عليه",
        detail: `${t.source} خصم ${formatSar(t.fee)} على عملية بقيمة ${formatSar(t.amount)}، والمتفق عليه ${formatSar(agreed)}.`,
        txnIds: [t.id],
        relatedIds: [],
      });
    }
  }

  // Same reference and amount twice in one source within a day, unless they were the parts
  // of one split payment.
  const splitParts = new Set(matches.filter((m) => m.receivedIds.length > 1 && m.via === "reference").flatMap((m) => m.receivedIds));
  const seen = new Map<string, Txn[]>();
  for (const t of all) {
    const ref = normRef(t.reference);
    if (ref && t.amount > 0 && !splitParts.has(t.id)) seen.set(`${t.source}|${ref}|${t.amount}`, [...(seen.get(`${t.source}|${ref}|${t.amount}`) || []), t]);
  }
  for (const [key, group] of seen) {
    const close = group.filter((t, i) => group.some((o, j) => i !== j && Math.abs(dayNumber(o.date) - dayNumber(t.date)) <= 1));
    if (close.length < 2) continue;
    issues.push({
      id: issueId("duplicate", key),
      type: "duplicate",
      severity: "medium",
      amount: close.slice(1).reduce((s, t) => s + t.amount, 0),
      date: close[0].date,
      source: close[0].source,
      title: "عملية مكررة",
      detail: `المرجع ${close[0].reference} ظهر ${close.length === 2 ? "مرتين" : counted(close.length, "مرات", "مرة")} في ${close[0].source} بنفس المبلغ ${formatSar(close[0].amount)}.`,
      txnIds: close.map((t) => t.id),
      relatedIds: [],
    });
  }

  // Files that carry their own "expected" column.
  for (const t of all) {
    if (t.expected === null || Math.abs(t.amount - t.expected) <= tolerance) continue;
    const diff = t.expected - t.amount;
    issues.push({
      id: issueId("expected", t.id),
      type: "expected",
      severity: diff > 0 ? "high" : "low",
      amount: Math.abs(diff),
      date: t.date,
      source: t.source,
      title: diff > 0 ? "المبلغ أقل من المتوقع" : "المبلغ أعلى من المتوقع",
      detail: `${t.description || t.reference || "عملية"}: المتوقع ${formatSar(t.expected)} والمسجل ${formatSar(t.amount)}.`,
      txnIds: [t.id],
      relatedIds: [],
    });
  }

  const salesIds = new Set(sales.map((t) => t.id));
  const matchedSales = new Set(matches.flatMap((m) => m.expectedIds).filter((id) => salesIds.has(id))).size;
  const received = bank.length ? bank.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0) : payments.reduce((s, t) => s + t.amount - paymentFee(t), 0);
  const hint = !all.length
    ? "ارفع أول ملف لتبدأ القراءة."
    : !layers.size
      ? sales.length
        ? "أضف كشف البنك أو تقرير بوابة الدفع لنطابق مبيعاتك مع ما وصلك فعلًا."
        : "أضف ملف المبيعات أو الفواتير لنعرف ما الذي كان يجب أن يصلك."
      : null;

  const rank = { high: 0, medium: 1, low: 2 };
  issues.sort((a, b) => rank[a.severity] - rank[b.severity] || b.amount - a.amount || a.id.localeCompare(b.id));
  return {
    layers: [...layers],
    matches,
    issues,
    pendingIds: pending.flatMap((p) => p.ids),
    totals: {
      sales: sales.reduce((s, t) => s + t.amount, 0),
      salesCount: sales.length,
      cash: sales.filter((t) => isCash(t.method)).reduce((s, t) => s + t.amount, 0),
      fees,
      received,
      pending: pending.reduce((s, p) => s + p.amount, 0),
      matchedSales,
    },
    hint,
  };
}
