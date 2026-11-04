// Applies drizzle/*.sql to the local D1 database used by `npm run dev` and `npm start`.
// Wrangler records applied migrations, so running this again only applies new ones.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

// Same binding and placeholder id as vite.config.ts, so dev and this script share one database.
mkdirSync(".wrangler", { recursive: true });
writeFileSync(".wrangler/migrate-local.json", JSON.stringify({
  name: "nova-local-migrations",
  compatibility_date: "2026-05-15",
  d1_databases: [{ binding: "DB", database_name: "site-creator-d1", database_id: "00000000-0000-4000-8000-000000000000", migrations_dir: "../drizzle" }],
}));
const result = spawnSync(process.execPath, ["--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", "d1", "migrations", "apply", "DB", "--local", "--config", ".wrangler/migrate-local.json", "--persist-to", ".wrangler/state"], { stdio: "inherit", env: { ...process.env, CI: "1" } });
process.exit(result.status ?? 1);
