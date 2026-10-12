import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "./load-env";

loadEnv();

/** Applies db/migrations/*.sql in order, once each (tracked in schema_migrations). */
export async function migrate(log = console.log) {
  const { query } = await import("../lib/db");
  await query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const dir = path.resolve(process.cwd(), "db/migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const done = new Set((await query(`SELECT name FROM schema_migrations`)).map((r) => r.name));
  for (const f of files) {
    if (done.has(f)) { log(`= ${f} (already applied)`); continue; }
    const body = fs.readFileSync(path.join(dir, f), "utf8");
    // Neon's HTTP driver runs one statement per call; split on semicolons at line ends.
    const statements = body.split(/;\s*$/m).map((s) => s.replace(/^\s*--.*$/gm, "").trim()).filter(Boolean);
    for (const s of statements) await query(s);
    await query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [f]);
    log(`+ ${f} (${statements.length} statements)`);
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/migrate.ts")) {
  migrate().then(() => console.log("migrations complete"), (e) => { console.error(e); process.exit(1); });
}
