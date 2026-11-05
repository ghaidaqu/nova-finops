import { env } from "cloudflare:workers";

// Runtime secrets and settings (Cloudflare bindings). Undefined when not configured.
export const setting = (name: keyof Cloudflare.Env & string) => {
  const value = (env as unknown as Record<string, unknown>)[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};
