import type { SourceKind } from "./reconcile";

// Six weeks of a small business selling in a shop and online, paid through a gateway
// that settles to the bank. A few real-world problems are planted so every screen has
// something to show: sales the gateway never reported, a gateway fee above the contract,
// a short bank payout, a payout that never arrived, a duplicate charge, and a deposit
// with no matching sale.

export type DemoRow = { date: string; description: string; amount: number; reference?: string; fee?: number; branch?: string };
export type DemoSource = { name: string; kind: SourceKind; feeBps: number; feeFixedHalalas: number; lagDays: number; rows: DemoRow[] };

const DAY = 86_400_000;

function random(seed: number) {
  return () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed / 2_147_483_648;
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function demoSources(endDate: string, days = 42): DemoSource[] {
  const rand = random(20261104);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  const sales: DemoRow[] = [];
  const gateway: DemoRow[] = [];
  const bank: DemoRow[] = [];
  const payoutByDay = new Map<string, number>();
  let order = 4100;
  // The gateway settles to the bank two days later; the last two days are still in transit.
  for (let d = days; d >= 0; d--) {
    const date = iso(end - d * DAY);
    const count = 5 + Math.floor(rand() * 7);
    for (let i = 0; i < count; i++) {
      const branch = rand() < 0.55 ? "المتجر الإلكتروني" : "الفرع الرئيسي";
      const amount = round2(60 + rand() * 900);
      const reference = `ORD-${order++}`;
      sales.push({ date, description: branch === "المتجر الإلكتروني" ? "طلب من المتجر" : "بيع في الفرع", amount, reference, branch });
      // Two sales were paid but never appear in the gateway report.
      if (d === 30 && i === 0) continue;
      if (d === 17 && i === 1) continue;
      // The contract is 2.5% + 1 SAR; on two days the gateway charged 3.5%.
      const overcharged = (d === 24 || d === 9) && i === 0;
      const fee = round2(amount * (overcharged ? 0.035 : 0.025) + 1);
      gateway.push({ date, description: `دفعة ${reference}`, amount, reference, fee });
      payoutByDay.set(date, round2((payoutByDay.get(date) || 0) + amount - fee));
    }
    // A customer was charged twice for the same order.
    if (d === 12) {
      const last = gateway.at(-1)!;
      gateway.push({ ...last });
      payoutByDay.set(date, round2((payoutByDay.get(date) || 0) + last.amount - (last.fee || 0)));
    }
  }
  for (const [date, net] of payoutByDay) {
    const d = Math.round((end - Date.parse(`${date}T00:00:00Z`)) / DAY);
    if (d < 2) continue;
    if (d === 21) continue; // payout never arrived
    const short = d === 14 ? 150 : 0;
    bank.push({ date: iso(Date.parse(`${date}T00:00:00Z`) + 2 * DAY), description: "تسوية بوابة الدفع", amount: round2(net - short), reference: `PAYOUT-${date.replaceAll("-", "")}` });
  }
  bank.push({ date: iso(end - 26 * DAY), description: "تحويل وارد", amount: 5000, reference: "TRF-88120" });
  for (let d = days; d >= 0; d -= 14) bank.push({ date: iso(end - d * DAY), description: "إيجار ومصاريف تشغيل", amount: -6500, reference: `EXP-${d}` });

  return [
    { name: "المبيعات (تجريبي)", kind: "sales", feeBps: 0, feeFixedHalalas: 0, lagDays: 2, rows: sales },
    { name: "بوابة الدفع (تجريبي)", kind: "payments", feeBps: 250, feeFixedHalalas: 100, lagDays: 2, rows: gateway },
    { name: "كشف البنك (تجريبي)", kind: "bank", feeBps: 0, feeFixedHalalas: 0, lagDays: 2, rows: bank },
  ];
}
