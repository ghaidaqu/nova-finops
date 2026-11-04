"use client";
import { useMemo, useState } from "react";
import { ArrowLeft, Check, FileSpreadsheet, X } from "lucide-react";
import { guessMapping, readFile, toRows, type Field, type Mapping, type Table } from "@/lib/parse-file";
import type { SourceKind } from "@/lib/reconcile";
import { counted, formatDay, formatSar, kindHelp, kindLabels, useNova } from "./data";

const fieldLabels: [Field, string, boolean][] = [
  ["date", "التاريخ", true],
  ["amount", "المبلغ", false],
  ["credit", "دائن / وارد", false],
  ["debit", "مدين / صادر", false],
  ["reference", "رقم المرجع أو الطلب", false],
  ["description", "الوصف", false],
  ["fee", "الرسوم أو العمولة", false],
  ["branch", "الفرع أو القناة", false],
  ["expected", "المبلغ المتوقع", false],
];

const guessKind = (name: string, headers: string[]): SourceKind => {
  const text = `${name} ${headers.join(" ")}`.toLowerCase();
  if (/bank|بنك|كشف|statement|دائن|مدين|credit|debit/.test(text)) return "bank";
  if (/payout|settlement|gateway|fee|رسوم|تسوية|moyasar|tap|hyperpay|stripe|paytabs|ميسر/.test(text)) return "payments";
  return "sales";
};

export function ImportModal({ onClose, source: presetSource }: { onClose: () => void; source?: { name: string; kind: SourceKind } }) {
  const { call } = useNova();
  const [table, setTable] = useState<Table | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [name, setName] = useState(presetSource?.name || "");
  const [kind, setKind] = useState<SourceKind>(presetSource?.kind || "sales");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ imported: number; skipped: number; invalid: number } | null>(null);

  const parsed = useMemo(() => (table ? toRows(table, mapping) : null), [table, mapping]);
  const hasAmount = mapping.amount !== undefined || mapping.credit !== undefined || mapping.debit !== undefined;

  const pick = async (file: File) => {
    setError("");
    setBusy(true);
    try {
      const t = await readFile(file);
      if (!t.rows.length) throw new Error("الملف فارغ أو لا يحتوي صفوفًا بعد العناوين.");
      setTable(t);
      setMapping(guessMapping(t.headers));
      if (!presetSource) {
        setName(file.name.replace(/\.[^.]+$/, "").slice(0, 60));
        setKind(guessKind(file.name, t.headers));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر قراءة الملف.");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!parsed?.rows.length) return;
    setBusy(true);
    setError("");
    try {
      const result = await call("POST", "/api/import", { source: name.trim() || "ملف مستورد", kind, rows: parsed.rows });
      setDone({ imported: Number(result.imported), skipped: Number(result.skipped), invalid: Number(result.invalid) + parsed.invalid });
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر الاستيراد.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="connect-modal" onClick={onClose}>
      <section className="import-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="إغلاق"><X /></button>
        <span className="logo"><FileSpreadsheet /></span>
        {done ? (
          <>
            <h2>تم الاستيراد</h2>
            <p>أضفنا <b>{counted(done.imported, "عمليات", "عملية")}</b> إلى «{name}».{done.skipped > 0 && <> تجاهلنا {counted(done.skipped, "عمليات موجودة", "عملية موجودة")} من قبل.</>}{done.invalid > 0 && <> و{counted(done.invalid, "صفوف", "صفًا")} بلا تاريخ أو مبلغ صالح.</>}</p>
            <p>أعدنا المطابقة على كل بياناتك. ستجد النتيجة في الرئيسية والمطابقة.</p>
            <button className="primary full" onClick={onClose}>تم <Check /></button>
          </>
        ) : !table ? (
          <>
            <h2>{presetSource ? `إضافة ملف إلى ${presetSource.name}` : "استيراد ملف"}</h2>
            <p>صدّر العمليات من نظامك بصيغة CSV أو Excel (xlsx) وارفعه هنا. نتعرف على الأعمدة تلقائيًا وتراجعها قبل الحفظ.</p>
            <label className="upload-file">
              <FileSpreadsheet />
              <span>{busy ? "جارٍ القراءة…" : "اختر ملف CSV أو Excel"}</span>
              <input disabled={busy} type="file" accept=".csv,.txt,.xlsx,text/csv" onChange={(e) => { const file = e.target.files?.[0]; if (file) pick(file); }} />
            </label>
            {error && <p className="form-error">{error}</p>}
            <small className="import-note">جرّب بملفات جاهزة: <a href="/samples/sales.csv" download>مبيعات</a> · <a href="/samples/gateway.csv" download>بوابة دفع</a> · <a href="/samples/bank.csv" download>كشف بنك</a></small>
          </>
        ) : (
          <>
            <h2>راجع الأعمدة</h2>
            <p>قرأنا {counted(table.rows.length, "صفوف", "صفًا")}. تأكد أن كل حقل مربوط بالعمود الصحيح.</p>
            <div className="import-form">
              <label>اسم المصدر<input value={name} onChange={(e) => setName(e.target.value)} disabled={Boolean(presetSource)} placeholder="مثال: متجر سلة" /></label>
              <label>نوع البيانات
                <select value={kind} onChange={(e) => setKind(e.target.value as SourceKind)} disabled={Boolean(presetSource)}>
                  {(Object.keys(kindLabels) as SourceKind[]).map((k) => <option key={k} value={k}>{kindLabels[k]}</option>)}
                </select>
              </label>
              <small className="wide">{kindHelp[kind]}</small>
              {fieldLabels.map(([field, label, required]) => (
                <label key={field}>{label}{required && " *"}
                  <select value={mapping[field] ?? ""} onChange={(e) => setMapping({ ...mapping, [field]: e.target.value === "" ? undefined : Number(e.target.value) })}>
                    <option value="">— غير موجود —</option>
                    {table.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                  </select>
                </label>
              ))}
            </div>
            {!hasAmount && <p className="form-error">اختر عمود المبلغ، أو عمودي الدائن والمدين.</p>}
            {parsed && hasAmount && (
              <>
                <div className="preview">
                  <table>
                    <thead><tr><th>التاريخ</th><th>المبلغ</th><th>المرجع</th><th>الوصف</th>{mapping.fee !== undefined && <th>الرسوم</th>}</tr></thead>
                    <tbody>
                      {parsed.rows.slice(0, 5).map((r, i) => (
                        <tr key={i}><td>{formatDay(r.date)}</td><td className={r.amount < 0 ? "neg" : ""}>{formatSar(Math.round(r.amount * 100))}</td><td>{r.reference || "—"}</td><td>{r.description || "—"}</td>{mapping.fee !== undefined && <td>{r.fee === undefined ? "—" : formatSar(Math.round(r.fee * 100))}</td>}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="import-count">{counted(parsed.rows.length, "عمليات صالحة", "عملية صالحة")}{parsed.invalid > 0 && <span> · سنتجاهل {counted(parsed.invalid, "صفوف", "صفًا")} بلا تاريخ أو مبلغ</span>}</p>
              </>
            )}
            {error && <p className="form-error">{error}</p>}
            <div className="modal-actions">
              <button className="secondary" onClick={() => setTable(null)}>ملف آخر</button>
              <button className="primary" disabled={busy || !parsed?.rows.length || mapping.date === undefined} onClick={save}>{busy ? "جارٍ الحفظ…" : `استيراد ${counted(parsed?.rows.length || 0, "عمليات", "عملية")}`} <ArrowLeft /></button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
