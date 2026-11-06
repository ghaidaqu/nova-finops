"use client";
import { Fragment, useCallback, useEffect, useState } from "react";
import { ArrowLeft, Bell, Check, CircleAlert, Clock, CreditCard, FileSpreadsheet, GitCompareArrows, Landmark, LogOut, Plus, ReceiptText, RefreshCw, Settings, ShieldCheck, Sparkles, Trash2, TrendingDown, X, Zap } from "lucide-react";
import type { SourceKind } from "@/lib/reconcile";
import type { IssueStatus, SourceSummary, WorkspaceData } from "@/lib/workspace-data";
import { callApi, counted, formatDay, formatSar, issueLabels, kindHelp, kindLabels, sectors, severityLabels, useNova } from "./data";
import { ImportModal } from "./import-modal";

export type Go = (route: "overview" | "reconciliation" | "alerts" | "connections" | "analytics" | "money" | "settings") => void;
type Issue = WorkspaceData["issues"][number];

function Head({ title, copy, action }: { title: string; copy: string; action?: React.ReactNode }) {
  return <div className="page-head"><div><h1>{title}</h1><p>{copy}</p></div>{action}</div>;
}

export function Loading() {
  const { error, refresh } = useNova();
  return <div className="page"><div className="loading">{error ? <><CircleAlert /><p>{error}</p><button className="secondary" onClick={refresh}>حاول مرة أخرى</button></> : <p>جارٍ تحميل بياناتك…</p>}</div></div>;
}

const kindIcon = (kind: SourceKind) => (kind === "bank" ? <Landmark /> : kind === "payments" ? <CreditCard /> : kind === "expenses" ? <TrendingDown /> : <ReceiptText />);

// Profit only means something once costs are known: sales minus fees minus imported expenses.
export function profitOf(t: WorkspaceData["totals"]) {
  if (!t.expenses || !t.sales) return null;
  const profit = t.sales - t.fees - t.expenses;
  return { profit, margin: (profit / t.sales) * 100 };
}
const pct = (n: number) => `${n.toFixed(1)}%`;

function StartHere({ openImport }: { openImport: () => void }) {
  const { call } = useNova();
  const [busy, setBusy] = useState(false);
  return (
    <section className="start-here">
      <h2>ابدأ بأي ملف لديك، أو جرّب بيانات تجريبية.</h2>
      <p>حلّل مبيعاتك ومصاريفك وتحصيلك من أول ملف. وكلما أضفت مصادر أكثر، اكتملت الصورة وأصبحت المطابقة أدق.</p>
      <div className="start-grid">
        <button onClick={openImport}><FileSpreadsheet /><b>استيراد ملف</b><small>CSV أو Excel من أي نظام</small></button>
        <button disabled={busy} onClick={async () => { setBusy(true); try { await call("POST", "/api/demo"); } finally { setBusy(false); } }}><Sparkles /><b>{busy ? "جارٍ التحميل…" : "بيانات تجريبية"}</b><small>نشاط تجاري لستة أسابيع فيه مشاكل حقيقية</small></button>
      </div>
      <ol className="kinds">{(Object.keys(kindLabels) as SourceKind[]).map((k) => <li key={k}>{kindIcon(k)}<span><b>{kindLabels[k]}</b><small>{kindHelp[k]}</small></span></li>)}</ol>
    </section>
  );
}

