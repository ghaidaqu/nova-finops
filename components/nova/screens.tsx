"use client";
import { Fragment, useState } from "react";
import { ArrowLeft, Bell, Check, CircleAlert, Clock, CreditCard, FileSpreadsheet, GitCompareArrows, Landmark, LogOut, Plus, ReceiptText, Settings, ShieldCheck, Sparkles, Trash2, X } from "lucide-react";
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

const kindIcon = (kind: SourceKind) => (kind === "bank" ? <Landmark /> : kind === "payments" ? <CreditCard /> : <ReceiptText />);

function StartHere({ openImport }: { openImport: () => void }) {
  const { call } = useNova();
  const [busy, setBusy] = useState(false);
  return (
    <section className="start-here">
      <h2>ابدأ بملفاتك، أو جرّب ببيانات تجريبية.</h2>
      <p>لا نحتاج ربطًا أو صلاحيات: صدّر من أنظمتك ملف المبيعات وكشف البنك (وتقرير بوابة الدفع إن وجد)، ونطابقها تلقائيًا.</p>
      <div className="start-grid">
        <button onClick={openImport}><FileSpreadsheet /><b>استيراد ملف</b><small>CSV أو Excel من أي نظام</small></button>
        <button disabled={busy} onClick={async () => { setBusy(true); try { await call("POST", "/api/demo"); } finally { setBusy(false); } }}><Sparkles /><b>{busy ? "جارٍ التحميل…" : "بيانات تجريبية"}</b><small>نشاط تجاري لستة أسابيع فيه مشاكل حقيقية</small></button>
      </div>
      <ol className="kinds">{(Object.keys(kindLabels) as SourceKind[]).map((k) => <li key={k}>{kindIcon(k)}<span><b>{kindLabels[k]}</b><small>{kindHelp[k]}</small></span></li>)}</ol>
    </section>
  );
}

export function Overview({ go, openImport }: { go: Go; openImport: () => void }) {
  const { data } = useNova();
  if (!data) return <Loading />;
  const t = data.totals;
  const open = data.issues.filter((i) => i.status === "open");
  const top = open.find((i) => i.type !== "unknown") || open[0];
  return (
    <div className="page simple-dashboard">
      <Head title={`مرحبًا، ${data.user.name}`} copy={t.records ? `قراءة من ${counted(t.records, "عمليات", "عملية")} في ${counted(data.sources.length, "مصادر", "مصدر")}.` : "مساحة عملك جاهزة. أضف أول بياناتك."} />
      {!t.records ? <StartHere openImport={openImport} /> : (
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
  return (
    <div className="page">
      <Head title="التحليلات" copy={`من ${formatDay(data.daily[0]?.date)} إلى ${formatDay(data.daily.at(-1)?.date || null)}.`} />
      <div className="metrics">
        <article className="metric"><span>المبيعات</span><b>{formatSar(t.sales)}</b><small>{counted(t.salesCount, "عمليات", "عملية")}</small></article>
        <article className="metric"><span>متوسط اليوم</span><b>{formatSar(Math.round(t.sales / salesDays))}</b><small>على {counted(salesDays, "أيام", "يومًا")} فيها مبيعات</small></article>
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
          {kind !== "bank" && <><label>نسبة الرسوم المتفق عليها %<input inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} /></label><label>رسوم ثابتة لكل عملية (ر.س)<input inputMode="decimal" value={fixed} onChange={(e) => setFixed(e.target.value)} /></label></>}
          {kind === "sales" && (
            <label className="wide">كيف يصلك مال هذا المصدر؟
              <select value={via} onChange={(e) => setVia(e.target.value as typeof via)}>
                <option value="auto">تلقائي</option>
                <option value="payments">عبر بوابة الدفع أو المنصة</option>
                <option value="bank">مباشرة إلى البنك (مثل تطبيقات التوصيل والتحويلات)</option>
              </select>
            </label>
          )}
          <label className="wide">مدة وصول المال بأيام العمل<input inputMode="numeric" value={lag} onChange={(e) => setLag(e.target.value)} /></label>
          <small className="wide">{kind === "payments" ? "إذا كان التقرير يحتوي عمود رسوم نقارنه بالنسبة المتفق عليها، وإلا نحسب الرسوم منها." : kind === "sales" ? "«تلقائي»: يطابق عبر بوابة الدفع إن وجدت، إلا إذا حددت عمولة هنا فيطابق مع البنك مباشرة بعد خصمها. المبيعات النقدية لا تدخل المطابقة." : "نعتبر المبالغ الموجبة واردًا والسالبة مصروفات."}</small>
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
      <Head title="مصادر البيانات" copy="كل مصدر هو ملف تصدير من أحد أنظمتك. أضف ملفات جديدة متى شئت، ولن نكرر ما استوردته." action={<button className="primary" onClick={openImport}><Plus /> مصدر جديد</button>} />
      <div className="read-only-banner"><ShieldCheck /><span><b>قراءة فقط</b><small>لا نعدّل أنظمتك ولا ننفذ أي عملية مالية. نحفظ العمليات اللازمة للمطابقة فقط.</small></span></div>
      {data.sources.length ? (
        <section className="source-list">{data.sources.map((s) => (
          <article key={s.name}>
            <span className="logo">{kindIcon(s.kind)}</span>
            <div><b>{s.name}</b><small>{kindLabels[s.kind]} · {counted(s.count, "عمليات", "عملية")} · {formatDay(s.from)} – {formatDay(s.to)}</small>{s.kind !== "bank" && s.feeBps + s.feeFixed > 0 && <em>رسوم متفق عليها {s.feeBps / 100}%{s.feeFixed ? ` + ${formatSar(s.feeFixed)}` : ""}</em>}</div>
            <button className="secondary" onClick={() => setAdding(s)}><Plus /> ملف</button>
            <button className="icon" onClick={() => setSettings(s)} aria-label="إعدادات"><Settings /></button>
          </article>
        ))}</section>
      ) : <StartHere openImport={openImport} />}
      <h3 className="soon-title">الربط التلقائي (قريبًا)</h3>
      <section className="simple-connect-grid soon">{["Salla", "Zid", "Foodics", "Moyasar", "Tap", "Qoyod", "Wafeq", "Odoo"].map((n) => <div key={n}><span className="logo">{n[0]}</span><span><b>{n}</b><small>صدّر منه CSV الآن</small></span></div>)}</section>
      {settings && <SourceSettings source={settings} onClose={() => setSettings(null)} />}
      {adding && <ImportModal source={{ name: adding.name, kind: adding.kind }} onClose={() => setAdding(null)} />}
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
