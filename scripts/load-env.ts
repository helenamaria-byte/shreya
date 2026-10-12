import fs from "node:fs";
import path from "node:path";

/** Minimal .env.local loader for scripts (Next.js loads it itself for the app). */
export function loadEnv(file = ".env.local") {
  const p = path.resolve(process.cwd(), file);
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && m[2] !== "" && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
}
