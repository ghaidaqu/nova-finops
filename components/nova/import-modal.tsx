"use client";
import { useMemo, useState } from "react";
import { ArrowLeft, Check, FileSpreadsheet, X } from "lucide-react";
import { bestSheet, guessKind, guessMapping, readFile, toRows, toTable, type Field, type Mapping, type Sheet } from "@/lib/parse-file";
import type { SourceKind } from "@/lib/reconcile";
import { callApi, counted, formatDay, formatSar, kindHelp, kindLabels, useNova } from "./data";

const fieldLabels: [Field, string, boolean][] = [
  ["date", "التاريخ", true],
  ["amount", "المبلغ", false],
  ["credit", "دائن / وارد", false],
  ["debit", "مدين / صادر", false],
  ["direction", "نوع الحركة (مدين/دائن)", false],
  ["reference", "رقم الطلب أو الفاتورة أو المرجع", false],
  ["description", "الوصف", false],
  ["fee", "الرسوم أو العمولة", false],
  ["tax", "ضريبة الرسوم", false],
  ["status", "الحالة (نستبعد الملغي والفاشل)", false],
  ["method", "طريقة الدفع (نستبعد النقدي من المطابقة)", false],
  ["branch", "الفرع أو القناة", false],
  ["expected", "المبلغ المتوقع", false],
];

// Large files go up in parts so each request stays well inside the server's limits.
const CHUNK = 5000;

export function ImportModal({ onClose, source: presetSource }: { onClose: () => void; source?: { name: string; kind: SourceKind } }) {
  const { refresh } = useNova();
  const [file, setFile] = useState<{ name: string; sheets: Sheet[] } | null>(null);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [headerIndex, setHeaderIndex] = useState(0);
  const [mapping, setMapping] = useState<Mapping>({});
  const [name, setName] = useState(presetSource?.name || "");
  const [kind, setKind] = useState<SourceKind>(presetSource?.kind || "sales");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ imported: number; skipped: number; invalid: number; excluded: number } | null>(null);

  const cells = useMemo(() => file?.sheets[sheetIndex]?.cells || [], [file, sheetIndex]);
  const table = useMemo(() => (file ? toTable(cells, headerIndex) : null), [file, cells, headerIndex]);
  const parsed = useMemo(() => (table ? toRows(table, mapping) : null), [table, mapping]);
  const hasAmount = mapping.amount !== undefined || mapping.credit !== undefined || mapping.debit !== undefined;

  // Re-detect everything for a sheet or header row the user picked (or the best guess).
  const choose = (sheets: Sheet[], fileName: string, sheet: number, header?: number) => {
    const t = toTable(sheets[sheet].cells, header);
    const k = presetSource?.kind || guessKind(fileName, t.headers);
    setSheetIndex(sheet);
    setHeaderIndex(t.headerIndex);
    setMapping(guessMapping(t.headers, k, t.rows));
    if (!presetSource) setKind(k);
  };

  const pick = async (picked: File) => {
    setError("");
    setBusy(true);
    try {
      const sheets = (await readFile(picked)).filter((s) => s.cells.length);
      if (!sheets.length) throw new Error("الملف فارغ.");
      setFile({ name: picked.name, sheets });
      if (!presetSource) setName(picked.name.replace(/\.[^.]+$/, "").slice(0, 60));
      choose(sheets, picked.name, bestSheet(sheets));
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
    const total = { imported: 0, skipped: 0, invalid: parsed.invalid, excluded: parsed.skipped.status + parsed.skipped.summary };
    try {
      for (let i = 0; i < parsed.rows.length; i += CHUNK) {
        if (parsed.rows.length > CHUNK) setProgress(`${Math.min(i + CHUNK, parsed.rows.length).toLocaleString("en-US")} / ${parsed.rows.length.toLocaleString("en-US")}`);
        const result = await callApi("POST", "/api/import", { source: name.trim() || "ملف مستورد", kind, rows: parsed.rows.slice(i, i + CHUNK) });
        total.imported += Number(result.imported);
        total.skipped += Number(result.skipped);
        total.invalid += Number(result.invalid);
      }
      setDone(total);
    } catch (e) {
      setError(`${e instanceof Error ? e.message : "تعذر الاستيراد."}${total.imported ? ` (حُفظت ${counted(total.imported, "عمليات", "عملية")} قبل التوقف، وإعادة المحاولة لن تكررها.)` : ""}`);
    } finally {
      setProgress("");
      setBusy(false);
      await refresh();
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
            <p>أضفنا <b>{counted(done.imported, "عمليات", "عملية")}</b> إلى «{name}».{done.skipped > 0 && <> تجاهلنا {counted(done.skipped, "عمليات موجودة", "عملية موجودة")} من قبل.</>}{done.invalid > 0 && <> و{counted(done.invalid, "صفوف", "صفًا")} بلا تاريخ أو مبلغ صالح.</>}{done.excluded > 0 && <> واستبعدنا {counted(done.excluded, "صفوف", "صفًا")} ملغاة أو فاشلة أو أرصدة وإجماليات.</>}</p>
            <p>أعدنا المطابقة على كل بياناتك. ستجد النتيجة في الرئيسية والمطابقة.</p>
            <button className="primary full" onClick={onClose}>تم <Check /></button>
          </>
        ) : !table || !file ? (
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
              {file.sheets.length > 1 && (
                <label className="wide">الورقة
                  <select value={sheetIndex} onChange={(e) => choose(file.sheets, file.name, Number(e.target.value))}>
                    {file.sheets.map((s, i) => <option key={i} value={i}>{s.name}</option>)}
                  </select>
                </label>
              )}
              <label className="wide">صف العناوين
                <select value={headerIndex} onChange={(e) => choose(file.sheets, file.name, sheetIndex, Number(e.target.value))}>
                  {cells.slice(0, 30).map((row, i) => <option key={i} value={i}>{`${i + 1}: ${row.filter((c) => c !== null && c !== "").slice(0, 4).map(String).join(" · ").slice(0, 70)}`}</option>)}
                </select>
              </label>
              <label>اسم المصدر<input value={name} onChange={(e) => setName(e.target.value)} disabled={Boolean(presetSource)} placeholder="مثال: متجر سلة" /></label>
              <label>نوع البيانات
                <select value={kind} onChange={(e) => { const k = e.target.value as SourceKind; setKind(k); if (table) setMapping(guessMapping(table.headers, k, table.rows)); }} disabled={Boolean(presetSource)}>
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
                <p className="import-count">{counted(parsed.rows.length, "عمليات صالحة", "عملية صالحة")}{parsed.invalid > 0 && <span> · سنتجاهل {counted(parsed.invalid, "صفوف", "صفًا")} بلا تاريخ أو مبلغ</span>}{parsed.skipped.status > 0 && <span> · نستبعد {counted(parsed.skipped.status, "صفوف", "صفًا")} ملغاة أو فاشلة أو مستردة</span>}{parsed.skipped.summary > 0 && <span> · نتجاهل {counted(parsed.skipped.summary, "صفوف", "صفًا")} أرصدة أو إجماليات</span>}</p>
              </>
            )}
            {error && <p className="form-error">{error}</p>}
            <div className="modal-actions">
              <button className="secondary" onClick={() => setFile(null)}>ملف آخر</button>
              <button className="primary" disabled={busy || !parsed?.rows.length || mapping.date === undefined} onClick={save}>{busy ? `جارٍ الحفظ… ${progress}` : `استيراد ${counted(parsed?.rows.length || 0, "عمليات", "عملية")}`} <ArrowLeft /></button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
