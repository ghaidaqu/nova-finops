// Outside systems NOVA can pull data from. Each provider turns its API records into the same
// rows a file import produces, so reconciliation treats both the same way.
// Pure except for `fetch`, which callers may replace in tests.

import type { ImportRow } from "../import-rows";
import type { SourceKind } from "../reconcile";

export type ProviderId = "moyasar" | "tap" | "qoyod" | "wafeq" | "salla" | "zid" | "foodics";
export type Creds = Record<string, string | number | undefined>;
export type Batch = { label: string; kind: SourceKind; rows: ImportRow[] };
export type OAuthClient = { clientId: string; clientSecret: string; redirectUri: string };
type Fetch = typeof fetch;

export type Provider = {
  id: ProviderId;
  name: string;
  category: string;
  auth: "key" | "oauth";
  keyLabel?: string;
  keyHelp?: string;
  // How sure we are of the API mapping: "checked" against the official docs and examples,
  // "beta" until it has run against a real account.
  maturity: "checked" | "beta";
  pull(creds: Creds, since: string, until: string, fetcher?: Fetch): Promise<{ batches: Batch[]; creds?: Creds }>;
  oauth?: {
    authorizeUrl(client: OAuthClient, state: string): string;
    exchange(code: string, client: OAuthClient, fetcher?: Fetch): Promise<Creds>;
    refresh?(creds: Creds, client: OAuthClient, fetcher?: Fetch): Promise<Creds>;
  };
};

const MAX_PAGES = 30;

export class ProviderError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

async function getJson(fetcher: Fetch, url: string, init: RequestInit = {}) {
  const response = await fetcher(url, { ...init, headers: { Accept: "application/json", ...(init.headers || {}) } });
  if (response.status === 401 || response.status === 403) throw new ProviderError("المفتاح أو التفويض غير صحيح أو منتهي.", response.status);
  if (!response.ok) throw new ProviderError(`رد الخادم ${response.status}.`, response.status);
  return response.json() as Promise<Record<string, unknown>>;
}

// Business day in Saudi time for a UTC instant.
export const riyadhDay = (instant: number | string | Date) => new Date(new Date(instant).getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
const num = (value: unknown) => (typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN);
const str = (value: unknown) => (typeof value === "string" || typeof value === "number" ? String(value) : undefined);
const obj = (value: unknown) => (value && typeof value === "object" ? (value as Record<string, unknown>) : {});
const list = (value: unknown) => (Array.isArray(value) ? (value as Record<string, unknown>[]) : []);
const dayOf = (value: unknown) => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : undefined);
const form = (data: Record<string, string>) => new URLSearchParams(data).toString();

// ---------------------------------------------------------------- mappers (tested)

// Moyasar amounts are in halalas; `fee` already includes VAT. Refunds reduce the amount.
export function mapMoyasar(payment: Record<string, unknown>): ImportRow | null {
  if (!["paid", "captured"].includes(String(payment.status))) return null;
  const gross = num(payment.captured) > 0 ? num(payment.captured) : num(payment.amount);
  const net = gross - (num(payment.refunded) || 0);
  if (!(net > 0)) return null;
  const metadata = obj(payment.metadata);
  const source = obj(payment.source);
  return {
    date: riyadhDay(String(payment.created_at)),
    amount: net / 100,
    fee: Number.isFinite(num(payment.fee)) ? num(payment.fee) / 100 : undefined,
    reference: str(metadata.order_id) || str(metadata.order) || str(metadata.reference) || str(payment.id),
    description: str(payment.description),
    method: str(source.company) || str(source.type),
  };
}

// Tap amounts are in major units; only captured charges are money received.
export function mapTap(charge: Record<string, unknown>): ImportRow | null {
  if (String(charge.status) !== "CAPTURED") return null;
  const amount = num(charge.amount);
  if (!(amount > 0)) return null;
  const reference = obj(charge.reference);
  const created = num(obj(charge.transaction).created);
  return {
    date: riyadhDay(Number.isFinite(created) ? created : String(charge.created || Date.now())),
    amount,
    reference: str(reference.order) || str(reference.transaction) || str(charge.id),
    description: str(charge.description),
    method: str(obj(charge.source).payment_method),
  };
}

