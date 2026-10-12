import fs from "node:fs";
import { loadEnv } from "./load-env";
loadEnv();

/** Writes the latest successful Gemini draft run (and the latest cron ingest) to docs/sample-run/. */
async function main() {
  const { sql } = await import("../lib/db");
  const run = (await sql`SELECT id, started_at, finished_at, summary, details FROM workflow_runs WHERE job = 'draft' AND status = 'success' AND details ? 'selected' ORDER BY id DESC LIMIT 1`)[0];
  const ing = (await sql`SELECT id, started_at, summary, details FROM workflow_runs WHERE job = 'ingest' AND status = 'success' AND details ? 'perSource' ORDER BY id DESC LIMIT 1`)[0];
  fs.mkdirSync("docs/sample-run", { recursive: true });
  fs.writeFileSync("docs/sample-run/draft-run.json", JSON.stringify(run, null, 2));
  fs.writeFileSync("docs/sample-run/ingest-run.json", JSON.stringify(ing, null, 2));
  const d = run.details;
  const md = [
    `# Sample run — real Gemini selection + commentary (issue #${d.issue})`, "",
    `Workflow run #${run.id}, ${new Date(run.started_at).toISOString()} → ${new Date(run.finished_at).toISOString()} · model \`${process.env.GEMINI_MODEL}\` · voice guide v${d.voiceGuideVersion}`, "",
    `**Summary:** ${run.summary}`, "",
    `Candidates considered: ${d.candidates} · topics: ${d.topics.join(", ")} · Gemini calls: ${d.geminiCalls}`,
    `Validator: ${d.validation.map((v: any) => `attempt ${v.attempt}: ${v.errors.length ? v.errors.join("; ") : "valid"}`).join(" · ")} · repair: ${d.repairLog.length ? d.repairLog.join(", ") : "not needed"}`, "",
    "This is the raw Gemini output as stored before any human edits. The live Telegram check then edited, swapped and rejected stories (see `docs/evidence/telegram-live-test.txt`).", "",
    "## Selected stories", "",
    ...d.selected.flatMap((s: any) => [
      `### ${s.position}. ${s.title}`, `*${s.source} · ${s.topic}*${s.needs_review ? ` · ⚠️ **needs review:** ${s.notes}` : ""}`, "", s.commentary, "",
      `> **Why Gemini picked it:** ${s.rationale}${s.connects_with ? `  \n> **Connects with:** ${s.connects_with}` : ""}`, "",
    ]),
    "## Reserves", "", ...d.reserves.map((r: any) => `${r.rank}. ${r.title} (${r.topic})`), "",
    `## Ingestion run (workflow run #${ing.id})`, "", ing.summary, "",
    "| Source | Status | Fetched | New |", "|---|---|---|---|",
    ...ing.details.perSource.map((s: any) => `| ${s.name} | ${s.status}${s.error ? ` (${s.error})` : ""} | ${s.fetched} | ${s.inserted} |`),
  ].join("\n");
  fs.writeFileSync("docs/sample-run/README.md", md + "\n");
  console.log(`exported draft run #${run.id} (${d.selected.length} stories) and ingest run #${ing.id}`);
  console.log(d.selected.filter((s: any) => s.needs_review).map((s: any) => `needs_review: ${s.title} — ${s.notes}`).join("\n"));
}
main().catch((e) => { console.error(e); process.exit(1); });