export function Overview({ go, openImport }: { go: Go; openImport: () => void }) {
  const { data, call } = useNova();
  if (!data) return <Loading />;
  const t = data.totals;
  const open = data.issues.filter((i) => i.status === "open");
  const top = open.find((i) => i.type !== "unknown") || open[0];
  return (
    <div className="page simple-dashboard">
      <Head title={`مرحبًا، ${data.user.name}`} copy={t.records ? `قراءة من ${counted(t.records, "عمليات", "عملية")} في ${counted(data.sources.length, "مصادر", "مصدر")}.` : "مساحة عملك جاهزة. أضف أول بياناتك."} />
      {!t.records ? <>
        <section className="empty-import">
          <div><b>ابدأ من بياناتك</b><p>أضف ملفًا واحدًا لتظهر لك مؤشرات الأداء والتحليلات هنا.</p></div>
          <button className="primary" onClick={openImport}><FileSpreadsheet /> أضف ملفًا <ArrowLeft /></button>
        </section>
        <div className="simple-kpis empty-kpis">
          <article><small>الإيرادات</small><b>0 ر.س</b><span>أضف ملف مبيعات أو فواتير</span></article>
          <article><small>المصاريف</small><b>0 ر.س</b><span>أضف ملف مصاريف أو تكاليف</span></article>
          <article><small>صافي الربح</small><b>0 ر.س</b><span>يظهر بعد إضافة الإيرادات والمصاريف</span></article>
          <article><small>هامش الربح</small><b>0%</b><span>من بيانات مشروعك الفعلية</span></article>
        </div>
        <section className="one-decision empty-decision"><header><span><Sparkles /><b>بانتظار أول بياناتك</b></span></header><div><h2>كل رقم يبدأ بملف واحد.</h2><p>يمكنك البدء بالمبيعات، المصاريف، كشف البنك أو تقرير بوابة الدفع — لست بحاجة إلى كل الملفات الآن.</p></div><footer><button className="secondary" onClick={async () => { await call("POST", "/api/demo"); }}>جرّب بيانات تجريبية <ArrowLeft /></button></footer></section>
      </> : (
        <>
          {data.truncated && <div className="smart"><CircleAlert /><span><b>بياناتك كبيرة</b><p>نطابق أحدث {counted(data.truncated.read, "عمليات", "عملية")} من أصل {counted(data.truncated.stored, "عمليات", "عملية")}. احذف المصادر القديمة إن لم تعد تحتاجها.</p></span></div>}
          <div className="simple-kpis">
            <article><small>المبيعات</small><b>{formatSar(t.sales)}</b><span>{counted(t.salesCount, "عمليات", "عملية")} · طابقنا {t.salesCount ? Math.round((t.matchedSales / t.salesCount) * 100) : 0}%</span></article>
            <article><small>وصل فعلًا</small><b>{formatSar(t.received)}</b><span>{t.pending > 0 ? `${formatSar(t.pending)} في الطريق` : "لا شيء معلّق"}</span></article>
            <article className="needs"><small>يحتاج قرارك</small><b>{open.length}</b><button onClick={() => go("alerts")}>{formatSar(t.openAmount)} <ArrowLeft /></button></article>
          </div>
          <section className="one-decision">
            <header><span><CircleAlert /><b>{top ? "أهم ما يحتاج انتباهك" : data.hint ? "خطوتك التالية" : "كل شيء مطابق"}</b></span><small>{top ? `${issueLabels[top.type]} · ${formatDay(top.date)}` : ""}</small></header>
            <div><h2>{top ? top.title : data.hint || "لم نجد فروقات مفتوحة."}</h2><p>{top ? top.detail : data.hint ? "كلما أضفت مصدرًا آخر صارت المطابقة أدق." : "سنخبرك هنا عند ظهور أي فرق جديد بعد الاستيراد القادم."}</p></div>
            <footer>{top ? <button className="primary" onClick={() => go("alerts")}>راجع التفاصيل <ArrowLeft /></button> : <button className="primary" onClick={openImport}>استيراد ملف <ArrowLeft /></button>}</footer>
          </section>
          <div className="simple-bottom">
            <section><header><b>المصادر</b><button onClick={() => go("connections")}>إدارة</button></header>
              {data.sources.map((s) => <p key={s.name}><span>{kindIcon(s.kind)} {s.name}</span><strong>{s.count.toLocaleString("en-US")}</strong></p>)}
              <small>آخر بيانات حتى {formatDay(data.sources.map((s) => s.to || "").sort().at(-1) || null)}</small>
            </section>
            <section><header><b>الملخص</b><button onClick={() => go("money")}>تدفق الأموال</button></header>
              <p><span>رسوم ومستقطعات</span><strong>{formatSar(t.fees)}</strong></p>
              {t.cash > 0 && <p><span>مبيعات نقدية (خارج المطابقة)</span><strong>{formatSar(t.cash)}</strong></p>}
              <p><span>في الطريق</span><strong>{formatSar(t.pending)}</strong></p>
              {profitOf(t) ? <p><span>هامش الربح</span><strong>{pct(profitOf(t)!.margin)}</strong></p> : <p><span>هامش الربح</span><button className="link" onClick={openImport}>أضف ملف المصاريف</button></p>}
              <p><span>فروقات مفتوحة</span><strong className="red">{formatSar(t.openAmount)}</strong></p>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function IssueDetail({ issue, onAction }: { issue: Issue; onAction: (status: IssueStatus) => void }) {
  const { data } = useNova();
  const txns = [...issue.txnIds, ...issue.relatedIds].map((id) => data?.txns[id]).filter(Boolean);
  return (
    <>
      <em className={`sev ${issue.severity}`}>{severityLabels[issue.severity]}</em>
      <GitCompareArrows />
      <small>{issueLabels[issue.type]}</small>
      <h2>{issue.title}</h2>
      <p>{issue.detail}</p>
      <div className="impact"><span><small>الأثر المالي</small><b>{formatSar(issue.amount)}</b></span><span><small>التاريخ</small><b>{formatDay(issue.date)}</b></span><span><small>المصدر</small><b>{issue.source}</b></span></div>
      {txns.length > 0 && (
        <div className="data-table"><table>
          <thead><tr><th>المصدر</th><th>التاريخ</th><th>المرجع</th><th>المبلغ</th><th>الرسوم</th></tr></thead>
          <tbody>{txns.slice(0, 12).map((t) => <tr key={t!.id}><td>{t!.source}</td><td>{formatDay(t!.date)}</td><td>{t!.reference || t!.description || "—"}</td><td>{formatSar(t!.amount)}</td><td>{t!.fee === null ? "—" : formatSar(t!.fee)}</td></tr>)}</tbody>
        </table>{issue.rowCount > Math.min(txns.length, 12) && <small>و{counted(issue.rowCount - Math.min(txns.length, 12), "عمليات أخرى", "عملية أخرى")}</small>}</div>
      )}
      <footer>
        {issue.status === "open" ? <><button className="primary" onClick={() => onAction("resolved")}><Check /> تمت المعالجة</button><button className="secondary" onClick={() => onAction("snoozed")}><Clock /> تأجيل</button></> : <button className="secondary" onClick={() => onAction("open")}>إعادة فتح</button>}
      </footer>
    </>
  );
}

export function Alerts() {
  const { data, call } = useNova();
  const [tab, setTab] = useState<IssueStatus>("open");
  const [selected, setSelected] = useState<string | null>(null);
  if (!data) return <Loading />;
  const list = data.issues.filter((i) => i.status === tab);
  const current = list.find((i) => i.id === selected) || list[0];
  const count = (s: IssueStatus) => data.issueCounts[s];
  const act = async (status: IssueStatus) => {
    if (!current) return;
    const next = list[list.indexOf(current) + 1];
    await call("POST", "/api/issues", { issueId: current.id, status });
    setSelected(next?.id || null);
  };
  return (
    <div className="page">
      <Head title="التنبيهات" copy="كل فرق وجدناه بين مصادرك، مرتبًا حسب أهميته." />
      <div className="tabs alert-tabs">{(["open", "resolved", "snoozed"] as IssueStatus[]).map((s) => <button key={s} className={tab === s ? "active" : ""} onClick={() => { setTab(s); setSelected(null); }}>{{ open: "مفتوحة", resolved: "تمت معالجتها", snoozed: "مؤجلة" }[s]} <em>{count(s)}</em></button>)}</div>
      {current ? (
        <div className="inbox">
          <div className="alert-list">{list.map((i) => (
            <button key={i.id} className={i.id === current.id ? "alert-row active" : "alert-row"} onClick={() => { setSelected(i.id); if (innerWidth < 760) document.querySelector(".alert-detail")?.scrollIntoView({ behavior: "smooth" }); }}>
              <span className={`sev-dot ${i.severity}`}><CircleAlert /></span>
              <div><em>{severityLabels[i.severity]} · {issueLabels[i.type]} · {formatDay(i.date)}</em><b>{i.title}</b><p>{formatSar(i.amount)} · {i.source}</p></div>
            </button>
          ))}</div>
          <section className="alert-detail"><IssueDetail issue={current} onAction={act} /></section>
        </div>
      ) : (
        <div className="empty"><Check /><h3>{tab === "open" ? (data.totals.records ? "لا توجد فروقات مفتوحة" : "لا توجد بيانات بعد") : "لا شيء هنا"}</h3><p>{tab === "open" ? data.hint || "كل ما استوردته مطابق حتى الآن." : "ستظهر هنا التنبيهات التي تعاملت معها."}</p></div>
      )}
    </div>
  );
}

export function Reconciliation({ go, openImport }: { go: Go; openImport: () => void }) {
  const { data } = useNova();
  const [tab, setTab] = useState<"issues" | "matches">("issues");
  if (!data) return <Loading />;
  const t = data.totals;
  const open = data.issues.filter((i) => i.status === "open");
  const kinds = new Set(data.sources.map((s) => s.kind));
  const viaLabel: Record<string, string> = { reference: "بالمرجع", amount: "بالمبلغ", batch: "دفعة مجمّعة", partial: "دفع ناقص" };
  return (
    <div className="page simple-recon">
      <Head title="المطابقة" copy="نقارن ما بعته بما وصلك، ونعرض الفروقات فقط." action={<button className="secondary" onClick={openImport}><Plus /> ملف جديد</button>} />
      <div className="match-path">{(["sales", "payments", "bank"] as SourceKind[]).map((k, i) => <Fragment key={k}>{i > 0 && <ArrowLeft />}<span className={kinds.has(k) ? "" : "off"}>{kindIcon(k)}<b>{kindLabels[k]}</b></span></Fragment>)}</div>
      {data.hint && <div className="smart"><Sparkles /><span><b>لنكمل الصورة</b><p>{data.hint}</p></span><button onClick={openImport}>استيراد <ArrowLeft /></button></div>}
      <div className="simple-recon-summary">
        <span><small>مبيعات مطابقة</small><b>{t.matchedSales.toLocaleString("en-US")} / {t.salesCount.toLocaleString("en-US")}</b></span>
        <span className="bad"><small>تحتاج مراجعة</small><b>{open.length}</b></span>
        <span><small>إجمالي الفروقات المفتوحة</small><b>{formatSar(t.openAmount)}</b></span>
      </div>
      <div className="simple-tabs"><button className={tab === "issues" ? "active" : ""} onClick={() => setTab("issues")}>الفروقات</button><button className={tab === "matches" ? "active" : ""} onClick={() => setTab("matches")}>المطابقات</button></div>
      {tab === "issues" ? (
        open.length ? <section className="issue-list">{open.map((i) => <article key={i.id}><span><small>{issueLabels[i.type]} · {formatDay(i.date)}</small><b>{i.title}</b><em>{i.detail}</em></span><strong>{formatSar(i.amount)}</strong><button onClick={() => go("alerts")} aria-label="التفاصيل"><ArrowLeft /></button></article>)}</section>
          : <div className="empty"><Check /><h3>لا توجد فروقات مفتوحة</h3><p>{t.records ? "كل ما يمكن مطابقته مطابق." : "استورد ملفاتك أولًا."}</p></div>
      ) : (
        <div className="data-table card"><table>
          <thead><tr><th>تاريخ البيع</th><th>تاريخ الوصول</th><th>الطريقة</th><th>العمليات</th><th>المتوقع</th><th>الواصل</th></tr></thead>
          <tbody>{data.matches.map((m, i) => <tr key={i}><td>{formatDay(m.date)}</td><td>{formatDay(m.receivedDate)}</td><td>{viaLabel[m.via]}</td><td>{m.count}</td><td>{formatSar(m.expected)}</td><td className={m.expected - m.received > data.workspace.tolerance ? "neg" : ""}>{formatSar(m.received)}</td></tr>)}</tbody>
        </table>{!data.matches.length && <p className="muted">لا توجد مطابقات بعد.</p>}</div>
      )}
    </div>
  );
}

function Bars({ items }: { items: { name: string; value: number; note?: string }[] }) {
  const max = Math.max(...items.map((i) => Math.abs(i.value)), 1);
  return <div className="bars">{items.map((i) => <div key={i.name}><span>{i.name}</span><i><b style={{ width: `${(Math.abs(i.value) / max) * 100}%` }} /></i><strong>{formatSar(i.value)}</strong>{i.note && <em>{i.note}</em>}</div>)}</div>;
}

function DailyChart({ daily }: { daily: WorkspaceData["daily"] }) {
  const days = daily.slice(-60);
  if (days.length < 2) return <p className="muted">نحتاج بيانات يومين على الأقل لرسم الاتجاه.</p>;
  const max = Math.max(...days.map((d) => Math.max(d.sales, d.received)), 1);
  const line = (key: "sales" | "received") => days.map((d, i) => `${600 - (i / (days.length - 1)) * 600},${200 - (d[key] / max) * 190}`).join(" ");
  const ticks = [0, Math.floor(days.length / 2), days.length - 1];
  return (
    <>
      <svg viewBox="0 0 600 200" preserveAspectRatio="none" className="daily-chart"><polyline className="line one" points={line("sales")} /><polyline className="line two" points={line("received")} /></svg>
      <div className="months">{ticks.map((i) => <span key={i}>{formatDay(days[i].date)}</span>)}</div>
      <div className="legend"><span className="one">المبيعات</span><span className="two">الواصل للبنك</span></div>
    </>
  );
}

export function Analytics({ openImport }: { openImport: () => void }) {
  const { data } = useNova();
  if (!data) return <Loading />;
  const t = data.totals;
  if (!t.records) return <div className="page"><Head title="التحليلات" copy="اتجاهات مبيعاتك وتحصيلك." /><StartHere openImport={openImport} /></div>;
  const salesDays = data.daily.filter((d) => d.sales).length || 1;
  const profit = profitOf(t);
  return (
    <div className="page">
      <Head title="التحليلات" copy={`من ${formatDay(data.daily[0]?.date)} إلى ${formatDay(data.daily.at(-1)?.date || null)}.`} />
      <div className="metrics">
        <article className="metric"><span>المبيعات</span><b>{formatSar(t.sales)}</b><small>{counted(t.salesCount, "عمليات", "عملية")}</small></article>
        {profit ? (
          <article className="metric"><span>صافي الربح</span><b>{formatSar(profit.profit)}</b><small>هامش {pct(profit.margin)} بعد الرسوم والمصاريف</small></article>
        ) : (
          <article className="metric"><span>متوسط اليوم</span><b>{formatSar(Math.round(t.sales / salesDays))}</b><small>على {counted(salesDays, "أيام", "يومًا")} فيها مبيعات</small></article>
        )}
        <article className="metric"><span>الرسوم</span><b>{formatSar(t.fees)}</b><small>{t.sales ? ((t.fees / t.sales) * 100).toFixed(1) : 0}% من المبيعات</small></article>
        <article className={t.openAmount ? "metric danger" : "metric"}><span>فروقات مفتوحة{t.openAmount > 0 && <CircleAlert />}</span><b>{formatSar(t.openAmount)}</b><small>{counted(t.openIssues, "تنبيهات", "تنبيهًا")}</small></article>
      </div>
      <div className="analytics-grid">
        <section className="card chart"><div className="card-head"><span><h3>المبيعات والواصل يوميًا</h3><p>آخر 60 يومًا في بياناتك</p></span></div><DailyChart daily={data.daily} /></section>
        <section className="card"><h3>حسب المصدر</h3><Bars items={data.sources.map((s) => ({ name: s.name, value: s.total, note: kindLabels[s.kind] }))} /></section>
      </div>
      {data.branches.length > 0 && <section className="card branch-card"><h3>المبيعات حسب الفرع أو القناة</h3><Bars items={data.branches.map((b) => ({ name: b.name, value: b.total, note: counted(b.count, "عمليات", "عملية") }))} /></section>}
    </div>
  );
}

export function MoneyFlow({ go, openImport }: { go: Go; openImport: () => void }) {
  const { data } = useNova();
  if (!data) return <Loading />;
  const t = data.totals;
  if (!t.records) return <div className="page"><Head title="تدفق الأموال" copy="من المبيعات حتى وصولها لحسابك: أين ذهب كل ريال." /><StartHere openImport={openImport} /></div>;
  const open = data.issues.filter((i) => i.status === "open");
  const sum = (types: string[]) => open.filter((i) => types.includes(i.type)).reduce((s, i) => s + i.amount, 0);
  const steps = [
    ["المبيعات", t.sales, ""],
    ["الرسوم والعمولات", -t.fees, "down"],
    ["لم يصل بعد موعده", -sum(["missing"]), "down"],
    ["نقص في التحويل", -sum(["short", "fee"]), "down"],
    ["في الطريق", -t.pending, "down"],
    ["وصل للبنك", t.received, "recv"],
  ] as const;
  const max = Math.max(...steps.map((s) => Math.abs(s[1])), 1);
  return (
    <div className="page">
      <Head title="تدفق الأموال" copy="من المبيعات حتى وصولها لحسابك: أين ذهب كل ريال." />
      <section className="card flow-card">
        <div className="waterfall">{steps.map(([label, value, cls]) => <div key={label} className={cls} style={{ height: `${Math.max(4, (Math.abs(value) / max) * 100)}%` }}><b>{formatSar(value)}</b><small>{label}</small></div>)}</div>
      </section>
      {profitOf(t) ? (
        <section className="settlement-one profit-card">
          <header><b>الربحية</b><em className={profitOf(t)!.profit < 0 ? "" : "ok"}>هامش {pct(profitOf(t)!.margin)}</em></header>
          <p><span>المبيعات</span><b>{formatSar(t.sales)}</b></p>
          <p><span>الرسوم والعمولات</span><b>−{formatSar(t.fees)}</b></p>
          <p><span>المصاريف</span><b>−{formatSar(t.expenses)}</b></p>
          <footer><span>صافي الربح</span><b>{formatSar(profitOf(t)!.profit)}</b></footer>
        </section>
      ) : (
        <div className="smart"><TrendingDown /><span><b>اعرف ربحك الحقيقي</b><p>أضف ملف المصاريف (الرواتب، الإيجار، الموردين) ونحسب صافي الربح وهامشه.</p></span></div>
      )}
      {open.length > 0 && <div className="smart"><Sparkles /><span><b>{formatSar(t.openAmount)} تحتاج متابعة</b><p>منها {formatSar(sum(["missing"]))} لم تصل بعد موعدها، و{formatSar(sum(["short", "fee"]))} وصلت ناقصة أو بخصم زائد{sum(["duplicate", "expected"]) > 0 && <>، و{formatSar(sum(["duplicate", "expected"]))} تكرارات أو فروقات أخرى</>}.</p></span><button onClick={() => go("alerts")}>عرض التنبيهات <ArrowLeft /></button></div>}
    </div>
  );
}

function SourceSettings({ source, onClose }: { source: SourceSummary; onClose: () => void }) {
  const { call } = useNova();
  const [kind, setKind] = useState(source.kind);
  const [fee, setFee] = useState(String(source.feeBps / 100));
  const [fixed, setFixed] = useState(String(source.feeFixed / 100));
  const [lag, setLag] = useState(String(source.lagDays));
  const [via, setVia] = useState(source.settlesVia);
  const [error, setError] = useState("");
  const save = async () => {
    try {
      await call("PATCH", "/api/sources", { source: source.name, kind, feeBps: Math.round(Number(fee || 0) * 100), feeFixedHalalas: Math.round(Number(fixed || 0) * 100), lagDays: Number(lag || 0), settlesVia: via });
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "تعذر الحفظ."); }
  };
  const remove = async () => {
    if (!confirm(`حذف «${source.name}» و${counted(source.count, "عمليات", "عملية")} مستوردة منه؟`)) return;
    await call("DELETE", `/api/sources?source=${encodeURIComponent(source.name)}`);
    onClose();
  };
  return (
    <div className="connect-modal" onClick={onClose}>
      <section className="import-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="إغلاق"><X /></button>
        <span className="logo">{kindIcon(kind)}</span>
        <h2>{source.name}</h2>
        <p>هذه الإعدادات تحدد كيف نقرأ المصدر عند المطابقة.</p>
        <div className="import-form">
          <label className="wide">نوع البيانات<select value={kind} onChange={(e) => setKind(e.target.value as SourceKind)}>{(Object.keys(kindLabels) as SourceKind[]).map((k) => <option key={k} value={k}>{kindLabels[k]}</option>)}</select></label>
          <small className="wide">{kindHelp[kind]}</small>
          {(kind === "sales" || kind === "payments") && <><label>نسبة الرسوم المتفق عليها %<input inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} /></label><label>رسوم ثابتة لكل عملية (ر.س)<input inputMode="decimal" value={fixed} onChange={(e) => setFixed(e.target.value)} /></label></>}
          {kind === "sales" && (
            <label className="wide">كيف يصلك مال هذا المصدر؟
              <select value={via} onChange={(e) => setVia(e.target.value as typeof via)}>
                <option value="auto">تلقائي</option>
                <option value="payments">عبر بوابة الدفع أو المنصة</option>
                <option value="bank">مباشرة إلى البنك (مثل تطبيقات التوصيل والتحويلات)</option>
              </select>
            </label>
          )}
          {kind !== "expenses" && <label className="wide">مدة وصول المال بأيام العمل<input inputMode="numeric" value={lag} onChange={(e) => setLag(e.target.value)} /></label>}
          <small className="wide">{kind === "expenses" ? "نجمع المبالغ كمصاريف سواء كانت موجبة أو سالبة، ولا ندخلها في المطابقة." : kind === "payments" ? "إذا كان التقرير يحتوي عمود رسوم نقارنه بالنسبة المتفق عليها، وإلا نحسب الرسوم منها." : kind === "sales" ? "«تلقائي»: يطابق عبر بوابة الدفع إن وجدت، إلا إذا حددت عمولة هنا فيطابق مع البنك مباشرة بعد خصمها. المبيعات النقدية لا تدخل المطابقة." : "نعتبر المبالغ الموجبة واردًا والسالبة مصروفات."}</small>
        </div>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions"><button className="secondary danger" onClick={remove}><Trash2 /> حذف المصدر</button><button className="primary" onClick={save}>حفظ <Check /></button></div>
      </section>
    </div>
  );
}

export function Sources({ openImport }: { openImport: () => void }) {
  const { data } = useNova();
  const [settings, setSettings] = useState<SourceSummary | null>(null);
  const [adding, setAdding] = useState<SourceSummary | null>(null);
  if (!data) return <Loading />;
  return (
    <div className="page simple-connections">
      <Head title="مصادر البيانات" copy="أضف ملفًا من أي نظام أو اربطه تلقائيًا. لن نكرر ما استوردته." action={<button className="primary" onClick={openImport}><Plus /> مصدر جديد</button>} />
      <div className="read-only-banner"><ShieldCheck /><span><b>قراءة فقط</b><small>لا نعدّل أنظمتك ولا ننفذ أي عملية مالية. نحفظ العمليات اللازمة للمطابقة فقط.</small></span></div>
      {data.sources.length ? (
        <section className="source-list">{data.sources.map((s) => (
          <article key={s.name}>
            <span className="logo">{kindIcon(s.kind)}</span>
            <div><b>{s.name}{s.origin === "api" && <span className="tag">ربط تلقائي</span>}</b><small>{kindLabels[s.kind]} · {counted(s.count, "عمليات", "عملية")} · {formatDay(s.from)} – {formatDay(s.to)}</small>{(s.kind === "sales" || s.kind === "payments") && s.feeBps + s.feeFixed > 0 && <em>رسوم متفق عليها {s.feeBps / 100}%{s.feeFixed ? ` + ${formatSar(s.feeFixed)}` : ""}</em>}</div>
            {s.origin === "file" && <button className="secondary" onClick={() => setAdding(s)}><Plus /> ملف</button>}
            <button className="icon" onClick={() => setSettings(s)} aria-label="إعدادات"><Settings /></button>
          </article>
        ))}</section>
      ) : <StartHere openImport={openImport} />}
      <Integrations />
      {settings && <SourceSettings source={settings} onClose={() => setSettings(null)} />}
      {adding && <ImportModal source={{ name: adding.name, kind: adding.kind, system: adding.system }} onClose={() => setAdding(null)} />}
    </div>
  );
}

type IntegrationView = {
  id: string; name: string; category: string; auth: "key" | "oauth"; keyLabel?: string; keyHelp?: string; maturity: "checked" | "beta"; available: boolean;
  connection: { status: string; lastSyncAt: string | null; lastError: string | null } | null;
  fileSources: string[];
};

const since = (iso: string | null) => {
  if (!iso) return "لم تتم بعد";
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return minutes < 2 ? "الآن" : minutes < 60 ? `قبل ${counted(minutes, "دقائق", "دقيقة")}` : minutes < 1440 ? `قبل ${counted(Math.round(minutes / 60), "ساعات", "ساعة")}` : formatDay(iso.slice(0, 10));
};

// Automatic connections: key-based ones connect in place, OAuth ones go through the provider.
function Integrations() {
  const [state, setState] = useState<{ encryption: boolean; providers: IntegrationView[] } | null>(null);
  const [open, setOpen] = useState<IntegrationView | null>(null);
  const [notice] = useState(() => {
    const q = typeof location === "undefined" ? null : new URLSearchParams(location.search);
    if (q?.get("connected")) return { ok: true, text: "تم الربط وسحبنا بياناتك. قد تأخذ المطابقة لحظات." };
    const error = q?.get("error");
    if (error) return { ok: false, text: error === "not-configured" ? "هذا الربط لم يُفعّل بعد على الخادم." : error === "files" ? "عندك ملفات من هذا النظام. احذفها أولًا ثم اربط، حتى لا تتضاعف الأرقام." : "لم يكتمل الربط. حاول مرة أخرى." };
    return null;
  });
  const load = useCallback(() => callApi("GET", "/api/integrations").then((json) => setState(json as unknown as { encryption: boolean; providers: IntegrationView[] }), () => {}), []);
  useEffect(() => {
    load();
  }, [load]);
  return (
    <>
      <h3 className="soon-title">الربط التلقائي</h3>
      {notice && <p className={notice.ok ? "import-count" : "form-error"}>{notice.text}</p>}
      {state && !state.encryption && <div className="smart"><CircleAlert /><span><b>الربط غير مفعّل على الخادم بعد</b><p>يحتاج ضبط مفتاح التشفير NOVA_SECRET_KEY في إعدادات الاستضافة.</p></span></div>}
      <section className="simple-connect-grid integrations">
        {(state?.providers || []).map((p) => (
          <button key={p.id} onClick={() => setOpen(p)} className={p.connection ? (p.connection.status === "error" ? "linked error" : "linked") : ""}>
            <span className="logo">{p.name[0]}</span>
            <span><b>{p.name}</b><small>{p.connection ? (p.connection.status === "error" ? "يحتاج انتباه" : `مربوط · ${since(p.connection.lastSyncAt)}`) : p.fileSources.length ? "تستخدم الملفات" : p.available ? p.category : `${p.category} · قريبًا`}</small></span>
            {p.connection ? (p.connection.status === "error" ? <CircleAlert /> : <Check />) : <Plus />}
          </button>
        ))}
      </section>
      {open && <IntegrationModal provider={open} onClose={() => { setOpen(null); load(); }} />}
    </>
  );
}

function IntegrationModal({ provider: p, onClose }: { provider: IntegrationView; onClose: () => void }) {
  const { refresh } = useNova();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (action: () => Promise<Record<string, unknown>>, done: (r: Record<string, unknown>) => string) => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await action();
      setMessage({ ok: !result.warning && !(Array.isArray(result.errors) && result.errors.length), text: done(result) });
      await refresh();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "تعذر إتمام الطلب." });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="connect-modal" onClick={onClose}>
      <section className="import-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="إغلاق"><X /></button>
        <span className="logo">{p.name[0]}</span>
        <h2>{p.name}</h2>
        <p>{p.category}. نسحب البيانات تلقائيًا كل بضع ساعات وعند فتحك للتطبيق، ونطابقها مع باقي مصادرك. قراءة فقط.</p>
        {p.maturity === "beta" && <small className="import-note">ربط تجريبي: نتحقق منه مع أول حساب حقيقي.</small>}
        {!p.connection && p.fileSources.length > 0 ? (
          <div className="path-lock">
            <CircleAlert />
            <span><b>تستخدم ملفات من {p.name}</b><small>في: {p.fileSources.map((f) => `«${f}»`).join("، ")}. لا يمكن استخدام الملفات والربط التلقائي معًا لنفس النظام حتى لا تتضاعف الأرقام. احذف هذه المصادر من القائمة أعلاه ثم اربط.</small></span>
          </div>
        ) : p.connection ? (
          <>
            <div className="settlement-one">
              <p><span>الحالة</span><b>{p.connection.status === "error" ? "يحتاج انتباه" : "مربوط"}</b></p>
              <p><span>آخر مزامنة</span><b>{since(p.connection.lastSyncAt)}</b></p>
              {p.connection.lastError && <p><span>آخر خطأ</span><b className="red">{p.connection.lastError}</b></p>}
            </div>
            <div className="modal-actions">
              <button className="secondary danger" disabled={busy} onClick={() => { if (confirm(`فصل ${p.name} يحذف البيانات اللي سحبناها منه، عشان تقدر ترفع ملفاته بدلها بدون تكرار. متابعة؟`)) run(() => callApi("DELETE", `/api/integrations?provider=${p.id}`), () => "تم فصل الربط وحذف بياناته. تقدر الحين ترفع ملفاته بدلًا منه."); }}><Trash2 /> فصل الربط</button>
              <button className="primary" disabled={busy} onClick={() => run(() => callApi("POST", "/api/integrations/sync", { provider: p.id }), (r) => (Array.isArray(r.errors) && r.errors.length ? String(r.errors[0]) : `تمت المزامنة: ${counted(Number(r.imported), "عمليات جديدة", "عملية جديدة")}.`))}><RefreshCw /> {busy ? "جارٍ…" : "مزامنة الآن"}</button>
            </div>
          </>
        ) : p.auth === "key" ? (
          <>
            <div className="import-form">
              <label className="wide">{p.keyLabel}<input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="الصق المفتاح هنا" /></label>
              <small className="wide">{p.keyHelp} نحفظه مشفّرًا ولا يظهر لأحد.</small>
            </div>
            <div className="modal-actions"><span /><button className="primary" disabled={busy || !key.trim() || !p.available} onClick={() => run(() => callApi("POST", "/api/integrations", { provider: p.id, key: key.trim() }), (r) => (r.warning ? `تم الربط، لكن السحب الأول لم يكتمل: ${r.warning}` : `تم الربط وسحبنا ${counted(Number(r.imported), "عمليات", "عملية")} من آخر 90 يومًا.`))}><Zap /> {busy ? "جارٍ الربط…" : "ربط"}</button></div>
          </>
        ) : p.available ? (
          <a className="primary full" href={`/api/integrations/oauth/start?provider=${p.id}`} target="_top">ربط عبر {p.name} <ArrowLeft /></a>
        ) : (
          <p className="import-note">يحتاج هذا الربط تسجيل تطبيق NOVA لدى {p.name} وتفعيله من فريق NOVA. إلى ذلك الحين ارفع ملف تصدير منه.</p>
        )}
        {message && <p className={message.ok ? "import-count" : "form-error"}>{message.text}</p>}
      </section>
    </div>
  );
}