export function mapWafeqInvoice(invoice: Record<string, unknown>): ImportRow | null {
  if (String(invoice.status) === "DRAFT") return null;
  const amount = num(invoice.amount);
  const date = dayOf(invoice.invoice_date);
  if (!Number.isFinite(amount) || !date) return null;
  return { date, amount, reference: str(invoice.invoice_number) || str(invoice.reference), description: str(invoice.reference) };
}

export function mapWafeqExpense(expense: Record<string, unknown>): ImportRow | null {
  if (String(expense.status) !== "POSTED") return null;
  const amount = num(expense.amount);
  const date = dayOf(expense.date);
  if (!Number.isFinite(amount) || !date) return null;
  return { date, amount: Math.abs(amount), reference: str(expense.reference), description: str(expense.description) };
}

export function mapQoyod(doc: Record<string, unknown>): ImportRow | null {
  if (/draft|مسود/i.test(String(doc.status))) return null;
  const amount = num(doc.total ?? doc.total_amount ?? doc.amount);
  const date = dayOf(doc.issue_date ?? doc.date);
  if (!Number.isFinite(amount) || !date) return null;
  return { date, amount: Math.abs(amount), reference: str(doc.reference) || str(doc.id), description: str(doc.description ?? doc.notes) };
}

const SALLA_SKIP = new Set(["payment_pending", "canceled", "cancelled", "restoring", "restored", "deleted"]);
export function mapSallaOrder(order: Record<string, unknown>): ImportRow | null {
  if (SALLA_SKIP.has(String(obj(order.status).slug))) return null;
  const amount = num(obj(order.total).amount ?? obj(obj(order.amounts).total).amount);
  const date = dayOf(obj(order.date).date ?? order.created_at);
  if (!Number.isFinite(amount) || !date) return null;
  return { date, amount, reference: str(order.reference_id) || str(order.id), method: str(order.payment_method), description: "طلب من سلة" };
}

export function mapZidOrder(order: Record<string, unknown>): ImportRow | null {
  const status = String(obj(order.order_status).code ?? order.order_status ?? "");
  if (/cancel|reversed|ملغ/i.test(status)) return null;
  const amount = num(order.order_total ?? order.total);
  const date = dayOf(order.created_at);
  if (!Number.isFinite(amount) || !date) return null;
  return { date, amount, reference: str(order.code) || str(order.id), method: str(obj(obj(order.payment).method).name) || str(order.payment_method), description: "طلب من زد" };
}

// Foodics status 4 is a closed (completed) order.
export function mapFoodicsOrder(order: Record<string, unknown>): ImportRow | null {
  if (num(order.status) !== 4) return null;
  const amount = num(order.total_price);
  const date = dayOf(order.business_date);
  if (!Number.isFinite(amount) || !date) return null;
  const methods = list(order.payments).map((p) => str(obj(p.payment_method).name)).filter(Boolean);
  return { date, amount, reference: str(order.reference) || str(order.id), branch: str(obj(order.branch).name), method: methods.join(" + ") || undefined, description: "طلب من فودكس" };
}

const keep = (rows: (ImportRow | null)[]) => rows.filter((r): r is ImportRow => r !== null);

// ---------------------------------------------------------------- providers

