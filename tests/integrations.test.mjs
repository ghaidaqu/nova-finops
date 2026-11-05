// Provider mappings and paging, using records shaped like each provider's documented API.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mapFoodicsOrder, mapMoyasar, mapQoyod, mapSallaOrder, mapTap, mapWafeqExpense, mapWafeqInvoice, mapZidOrder, providers, ProviderError, riyadhDay } from "../lib/integrations/providers.ts";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("dates are the Saudi business day", () => {
  assert.equal(riyadhDay("2026-10-20T22:30:00Z"), "2026-10-21");
  assert.equal(riyadhDay("2026-10-20T09:12:44.000Z"), "2026-10-20");
});

test("Moyasar: paid payments in halalas, refunds reduce the amount, failed ones are skipped", () => {
  const base = { id: "pay_1", currency: "SAR", created_at: "2026-10-20T09:12:44.000Z", description: "Order ORD-1", metadata: { order_id: "ORD-1" }, source: { type: "creditcard", company: "mada" } };
  assert.deepEqual(mapMoyasar({ ...base, status: "paid", amount: 29407, fee: 676, refunded: 0, captured: 0 }), { date: "2026-10-20", amount: 294.07, fee: 6.76, reference: "ORD-1", description: "Order ORD-1", method: "mada" });
  assert.equal(mapMoyasar({ ...base, status: "paid", amount: 10000, fee: 200, refunded: 2500, captured: 0 }).amount, 75);
  assert.equal(mapMoyasar({ ...base, status: "failed", amount: 10000, fee: 0, refunded: 0, captured: 0 }), null);
  assert.equal(mapMoyasar({ ...base, status: "paid", amount: 10000, fee: 0, refunded: 10000, captured: 0 }), null);
});

test("Tap: captured charges only, millisecond timestamps, order reference", () => {
  const charge = { id: "chg_1", status: "CAPTURED", amount: 404.82, currency: "SAR", reference: { order: "ORD-2", transaction: "tx_9" }, transaction: { created: String(Date.parse("2026-10-20T21:30:00Z")) }, source: { payment_method: "MADA" } };
  assert.deepEqual(mapTap(charge), { date: "2026-10-21", amount: 404.82, reference: "ORD-2", description: undefined, method: "MADA" });
  assert.equal(mapTap({ ...charge, status: "DECLINED" }), null);
});

test("Wafeq: finalized invoices as sales, posted expenses as costs", () => {
  assert.deepEqual(mapWafeqInvoice({ id: "inv", invoice_number: "INV-51", invoice_date: "2026-10-21", status: "FINALIZED", amount: "1150.00", reference: "PO-77" }), { date: "2026-10-21", amount: 1150, reference: "INV-51", description: "PO-77" });
  assert.equal(mapWafeqInvoice({ invoice_date: "2026-10-21", status: "DRAFT", amount: "10" }), null);
  assert.deepEqual(mapWafeqExpense({ date: "2026-10-22", status: "POSTED", amount: "-9000.00", reference: "RENT-10", description: "إيجار" }), { date: "2026-10-22", amount: 9000, reference: "RENT-10", description: "إيجار" });
  assert.equal(mapWafeqExpense({ date: "2026-10-22", status: "DRAFT", amount: "5" }), null);
});

test("Qoyod, Salla, Zid and Foodics skip drafts, cancellations and open orders", () => {
  assert.equal(mapQoyod({ reference: "Q-1", issue_date: "2026-10-01", total: "575.0", status: "Approved" }).amount, 575);
  assert.equal(mapQoyod({ reference: "Q-2", issue_date: "2026-10-01", total: "10", status: "Draft" }), null);
  assert.deepEqual(mapSallaOrder({ id: 9, reference_id: 101245, date: { date: "2026-10-20 14:30:00.000000" }, total: { amount: 327.75 }, status: { slug: "completed" }, payment_method: "mada" }), { date: "2026-10-20", amount: 327.75, reference: "101245", method: "mada", description: "طلب من سلة" });
  assert.equal(mapSallaOrder({ date: { date: "2026-10-20" }, total: { amount: 1 }, status: { slug: "canceled" } }), null);
  assert.equal(mapZidOrder({ code: "5501", created_at: "2026-10-05 21:12:00", order_total: "327.75", order_status: { code: "delivered" } }).amount, 327.75);
  assert.equal(mapZidOrder({ code: "5502", created_at: "2026-10-09", order_total: "460", order_status: { code: "cancelled" } }), null);
  const foodics = { reference: "00123", business_date: "2026-10-20", total_price: 115, status: 4, branch: { name: "Olaya" }, payments: [{ payment_method: { name: "Cash" } }] };
  assert.deepEqual(mapFoodicsOrder(foodics), { date: "2026-10-20", amount: 115, reference: "00123", branch: "Olaya", method: "Cash", description: "طلب من فودكس" });
  assert.equal(mapFoodicsOrder({ ...foodics, status: 5 }), null);
});