export function SettingsPage({ onLogout }: { onLogout: () => void }) {
  const { data, call } = useNova();
  const [name, setName] = useState<string | null>(null);
  const [sector, setSector] = useState<string | null>(null);
  const [tolerance, setTolerance] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!data) return <Loading />;
  const save = async () => {
    await call("PATCH", "/api/workspace", { name: name ?? data.workspace.name, sector: sector ?? data.workspace.sector ?? "", toleranceHalalas: Math.round(Number(tolerance ?? data.workspace.tolerance / 100) * 100) });
    setSaved(true);
  };
  return (
    <div className="page">
      <Head title="الإعدادات" copy="مساحة العمل، وحسابك، وبياناتك." />
      <div className="settings-grid">
        <section className="card">
          <h3>مساحة العمل</h3>
          <div className="import-form">
            <label className="wide">اسم النشاط<input value={name ?? data.workspace.name} onChange={(e) => { setName(e.target.value); setSaved(false); }} /></label>
            <label>القطاع<select value={sector ?? data.workspace.sector ?? ""} onChange={(e) => { setSector(e.target.value); setSaved(false); }}><option value="">— اختر —</option>{sectors.map((s) => <option key={s}>{s}</option>)}</select></label>
            <label>هامش التقريب (ر.س)<input inputMode="decimal" value={tolerance ?? String(data.workspace.tolerance / 100)} onChange={(e) => { setTolerance(e.target.value); setSaved(false); }} /></label>
            <small className="wide">الفروقات التي لا تتجاوز هذا المبلغ نعتبرها تقريبًا ولا ننبهك عليها.</small>
          </div>
          <div className="modal-actions"><button className="primary" onClick={save}>{saved ? <>تم الحفظ <Check /></> : "حفظ"}</button></div>
        </section>
        <section className="card">
          <h3>حسابك</h3>
          <p className="account"><b>{data.user.name}</b><small>{data.user.email}</small></p>
          <button className="secondary" onClick={onLogout}><LogOut /> تسجيل الخروج</button>
          <ChangePassword />
          {data.user.admin && <ResetRequests />}
          <h3 className="space">البيانات</h3>
          <p className="muted">{counted(data.totals.records, "عمليات", "عملية")} من {counted(data.sources.length, "مصادر", "مصدر")}.</p>
          <div className="stack">
            <button className="secondary" disabled={busy} onClick={async () => { setBusy(true); try { await call("POST", "/api/demo"); } finally { setBusy(false); } }}><Sparkles /> إضافة البيانات التجريبية</button>
            <button className="secondary danger" disabled={busy || !data.totals.records} onClick={async () => { if (confirm("حذف كل العمليات والمصادر المستوردة؟ لا يمكن التراجع.")) await call("DELETE", "/api/workspace"); }}><Trash2 /> حذف كل البيانات</button>
          </div>
        </section>
      </div>
    </div>
  );
}

