// Reconciliation engine. Pure functions, amounts in halalas, dates as YYYY-MM-DD.
//
// Money moves through up to three layers of sources:
//   sales (what was sold) -> payments (gateway/platform reports) -> bank (what arrived).
// Each pair of adjacent layers that has data is matched, in this order:
//   1. same reference on both sides
//   2. one-to-one by amount within the settlement window
//   3. a deposit equal to the total of one to three consecutive days (batch payouts)
//   4. a deposit up to 10% below a single amount or a day total (short payment)
// What is left becomes either pending (still inside its window), missing (overdue),
// or an unknown incoming amount.

export type SourceKind = "sales" | "payments" | "bank";

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
};

export type SourceConfig = { name: string; kind: SourceKind; feeBps: number; feeFixed: number; lagDays: number };

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
    fees: number;
    received: number;
    pending: number;
    matchedSales: number;
  };
  hint: string | null;
};

type Item = { ids: string[]; date: string; amount: number; ref: string | null; source: string; lag: number };

const DAY = 86_400_000;
const SHORT_LIMIT = 0.1; // a deposit up to 10% below the expected total is treated as a short payment
const BATCH_DAYS = 3;

export const dayNumber = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY);
const normRef = (ref: string | null) => (ref ? ref.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "") || null : null);

// Arabic counted nouns: 3-10 take the plural, everything else the singular ("5 أيام", "21 يومًا").
export const counted = (n: number, few: string, other: string) => `${n.toLocaleString("en-US")} ${n >= 3 && n <= 10 ? few : other}`;
const daysText = (n: number) => (n === 1 ? "يوم واحد" : n === 2 ? "يومان" : counted(n, "أيام", "يومًا"));

export const formatSar = (halalas: number) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: halalas % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(halalas / 100) + " ر.س";

