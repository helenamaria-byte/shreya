import { loadEnv } from "./load-env";
loadEnv();

/** Usage: tsx scripts/run-job.ts <ingest|draft|reminder|send|report|dry_run> [--at=YYYY-MM-DDTHH:mm (IST)] [--force] [--broken-feed] */
async function main() {
  const [job, ...flags] = process.argv.slice(2);
  const atFlag = flags.find((f) => f.startsWith("--at="))?.slice(5);
  const { parseIstInput } = await import("../lib/time");
  const jobs = await import("../lib/jobs");
  const at = atFlag ? parseIstInput(atFlag) : undefined;
  const common = { trigger: "manual" as const, at, simulated: !!atFlag };
  const fn: Record<string, () => Promise<unknown>> = {
    ingest: () => jobs.runIngest({ ...common, includeBrokenFeed: flags.includes("--broken-feed") }),
    draft: () => jobs.runDraft({ ...common, force: flags.includes("--force"), draftAnyway: flags.includes("--anyway") }),
    reminder: () => jobs.runReminder(common),
    send: () => jobs.runSend(common),
    dry_run: () => jobs.runDryRunEmail(common),
    report: () => jobs.runReport(common),
  };
  if (!fn[job]) throw new Error(`unknown job ${job}`);
  console.log(JSON.stringify(await fn[job](), null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
