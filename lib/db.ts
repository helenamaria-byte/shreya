import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let cached: { url: string; fn: NeonQueryFunction<false, false> } | null = null;

/** Neon HTTP client. Reads DATABASE_URL lazily so tests can point it at the test branch. */
export function db(): NeonQueryFunction<false, false> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  if (!cached || cached.url !== url) cached = { url, fn: neon(url) };
  return cached.fn;
}

/** Tagged-template shorthand: await sql`select ...` returns rows. */
export function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  return db()(strings, ...values) as unknown as Promise<any[]>;
}

/** Parameterised query for dynamic SQL. */
export function query(text: string, params: unknown[] = []) {
  return db().query(text, params) as unknown as Promise<any[]>;
}