export const providers: Record<ProviderId, Provider> = {
  moyasar: {
    id: "moyasar",
    name: "ميسر",
    category: "بوابة دفع",
    auth: "key",
    keyLabel: "المفتاح السري (Secret Key)",
    keyHelp: "من لوحة ميسر: الإعدادات ← مفاتيح API. يبدأ بـ sk_live_ (أو sk_test_ للتجربة).",
    maturity: "checked",
    async pull(creds, since, _until, fetcher = fetch) {
      const auth = `Basic ${btoa(`${creds.key}:`)}`;
      const rows: ImportRow[] = [];
      for (let page = 1; page <= MAX_PAGES; page++) {
        const data = await getJson(fetcher, `https://api.moyasar.com/v1/payments?page=${page}&created[gt]=${since}T00:00:00Z`, { headers: { Authorization: auth } });
        rows.push(...keep(list(data.payments).map(mapMoyasar)));
        if (!obj(data.meta).next_page) break;
      }
      return { batches: [{ label: "المدفوعات", kind: "payments", rows }] };
    },
  },
  tap: {
    id: "tap",
    name: "تاب",
    category: "بوابة دفع",
    auth: "key",
    keyLabel: "المفتاح السري (Secret Key)",
    keyHelp: "من لوحة تاب: goSell ← API Credentials. يبدأ بـ sk_live_.",
    maturity: "checked",
    async pull(creds, since, until, fetcher = fetch) {
      const rows: ImportRow[] = [];
      let after: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const body = { period: { date: { from: String(Date.parse(`${since}T00:00:00+03:00`)), to: String(Date.parse(`${until}T23:59:59+03:00`)) } }, status: "CAPTURED", limit: 50, order: "chronological", ...(after ? { starting_after: after } : {}) };
        const data = await getJson(fetcher, "https://api.tap.company/v2/charges/list", { method: "POST", headers: { Authorization: `Bearer ${creds.key}`, "content-type": "application/json" }, body: JSON.stringify(body) });
        const charges = list(data.charges);
        rows.push(...keep(charges.map(mapTap)));
        after = str(charges.at(-1)?.id);
        if (!data.has_more || !after) break;
      }
      return { batches: [{ label: "المدفوعات", kind: "payments", rows }] };
    },
  },
  wafeq: {
    id: "wafeq",
    name: "وافق",
    category: "محاسبة",
    auth: "key",
    keyLabel: "مفتاح API",
    keyHelp: "من وافق: الإعدادات ← API Keys ← إنشاء مفتاح.",
    maturity: "checked",
    async pull(creds, since, _until, fetcher = fetch) {
      const headers = { Authorization: `Api-Key ${creds.key}` };
      const all = async (path: string) => {
        const out: Record<string, unknown>[] = [];
        let url: string | null = `https://api.wafeq.com/v1/${path}/?page_size=100&created_ts_after=${since}T00:00:00Z`;
        for (let page = 0; url && page < MAX_PAGES; page++) {
          const data = await getJson(fetcher, url, { headers });
          out.push(...list(data.results));
          url = typeof data.next === "string" ? data.next : null;
        }
        return out;
      };
      return {
        batches: [
          { label: "الفواتير", kind: "sales", rows: keep((await all("invoices")).map(mapWafeqInvoice)) },
          { label: "المصاريف", kind: "expenses", rows: keep((await all("expenses")).map(mapWafeqExpense)) },
        ],
      };
    },
  },
  qoyod: {
    id: "qoyod",
    name: "قيود",
    category: "محاسبة",
    auth: "key",
    keyLabel: "مفتاح API",
    keyHelp: "من قيود: الإعدادات ← الإعدادات العامة ← إنشاء مفتاح API.",
    maturity: "beta",
    async pull(creds, since, _until, fetcher = fetch) {
      const headers = { "API-KEY": String(creds.key) };
      const all = async (resource: string) => {
        const out: Record<string, unknown>[] = [];
        for (let page = 1; page <= MAX_PAGES; page++) {
          const data = await getJson(fetcher, `https://api.qoyod.com/2.0/${resource}?page=${page}&q[issue_date_gteq]=${since}`, { headers });
          const items = list(data[resource]);
          out.push(...items);
          if (items.length === 0) break;
        }
        return out;
      };
      return {
        batches: [
          { label: "الفواتير", kind: "sales", rows: keep((await all("invoices")).map(mapQoyod)) },
          { label: "المشتريات", kind: "expenses", rows: keep((await all("bills")).map(mapQoyod)) },
        ],
      };
    },
  },
  salla: {
    id: "salla",
    name: "سلة",
    category: "متجر إلكتروني",
    auth: "oauth",
    maturity: "checked",
    async pull(creds, since, until, fetcher = fetch) {
      const rows: ImportRow[] = [];
      for (let page = 1; page <= MAX_PAGES; page++) {
        const data = await getJson(fetcher, `https://api.salla.dev/admin/v2/orders?from_date=${since}&to_date=${until}&page=${page}&per_page=30`, { headers: { Authorization: `Bearer ${creds.access_token}` } });
        rows.push(...keep(list(data.data).map(mapSallaOrder)));
        const pagination = obj(data.pagination);
        if (!list(data.data).length || num(pagination.currentPage) >= num(pagination.totalPages)) break;
      }
      return { batches: [{ label: "الطلبات", kind: "sales", rows }] };
    },
    oauth: {
      authorizeUrl: (c, state) => `https://accounts.salla.sa/oauth2/auth?${form({ client_id: c.clientId, response_type: "code", redirect_uri: c.redirectUri, scope: "offline_access", state })}`,
      async exchange(code, c, fetcher = fetch) {
        const data = await getJson(fetcher, "https://accounts.salla.sa/oauth2/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form({ client_id: c.clientId, client_secret: c.clientSecret, grant_type: "authorization_code", code, redirect_uri: c.redirectUri, scope: "offline_access" }) });
        return { access_token: str(data.access_token), refresh_token: str(data.refresh_token), expires_at: Date.now() + (num(data.expires) || num(data.expires_in) || 0) * 1000 };
      },
      async refresh(creds, c, fetcher = fetch) {
        const data = await getJson(fetcher, "https://accounts.salla.sa/oauth2/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form({ client_id: c.clientId, client_secret: c.clientSecret, grant_type: "refresh_token", refresh_token: String(creds.refresh_token) }) });
        return { access_token: str(data.access_token), refresh_token: str(data.refresh_token), expires_at: Date.now() + (num(data.expires) || num(data.expires_in) || 0) * 1000 };
      },
    },
  },
  zid: {
    id: "zid",
    name: "زد",
    category: "متجر إلكتروني",
    auth: "oauth",
    maturity: "beta",
    async pull(creds, since, until, fetcher = fetch) {
      const headers = { Authorization: `Bearer ${creds.authorization}`, "X-Manager-Token": String(creds.access_token), "Accept-Language": "ar" };
      const rows: ImportRow[] = [];
      for (let page = 1; page <= MAX_PAGES; page++) {
        const data = await getJson(fetcher, `https://api.zid.sa/v1/managers/store/orders?page=${page}&per_page=50&date_from=${since}&date_to=${until}`, { headers });
        const orders = list(data.orders);
        rows.push(...keep(orders.map(mapZidOrder)));
        if (orders.length < 50) break;
      }
      return { batches: [{ label: "الطلبات", kind: "sales", rows }] };
    },
    oauth: {
      authorizeUrl: (c, state) => `https://oauth.zid.sa/oauth/authorize?${form({ client_id: c.clientId, redirect_uri: c.redirectUri, response_type: "code", state })}`,
      async exchange(code, c, fetcher = fetch) {
        const data = await getJson(fetcher, "https://oauth.zid.sa/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form({ grant_type: "authorization_code", client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: c.redirectUri, code }) });
        return { authorization: str(data.authorization), access_token: str(data.access_token), refresh_token: str(data.refresh_token), expires_at: Date.now() + (num(data.expires_in) || 0) * 1000 };
      },
      async refresh(creds, c, fetcher = fetch) {
        const data = await getJson(fetcher, "https://oauth.zid.sa/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form({ grant_type: "refresh_token", refresh_token: String(creds.refresh_token), client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: c.redirectUri }) });
        return { authorization: str(data.authorization) || str(creds.authorization), access_token: str(data.access_token), refresh_token: str(data.refresh_token), expires_at: Date.now() + (num(data.expires_in) || 0) * 1000 };
      },
    },
  },
  foodics: {
    id: "foodics",
    name: "فودكس",
    category: "نقاط بيع",
    auth: "oauth",
    maturity: "beta",
    async pull(creds, since, _until, fetcher = fetch) {
      const headers = { Authorization: `Bearer ${creds.access_token}` };
      const rows: ImportRow[] = [];
      // Newest business day first; stop once past the window.
      for (let page = 1; page <= MAX_PAGES; page++) {
        const data = await getJson(fetcher, `https://api.foodics.com/v5/orders?include=branch,payments.payment_method&sort=-business_date&page=${page}`, { headers });
        const orders = list(data.data);
        rows.push(...keep(orders.filter((o) => String(o.business_date) >= since).map(mapFoodicsOrder)));
        const last = obj(data.meta);
        if (!orders.length || orders.some((o) => String(o.business_date) < since) || num(last.current_page) >= num(last.last_page)) break;
      }
      return { batches: [{ label: "الطلبات", kind: "sales", rows }] };
    },
    oauth: {
      // Foodics takes the redirect URL from the app settings in its console.
      authorizeUrl: (c, state) => `https://console.foodics.com/authorize?${form({ client_id: c.clientId, state })}`,
      async exchange(code, c, fetcher = fetch) {
        const data = await getJson(fetcher, "https://api.foodics.com/oauth/token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ grant_type: "authorization_code", code, client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: c.redirectUri }) });
        return { access_token: str(data.access_token) };
      },
    },
  },
};

export const providerList = Object.values(providers);
