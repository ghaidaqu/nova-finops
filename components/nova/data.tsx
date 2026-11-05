"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { WorkspaceData } from "@/lib/workspace-data";
import type { IssueType, SourceKind } from "@/lib/reconcile";

export { counted, formatSar } from "@/lib/reconcile";

type Nova = {
  data: WorkspaceData | null;
  error: string;
  refresh: () => Promise<void>;
  call: (method: string, url: string, body?: unknown) => Promise<Record<string, unknown>>;
};

const NovaContext = createContext<Nova | null>(null);

export function useNova() {
  const value = useContext(NovaContext);
  if (!value) throw new Error("useNova must be used inside NovaProvider");
  return value;
}

export async function callApi(method: string, url: string, body?: unknown) {
  const response = await fetch(url, { method, headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw Object.assign(new Error(typeof json.error === "string" ? json.error : "تعذر إتمام الطلب."), { status: response.status });
  return json;
}

export function NovaProvider({ children, onUnauthorized }: { children: React.ReactNode; onUnauthorized: () => void }) {
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [error, setError] = useState("");
  const refresh = useCallback(
    () =>
      callApi("GET", "/api/dashboard").then(
        (json) => {
          setData(json as unknown as WorkspaceData);
          setError("");
        },
        (e) => {
          if ((e as { status?: number }).status === 401) onUnauthorized();
          else setError(e instanceof Error ? e.message : "تعذر تحميل البيانات.");
        },
      ),
    [onUnauthorized],
  );
  useEffect(() => {
    // Load, then pull from connected systems not refreshed in the last few hours.
    refresh().then(() =>
      callApi("POST", "/api/integrations/sync", { stale: true }).then(
        (result) => { if (Number(result.imported) > 0) refresh(); },
        () => {},
      ),
    );
  }, [refresh]);
  const call = useCallback(async (method: string, url: string, body?: unknown) => {
    const result = await callApi(method, url, body);
    await refresh();
    return result;
  }, [refresh]);
  return <NovaContext.Provider value={{ data, error, refresh, call }}>{children}</NovaContext.Provider>;
}

export const kindLabels: Record<SourceKind, string> = { sales: "مبيعات وفواتير", payments: "بوابة دفع أو منصة", bank: "كشف بنك", expenses: "مصاريف وتكاليف" };
export const kindHelp: Record<SourceKind, string> = {
  sales: "ما بعته أو فوترته: نقاط البيع، المتجر، الفواتير، تطبيقات التوصيل.",
  payments: "تقارير بوابات الدفع والمنصات التي تحصّل نيابة عنك، مع الرسوم إن وجدت.",
  bank: "كشف الحساب البنكي: ما وصل فعلًا إلى حسابك.",
  expenses: "الرواتب والإيجار والموردين والمشتريات: نحسب منها صافي الربح وهامشه.",
};
export const issueLabels: Record<IssueType, string> = { missing: "مبلغ لم يصل", short: "دفع ناقص", fee: "رسوم زائدة", unknown: "وارد غير معروف", duplicate: "تكرار", expected: "فرق عن المتوقع" };
export const severityLabels = { high: "عالي", medium: "متوسط", low: "منخفض" };
export const sectors = ["التجارة الإلكترونية", "التجزئة", "المطاعم والمقاهي", "الخدمات", "المقاولات", "الصحة والعيادات", "التعليم والتدريب", "قطاع آخر"];

const dayFormat = new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", { day: "numeric", month: "long", timeZone: "UTC" });
export const formatDay = (date: string | null) => (date ? dayFormat.format(new Date(`${date}T00:00:00Z`)) : "—");