test("Moyasar pulls every page and sends the key as basic auth", async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, auth: init.headers.Authorization });
    const page = Number(new URL(url).searchParams.get("page"));
    const payment = { id: `p${page}`, status: "paid", amount: 1000 * page, fee: 10, refunded: 0, captured: 0, created_at: "2026-10-20T10:00:00Z", metadata: {}, source: {} };
    return json({ payments: [payment], meta: { current_page: page, next_page: page < 3 ? page + 1 : null } });
  };
  const { batches } = await providers.moyasar.pull({ key: "sk_test_x" }, "2026-08-01", "2026-11-01", fetcher);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].auth, `Basic ${btoa("sk_test_x:")}`);
  assert.deepEqual(batches[0].rows.map((r) => r.amount), [10, 20, 30]);
  assert.equal(batches[0].kind, "payments");
});

test("Tap pages with starting_after until has_more is false", async () => {
  const bodies = [];
  const fetcher = async (_url, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    const n = bodies.length;
    return json({ has_more: n < 2, charges: [{ id: `chg_${n}`, status: "CAPTURED", amount: 50, reference: {}, transaction: { created: String(Date.parse("2026-10-20T10:00:00Z")) }, source: {} }] });
  };
  const { batches } = await providers.tap.pull({ key: "sk" }, "2026-10-01", "2026-10-31", fetcher);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].starting_after, "chg_1");
  assert.equal(batches[0].rows.length, 2);
});

test("Wafeq follows `next` links and returns sales and expenses separately", async () => {
  const fetcher = async (url) => {
    if (url.includes("/invoices/") && !url.includes("page=2")) return json({ next: "https://api.wafeq.com/v1/invoices/?page=2", results: [{ invoice_number: "A", invoice_date: "2026-10-01", status: "SENT", amount: "100" }] });
    if (url.includes("/invoices/")) return json({ next: null, results: [{ invoice_number: "B", invoice_date: "2026-10-02", status: "FINALIZED", amount: "200" }] });
    return json({ next: null, results: [{ date: "2026-10-03", status: "POSTED", amount: "50", reference: "E" }] });
  };
  const { batches } = await providers.wafeq.pull({ key: "k" }, "2026-08-01", "2026-11-01", fetcher);
  assert.deepEqual(batches.map((b) => [b.kind, b.rows.length]), [["sales", 2], ["expenses", 1]]);
});

test("a rejected key surfaces as a readable error", async () => {
  await assert.rejects(providers.moyasar.pull({ key: "bad" }, "2026-10-01", "2026-10-01", async () => json({ message: "Invalid authorization credentials" }, 401)), (e) => e instanceof ProviderError && /المفتاح/.test(e.message));
});

test("OAuth authorize URLs carry the client, redirect and state", () => {
  const client = { clientId: "cid", clientSecret: "s", redirectUri: "https://nova.example/api/integrations/oauth/callback" };
  const salla = new URL(providers.salla.oauth.authorizeUrl(client, "st"));
  assert.equal(salla.origin + salla.pathname, "https://accounts.salla.sa/oauth2/auth");
  assert.equal(salla.searchParams.get("scope"), "offline_access");
  assert.equal(new URL(providers.zid.oauth.authorizeUrl(client, "st")).searchParams.get("redirect_uri"), client.redirectUri);
  assert.equal(new URL(providers.foodics.oauth.authorizeUrl(client, "st")).searchParams.get("state"), "st");
});