function hash(text: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
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

const issueId = (type: IssueType, ids: string[]) => `${type}:${hash([...ids].sort().join(","))}`;

export function agreedFee(amount: number, config: SourceConfig | undefined) {
  if (!config || amount <= 0) return 0;
  return Math.round((amount * config.feeBps) / 10_000) + config.feeFixed;
}

function matchLayer(layer: Layer, expected: Item[], received: Item[], tolerance: number) {
  const matches: Match[] = [];
  const issues: Issue[] = [];
  const usedE = new Set<Item>();
  const usedR = new Set<Item>();
  const take = (via: Match["via"], es: Item[], r: Item) => {
    es.forEach((e) => usedE.add(e));
    usedR.add(r);
    const total = es.reduce((sum, e) => sum + e.amount, 0);
    const date = es.map((e) => e.date).sort()[0];
    matches.push({ layer, via, expectedIds: es.flatMap((e) => e.ids), receivedIds: r.ids, expected: total, received: r.amount, date, receivedDate: r.date });
    if (total - r.amount > tolerance) {
      const ids = es.flatMap((e) => e.ids);
      issues.push({
        id: issueId("short", [...ids, ...r.ids]),
        type: "short",
        severity: "high",
        amount: total - r.amount,
        date: r.date,
        source: es[0].source,
        title: "وصل مبلغ أقل من المتوقع",
        detail: `توقعنا ${formatSar(total)} مقابل ${ids.length > 1 ? counted(ids.length, "عمليات", "عملية") : "العملية"} من ${es[0].source}، ووصل ${formatSar(r.amount)} في ${r.source} بتاريخ ${r.date}. الفرق ${formatSar(total - r.amount)}.`,
        txnIds: ids,
        relatedIds: r.ids,
      });
    }
  };
  const inWindow = (e: Item, r: Item, days = e.lag) => {
    const gap = dayNumber(r.date) - dayNumber(e.date);
    return gap >= -1 && gap <= days;
  };
  const receivedByDate = [...received].sort((a, b) => a.date.localeCompare(b.date));

  // 1. Same reference.
  const byRef = new Map<string, Item[]>();
  for (const r of received) {
    const ref = normRef(r.ref);
    if (ref) byRef.set(ref, [...(byRef.get(ref) || []), r]);
  }
  for (const e of expected) {
    const ref = normRef(e.ref);
    if (!ref) continue;
    const candidates = (byRef.get(ref) || []).filter((r) => !usedR.has(r));
    if (!candidates.length) continue;
    candidates.sort((a, b) => Math.abs(a.amount - e.amount) - Math.abs(b.amount - e.amount));
    take("reference", [e], candidates[0]);
  }

  // 2. One-to-one by amount, closest date first.
  const open = () => expected.filter((e) => !usedE.has(e) && e.amount > 0);
  const byAmount = open().sort((x, y) => x.amount - y.amount);
  for (const r of receivedByDate) {
    if (usedR.has(r)) continue;
    let best: Item | null = null;
    for (let i = lowerBound(byAmount, r.amount - tolerance); i < byAmount.length && byAmount[i].amount <= r.amount + tolerance; i++) {
      const e = byAmount[i];
      if (usedE.has(e) || !inWindow(e, r)) continue;
      if (!best || Math.abs(dayNumber(r.date) - dayNumber(e.date)) < Math.abs(dayNumber(r.date) - dayNumber(best.date))) best = e;
    }
    if (best) take("amount", [best], r);
  }

  // 3 and 4. Day totals (batch payouts), then short payments.
  const dayGroups = () => {
    const groups = new Map<number, Item[]>();
    for (const e of expected) if (!usedE.has(e)) groups.set(dayNumber(e.date), [...(groups.get(dayNumber(e.date)) || []), e]);
    return groups;
  };
  const findGroup = (r: Item, accept: (total: number) => boolean) => {
    const groups = dayGroups();
    const rDay = dayNumber(r.date);
    for (let offset = 0; offset <= 31; offset++) {
      for (let span = 1; span <= BATCH_DAYS; span++) {
        const items: Item[] = [];
        for (let d = rDay - offset - span + 1; d <= rDay - offset; d++) items.push(...(groups.get(d) || []));
        if (!items.length || !items.every((e) => inWindow(e, r))) continue;
        const total = items.reduce((sum, e) => sum + e.amount, 0);
        if (accept(total)) return items;
      }
    }
    return null;
  };
  for (const r of receivedByDate) {
    if (usedR.has(r)) continue;
    const items = findGroup(r, (total) => Math.abs(total - r.amount) <= tolerance);
    if (items) take("batch", items, r);
  }
  const isShort = (total: number, amount: number) => total - amount > tolerance && total - amount <= total * SHORT_LIMIT;
  for (const r of receivedByDate) {
    if (usedR.has(r)) continue;
    const single = open()
      .filter((e) => inWindow(e, r) && isShort(e.amount, r.amount))
      .sort((a, b) => a.amount - r.amount - (b.amount - r.amount))[0];
    if (single) {
      take("partial", [single], r);
      continue;
    }
    const items = findGroup(r, (total) => isShort(total, r.amount));
    if (items) take("partial", items, r);
  }

  // Leftovers: overdue expected money is missing, the rest is pending.
  const asOf = received.length ? Math.max(...received.map((r) => dayNumber(r.date))) : null;
  const pending: Item[] = [];
  const overdue = new Map<string, Item[]>();
  for (const e of expected) {
    if (usedE.has(e) || e.amount <= 0) continue;
    if (asOf === null || asOf - dayNumber(e.date) <= e.lag) pending.push(e);
    else overdue.set(`${e.source}|${e.date}`, [...(overdue.get(`${e.source}|${e.date}`) || []), e]);
  }
  for (const items of overdue.values()) {
    const ids = items.flatMap((e) => e.ids);
    const total = items.reduce((sum, e) => sum + e.amount, 0);
    const days = (asOf as number) - dayNumber(items[0].date);
    const where = layer === "sales-payments" ? "في تقرير الدفع" : "في البنك";
    issues.push({
      id: issueId("missing", ids),
      type: "missing",
      severity: "high",
      amount: total,
      date: items[0].date,
      source: items[0].source,
      title: `لم يصل مقابل ${ids.length === 1 ? "عملية" : ids.length === 2 ? "عمليتين" : counted(ids.length, "عمليات", "عملية")} من ${items[0].source}`,
      detail: `${formatSar(total)} بتاريخ ${items[0].date} لم نجد ما يقابلها ${where}، ومضى ${daysText(days)} والمدة المعتادة ${daysText(items[0].lag)}.`,
      txnIds: ids,
      relatedIds: [],
    });
  }
  for (const r of received) {
    if (usedR.has(r)) continue;
    issues.push({
      id: issueId("unknown", r.ids),
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
  return { matches, issues, pending };
}

export function reconcile(txns: Txn[], sourceConfigs: SourceConfig[], tolerance: number): Reconciliation {
  const configs = new Map(sourceConfigs.map((c) => [c.name, c]));
  const kindOf = (t: Txn) => configs.get(t.source)?.kind || "sales";
  const sales = txns.filter((t) => kindOf(t) === "sales");
  const payments = txns.filter((t) => kindOf(t) === "payments");
  const bank = txns.filter((t) => kindOf(t) === "bank");
  const lag = (source: string) => configs.get(source)?.lagDays ?? 3;
  const item = (t: Txn, amount: number, lagDays = lag(t.source)): Item => ({ ids: [t.id], date: t.date, amount, ref: t.reference, source: t.source, lag: lagDays });
  const paymentFee = (t: Txn) => t.fee ?? agreedFee(t.amount, configs.get(t.source));
  const issues: Issue[] = [];
  const matches: Match[] = [];
  const pendingIds: string[] = [];
  const layers: Layer[] = [];
  let fees = 0;

  const run = (layer: Layer, expected: Item[], received: Item[]) => {
    layers.push(layer);
    const result = matchLayer(layer, expected, received, tolerance);
    matches.push(...result.matches);
    issues.push(...result.issues);
    pendingIds.push(...result.pending.flatMap((p) => p.ids));
  };

  const bankIn = bank.filter((t) => t.amount > 0).map((t) => item(t, t.amount));
  if (sales.length && payments.length) {
    // Gateways report each sale at its gross amount, usually the same or next day.
    run("sales-payments", sales.map((t) => item(t, t.amount, Math.min(lag(t.source), 2))), payments.filter((t) => t.amount > 0).map((t) => item(t, t.amount)));
  } else if (sales.length && bank.length) {
    run("sales-bank", sales.map((t) => {
      const fee = t.fee ?? agreedFee(t.amount, configs.get(t.source));
      fees += fee;
      return item(t, t.amount - fee);
    }), bankIn);
  }
  if (payments.length && bank.length) {
    run("payments-bank", payments.filter((t) => t.amount > 0).map((t) => item(t, t.amount - paymentFee(t))), bankIn);
  }
  for (const t of payments) {
    if (t.amount <= 0) continue;
    fees += paymentFee(t);
    const config = configs.get(t.source);
    if (t.fee === null || !config || (!config.feeBps && !config.feeFixed)) continue;
    const agreed = agreedFee(t.amount, config);
    if (t.fee - agreed > tolerance) {
      issues.push({
        id: issueId("fee", [t.id]),
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

  // Same reference twice in one source with the same amount.
  const seen = new Map<string, Txn[]>();
  for (const t of txns) {
    const ref = normRef(t.reference);
    if (ref) seen.set(`${t.source}|${ref}|${t.amount}`, [...(seen.get(`${t.source}|${ref}|${t.amount}`) || []), t]);
  }
  for (const group of seen.values()) {
    if (group.length < 2) continue;
    const ids = group.map((t) => t.id);
    issues.push({
      id: issueId("duplicate", ids),
      type: "duplicate",
      severity: "medium",
      amount: group.slice(1).reduce((sum, t) => sum + Math.abs(t.amount), 0),
      date: group[0].date,
      source: group[0].source,
      title: "عملية مكررة",
      detail: `المرجع ${group[0].reference} ظهر ${group.length === 2 ? "مرتين" : counted(group.length, "مرات", "مرة")} في ${group[0].source} بنفس المبلغ ${formatSar(group[0].amount)}.`,
      txnIds: ids,
      relatedIds: [],
    });
  }

  // Files that carry their own "expected" column.
  for (const t of txns) {
    if (t.expected === null || Math.abs(t.amount - t.expected) <= tolerance) continue;
    const diff = t.expected - t.amount;
    issues.push({
      id: issueId("expected", [t.id]),
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

  const firstLayer = matches.filter((m) => m.layer === "sales-payments" || m.layer === "sales-bank");
  const matchedSales = new Set(firstLayer.flatMap((m) => m.expectedIds)).size;
  const received = bank.length ? bank.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0) : payments.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount - paymentFee(t), 0);
  const pendingSet = new Set(pendingIds);
  const pendingTotal = txns.filter((t) => pendingSet.has(t.id)).reduce((s, t) => s + t.amount, 0);
  const hint = !txns.length
    ? "ارفع أول ملف لتبدأ القراءة."
    : !layers.length
      ? sales.length
        ? "أضف كشف البنك أو تقرير بوابة الدفع لنطابق مبيعاتك مع ما وصلك فعلًا."
        : "أضف ملف المبيعات أو الفواتير لنعرف ما الذي كان يجب أن يصلك."
      : null;

  issues.sort((a, b) => ({ high: 0, medium: 1, low: 2 })[a.severity] - ({ high: 0, medium: 1, low: 2 })[b.severity] || b.amount - a.amount);
  return {
    layers,
    matches,
    issues,
    pendingIds,
    totals: {
      sales: sales.reduce((s, t) => s + t.amount, 0),
      salesCount: sales.length,
      fees,
      received,
      pending: pendingTotal,
      matchedSales,
    },
    hint,
  };
}

