// Shared helpers for the reconciliation stress tests.
export { reconcile, dayNumber, agreedFee } from "../../lib/reconcile.ts";

export const txn = (id, source, date, amount, extra = {}) => ({ id, source, reference: null, date, description: "", amount, expected: null, fee: null, branch: null, ...extra });
export const cfg = (name, kind, feeBps = 0, feeFixed = 0, lagDays = 2) => ({ name, kind, feeBps, feeFixed, lagDays });

export const DAY = 86_400_000;
export const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

// Deterministic PRNG.
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(arr, rand) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const brief = (r) => ({
  layers: r.layers,
  matches: r.matches.map((m) => `${m.layer}/${m.via} [${m.expectedIds}]->[${m.receivedIds}] ${m.expected}/${m.received}`),
  issues: r.issues.map((i) => `${i.type}:${i.amount} [${i.txnIds}]${i.relatedIds.length ? " rel[" + i.relatedIds + "]" : ""}`),
  pending: r.pendingIds,
  totals: r.totals,
});

export const types = (r) => r.issues.map((i) => i.type).sort();
export const count = (r, type) => r.issues.filter((i) => i.type === type).length;

// Realistic shop: one POS sales source, one gateway (2.5% + 1 SAR), one bank; gateway pays the
// net daily total two days later. Returns txns + configs. Options control size and noise.
export function buildShop({ days = 60, start = "2026-07-01", perDay = 40, cashShare = 0, refs = true, seed = 1, priceList = null, missingRate = 0, withBank = true } = {}) {
  const rand = rng(seed);
  const configs = [cfg("POS", "sales", 0, 0, 2), cfg("GW", "payments", 250, 100, 2), cfg("BANK", "bank", 0, 0, 2)];
  const txns = [];
  const payout = new Map();
  let n = 0;
  for (let d = 0; d < days; d++) {
    const date = addDays(start, d);
    const count = Math.max(1, Math.round(perDay * (0.7 + rand() * 0.6)));
    for (let i = 0; i < count; i++) {
      const id = `s${n}`;
      const amount = priceList ? priceList[Math.floor(rand() * priceList.length)] : 1000 + Math.floor(rand() * 90000);
      const ref = refs ? `ORD-${n}` : null;
      n++;
      txns.push(txn(id, "POS", date, amount, { reference: ref }));
      if (rand() < cashShare) continue; // cash: never reaches the gateway
      if (rand() < missingRate) continue;
      const fee = Math.round((amount * 250) / 10000) + 100;
      txns.push(txn(`p${n - 1}`, "GW", date, amount, { reference: ref, fee }));
      payout.set(date, (payout.get(date) || 0) + amount - fee);
    }
  }
  if (withBank)
    for (const [date, net] of payout) {
      const bd = addDays(date, 2);
      txns.push(txn(`b-${date}`, "BANK", bd, net, { reference: refs ? `PAYOUT-${date}` : null }));
    }
  return { txns, configs };
}
