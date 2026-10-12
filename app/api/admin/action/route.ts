import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/auth";
import { sql } from "@/lib/db";
import { approveIssue, approveStory, editCommentary, IssueError, rejectStory, swapStory } from "@/lib/issues";
import { runDraft, runDryRunEmail, runIngest, runReminder, runReport, runSend, type JobResult } from "@/lib/jobs";
import { importSubscribersCsv } from "@/lib/subscribers";
import { learnVoice } from "@/lib/voice";
import { now } from "@/lib/time";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Every dashboard write goes through here and needs the admin session (safety invariant 7).
 * Simulated time is accepted only on this authenticated route (and in tests).
 */
export async function POST(req: Request) {
  const wantsJson = (req.headers.get("accept") || "").includes("application/json");
  if (!isAdminRequest(req)) {
    return wantsJson ? NextResponse.json({ ok: false, error: "admin login required" }, { status: 401 })
      : NextResponse.redirect(new URL("/?login=required", req.url), 303);
  }
  const form = await req.formData();
  const action = String(form.get("action") ?? "");
  const simRaw = String(form.get("simulated_now") ?? "").trim();
  let at: Date, simulated = false;
  try {
    at = now(simRaw || null);
    simulated = !!simRaw;
  } catch {
    return reply(req, wantsJson, false, "Invalid simulated time", "run");
  }
  const common = { trigger: "manual" as const, at, simulated };

  try {
    let run: JobResult | undefined;
    let message = "";
    let anchor = "logs";
    switch (action) {
      case "run_ingest": run = await runIngest({ ...common, includeBrokenFeed: form.get("broken_feed") === "on" }); break;
      case "run_draft": run = await runDraft({ ...common, force: form.get("force") === "on", channel: "dashboard" }); break;
      case "run_reminder": run = await runReminder(common); break;
      case "run_send": run = await runSend({ ...common, channel: "dashboard" }); break;
      case "dry_run_email": run = await runDryRunEmail(common); break;
      case "run_report": run = await runReport(common); break;
      case "story_keep": {
        const r = await approveStory(Number(form.get("story_id")), "dashboard");
        message = r.already ? "Story was already approved." : `Story ${r.story.position} approved — ${r.health.approved} of ${r.health.count} stories approved.`;
        anchor = "draft"; break;
      }
      case "voice_learn": {
        const v = await learnVoice(String(form.get("samples") ?? ""));
        message = `Gemini learned the voice from your samples and saved it as v${v.version}. The next draft uses it.`;
        anchor = "voice"; break;
      }
      case "import_csv": {
        const file = form.get("csv");
        const text = file && typeof file !== "string" ? await file.text() : String(form.get("csv_text") ?? "");
        const r = await importSubscribersCsv(text);
        message = `Imported ${r.added} new subscriber(s) from ${r.rows} row(s); ${r.alreadyListed} already listed (left unchanged), ${r.invalid} invalid${r.invalidExamples.length ? ` (e.g. ${r.invalidExamples.join(", ")})` : ""}.`;
        anchor = "subscribers"; break;
      }
      case "story_edit": {
        const r = await editCommentary(Number(form.get("story_id")), String(form.get("commentary") ?? ""), "dashboard");
        message = `Story ${r.story.position} updated.${r.revoked ? " Approval was revoked — re-approve required." : ""}`;
        anchor = "draft"; break;
      }
      case "story_swap": {
        const r = await swapStory(Number(form.get("story_id")), "dashboard");
        message = `Swapped in “${r.newStory.title}” (${r.via}).${r.revoked ? " Approval was revoked — re-approve required." : ""}`;
        anchor = "draft"; break;
      }
      case "story_reject": {
        const r = await rejectStory(Number(form.get("story_id")), "dashboard");
        message = `Story removed.${r.replacement ? ` “${r.replacement.title}” came in from the reserves to keep 8 stories.` : ""} ${r.health.count} stories, ${r.health.topics.length} topics${r.health.warnings.length ? ` — ${r.health.warnings.join("; ")}; swap a story in before confirming` : ""}.${r.revoked ? " Approval was revoked." : ""}`;
        anchor = "draft"; break;
      }
      case "approve": {
        if (form.get("confirm") !== "on") { message = "Tick the confirmation box to approve."; anchor = "draft"; break; }
        const r = await approveIssue(Number(form.get("issue_id")), "dashboard", at);
        message = r.message + (r.warnings.length ? ` Warnings: ${r.warnings.join("; ")}.` : "");
        anchor = "approval"; break;
      }
      case "voice_save": {
        const content = String(form.get("content") ?? "").trim();
        if (content.length < 50) { message = "The voice guide looks too short; not saved."; anchor = "voice"; break; }
        const v = await sql`INSERT INTO voice_guide (content, version, is_assumption, source)
                            VALUES (${content}, (SELECT COALESCE(MAX(version), 0) + 1 FROM voice_guide),
                                    (SELECT is_assumption FROM voice_guide ORDER BY version DESC LIMIT 1), 'edited') RETURNING version`;
        message = `Voice guide saved as v${v[0].version}. The next draft uses it.`;
        anchor = "voice"; break;
      }
      default:
        return reply(req, wantsJson, false, `Unknown action ${action}`, "run");
    }
    if (run) message = `${run.status === "failed" ? "Failed" : run.status === "skipped" ? "Skipped" : "Done"}: ${run.summary.replace(/^(Skipped|Failed): /, "")}${simulated ? ` (simulated ${simRaw} IST)` : ""}`;
    return reply(req, wantsJson, run?.status !== "failed", message, anchor, run);
  } catch (e: any) {
    const msg = e instanceof IssueError || /^Paste at least/.test(e?.message) ? e.message : `Error: ${String(e?.message || e).slice(0, 200)}`;
    return reply(req, wantsJson, false, msg, "run");
  }
}

function reply(req: Request, json: boolean, ok: boolean, message: string, anchor: string, run?: JobResult) {
  if (json) return NextResponse.json({ ok, message, run }, { status: ok ? 200 : 400 });
  const url = new URL("/", req.url);
  url.searchParams.set("msg", message.slice(0, 400));
  if (!ok) url.searchParams.set("err", "1");
  if (run) url.searchParams.set("run", String(run.runId));
  const page = ({ draft: "draft", approval: "draft", voice: "voice", subscribers: "subscribers" } as Record<string, string>)[anchor];
  if (page) url.searchParams.set("p", page);
  return NextResponse.redirect(url, 303);
}