// Owner only: answer "forgot password" requests with a one-time link to send the tester.
function ResetRequests() {
  const [requests, setRequests] = useState<{ id: string; email: string; requestedAt: string; hasAccount: boolean }[] | null>(null);
  const [links, setLinks] = useState<Record<string, string>>({});
  const load = useCallback(() => callApi("GET", "/api/admin/resets").then((r) => setRequests(r.requests as typeof requests), () => setRequests([])), []);
  useEffect(() => {
    load();
  }, [load]);
  const issue = async (id: string) => {
    const r = await callApi("POST", "/api/admin/resets", { id });
    setLinks({ ...links, [id]: String(r.link) });
    navigator.clipboard?.writeText(String(r.link)).catch(() => {});
  };
  return (
    <>
      <h3 className="space">طلبات استعادة كلمة المرور</h3>
      {!requests ? <p className="muted">جارٍ التحميل…</p> : !requests.length ? <p className="muted">لا توجد طلبات.</p> : (
        <div className="reset-list">{requests.map((r) => (
          <div key={r.id}>
            <span><b>{r.email}</b><small>{since(r.requestedAt)}{r.hasAccount ? "" : " · لا يوجد حساب بهذا البريد"}</small></span>
            {links[r.id] ? <input readOnly value={links[r.id]} onFocus={(e) => e.target.select()} /> : <button className="secondary" disabled={!r.hasAccount} onClick={() => issue(r.id)}>إنشاء رابط</button>}
          </div>
        ))}</div>
      )}
      {Object.keys(links).length > 0 && <p className="import-count">نسخنا الرابط. أرسله للمختبر، وصلاحيته 24 ساعة ولمرة واحدة.</p>}
    </>
  );
}

function ChangePassword() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const save = async () => {
    try {
      await callApi("POST", "/api/auth/password", { current, next });
      setCurrent("");
      setNext("");
      setMessage({ ok: true, text: "تم تغيير كلمة المرور." });
    } catch (e) { setMessage({ ok: false, text: e instanceof Error ? e.message : "تعذر التغيير." }); }
  };
  return (
    <>
      <h3 className="space">تغيير كلمة المرور</h3>
      <div className="import-form">
        <label>الحالية<input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></label>
        <label>الجديدة<input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="8 أحرف على الأقل" /></label>
      </div>
      {message && <p className={message.ok ? "import-count" : "form-error"}>{message.text}</p>}
      <button className="secondary" disabled={!current || next.length < 8} onClick={save}>تغيير</button>
    </>
  );
}

export function ComingSoon({ title }: { title: string }) {
  return <div className="page"><Head title={title} copy="هذا القسم قيد البناء." /><div className="empty"><Bell /><h3>قريبًا</h3><p>نعمل على هذا القسم. المطابقة والتنبيهات والتحليلات تعمل الآن على بياناتك.</p></div></div>;
}
