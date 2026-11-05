import { setting } from "@/lib/env";

// AES-GCM encryption for stored third-party credentials, keyed by NOVA_SECRET_KEY.
const encoder = new TextEncoder();
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export class MissingSecretError extends Error {}

async function key() {
  const secret = setting("NOVA_SECRET_KEY");
  if (!secret) throw new MissingSecretError("NOVA_SECRET_KEY is not configured");
  const raw = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptJson(value: unknown) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), encoder.encode(JSON.stringify(value)));
  return `v1.${b64(iv)}.${b64(new Uint8Array(data))}`;
}

export async function decryptJson<T>(text: string): Promise<T> {
  const [version, iv, data] = text.split(".");
  if (version !== "v1" || !iv || !data) throw new Error("Unknown credential format");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await key(), unb64(data));
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}

// HMAC-signed short-lived values (OAuth state), so no table is needed to verify them.
export async function sign(payload: Record<string, unknown>, ttlSeconds = 600) {
  const body = b64(encoder.encode(JSON.stringify({ ...payload, exp: Date.now() + ttlSeconds * 1000 })));
  const mac = await crypto.subtle.sign("HMAC", await hmacKey(), encoder.encode(body));
  return `${body}.${b64(new Uint8Array(mac)).replace(/=+$/, "")}`.replace(/\+/g, "-").replace(/\//g, "_");
}

export async function verify<T extends Record<string, unknown>>(token: string): Promise<T | null> {
  const [body, mac] = token.replace(/-/g, "+").replace(/_/g, "/").split(".");
  if (!body || !mac) return null;
  const pad = (s: string) => s + "=".repeat((4 - (s.length % 4)) % 4);
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(), unb64(pad(mac)), encoder.encode(body));
  if (!ok) return null;
  const data = JSON.parse(new TextDecoder().decode(unb64(pad(body)))) as T & { exp: number };
  return data.exp > Date.now() ? data : null;
}

async function hmacKey() {
  const secret = setting("NOVA_SECRET_KEY");
  if (!secret) throw new MissingSecretError("NOVA_SECRET_KEY is not configured");
  return crypto.subtle.importKey("raw", encoder.encode(`state:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
