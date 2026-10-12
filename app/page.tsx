import { cookies } from "next/headers";
import { ADMIN_COOKIE, validAdminSession } from "@/lib/auth";
import { loadDashboard, maskEmail, type Dot } from "@/lib/dashboard";
import { renderEmail } from "@/lib/email";
import { formatIst, SCHEDULE } from "@/lib/time";
import { TOPICS } from "@/lib/topics";

export const dynamic = "force-dynamic";

type SP = { msg?: string; err?: string; open?: string; atopic?: string; astatus?: string; login?: string; run?: string };

export default async function Dashboard({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const admin = validAdminSession((await cookies()).get(ADMIN_COOKIE)?.value);
  const d = await loadDashboard({ articleTopic: sp.atopic, articleStatus: sp.astatus });
  const o = d.overview;
  const open = (id: string) => sp.open === id || (id === "articles" && !!(sp.atopic || sp.astatus));
  const latestVoice = d.voices[0];
  const lastRun = d.runs[0];
  const emailPreview = d.issue && d.stories.length ? renderEmail(d.issue, d.stories, { unsubscribeUrl: "#preview", date: new Date() }) : null;

  return (
    <main className="wrap">
      <header className="header">
        <div className="brand">The Dispatch<small>Weekly Indian startup &amp; tech newsletter · {d.week} · times in IST</small></div>
        <RunMenu admin={admin} login={sp.login} />
      </header>

      {sp.msg && <div className={`flash${sp.err ? " err" : ""}`}>{sp.msg}{sp.run && <> · <a href={`/?open=logs#run-${sp.run}`}>see run log</a></>}</div>}
      {sp.login === "failed" && <div className="flash err">Wrong admin password.</div>}
      {sp.login === "required" && <div className="flash err">Log in from “Run manually” to make changes.</div>}

      {/* ---------------- Overview (always visible) ---------------- */}
      <section className="overview" aria-label="Overview">
        <div className="headline"><span className={`dot ${o.steps[o.current].dot}`} />{o.headline}</div>
        <ol className="stepper">
          {o.steps.map((s, i) => (
            <li key={s.label} className={i === o.current ? "current" : ""}>
              <span className={`dot ${s.dot}`} />
              <div className="label">{s.label}</div>
              <div className="when">{s.when}</div>
              <div className="state status">{s.state}</div>
            </li>
          ))}
        </ol>
        <div className="next">
          <div><b>What to do next</b>{o.next}</div>
          {o.button && <a className="btn primary" href={o.button.href} target="_blank" rel="noreferrer">{o.button.label}</a>}
        </div>
        <div className="cards">
          <Card num={d.counts.total} lbl="articles collected this week" />
          <Card num={d.stories.length} lbl="stories in draft" />
          <Card num={<Status dot={o.steps[2].dot} text={approvalWord(d.issue?.status)} />} lbl="approval status" />
          <Card num={d.subCounts.active} lbl="active subscribers" />
        </div>
      </section>

      {/* ---------------- News Articles ---------------- */}
      <Section id="articles" title="News Articles" open={open("articles")}
        summary={`${d.counts.total} collected · ${d.counts.candidates} candidates · ${d.counts.duplicates} duplicates · ${d.counts.covered} covered before · ${d.failedFeeds} feed${d.failedFeeds === 1 ? "" : "s"} failed`}>
        <div className="chips" aria-label="Filter by status">
          <Chip href={filterHref(sp, { astatus: undefined })} on={!sp.astatus}>All statuses</Chip>
          {[["candidate", "Candidate"], ["duplicate", "Duplicate"], ["covered", "Covered before"], ["off_topic", "Off-topic"]].map(([k, l]) => (
            <Chip key={k} href={filterHref(sp, { astatus: k })} on={sp.astatus === k}>{l}</Chip>
          ))}
        </div>
        <div className="chips" aria-label="Filter by topic">
          <Chip href={filterHref(sp, { atopic: undefined })} on={!sp.atopic}>All topics</Chip>
          {TOPICS.map((t) => {
            const n = d.topicCounts.find((x) => x.topic === t)?.n ?? 0;
            return <Chip key={t} href={filterHref(sp, { atopic: t })} on={sp.atopic === t}>{t} ({n})</Chip>;
          })}
        </div>
        <div className="rows">
          <div className="head g-articles"><span>Title</span><span>Source</span><span>Topic</span><span>Published</span><span>Status</span></div>
          {d.articles.map((a) => {
            const st = articleStatus(a);
            return (
              <details className="row" key={a.id}>
                <summary className="g-articles">
                  <span className="cell-title">{a.title}</span>
                  <span className="muted small cell-title">{a.source_name}</span>
                  <span><span className="tag">{a.topic ?? "untagged"}</span></span>
                  <span className="muted small">{a.published_at ? formatIst(a.published_at, { weekday: undefined, hour: undefined, minute: undefined }) : "—"}</span>
                  <Status dot={st.dot} text={st.label} />
                </summary>
                <div className="detail">
                  {a.summary && <p>{a.summary}</p>}
                  <dl className="kv">
                    <dt>Link</dt><dd><a href={a.url} target="_blank" rel="noreferrer">{a.url}</a></dd>
                    <dt>Why this status</dt><dd>{st.why}</dd>
                    <dt>Topic</dt><dd>{a.topic ?? "—"} {a.topic_method && <span className="muted">({a.topic_method}{a.topic_confidence != null ? `, ${Math.round(a.topic_confidence * 100)}%` : ""})</span>}</dd>
                    <dt>Fetched</dt><dd>{formatIst(a.fetched_at)}</dd>
                  </dl>
                </div>
              </details>
            );
          })}
          {!d.articles.length && <div className="detail muted">No articles match these filters yet.</div>}
        </div>
        {d.filteredTotal > d.articles.length && <p className="muted small">Showing the {d.articles.length} most recent of {d.filteredTotal}.</p>}
        <details className="nested">
          <summary>Source health · {d.sources.filter((s) => s.active && s.last_status === "ok").length} ok · {d.failedFeeds} failed · {d.sources.filter((s) => s.active).length} active sources</summary>
          <div className="inner">
            <div className="rows">
              <div className="head g-sources"><span>Source</span><span>Type</span><span>Items</span><span>Last result</span></div>
              {d.sources.map((s) => (
                <details className="row" key={s.name}>
                  <summary className="g-sources">
                    <span className="cell-title">{s.name}{!s.active && <> <span className="tag">inactive</span></>}</span>
                    <span className="muted small">{s.type}</span>
                    <span className="small">{s.last_count ?? "—"}</span>
                    <Status dot={s.last_status === "ok" ? "green" : s.last_status === "failed" ? "red" : "grey"} text={s.last_status === "failed" ? `Failed: ${s.last_error}` : s.last_status === "ok" ? `OK · ${formatIst(s.last_fetched_at)}` : "Not fetched"} />
                  </summary>
                  <div className="detail"><dl className="kv">
                    <dt>{s.type === "gnews" ? "Query" : "Feed URL"}</dt><dd className="mono">{s.url_or_query}</dd>
                    <dt>Last fetched</dt><dd>{formatIst(s.last_fetched_at)}</dd>
                    <dt>Last error</dt><dd>{s.last_error ?? "—"}</dd>
                  </dl></div>
                </details>
              ))}
            </div>
          </div>
        </details>
      </Section>

      {/* ---------------- Newsletter Draft ---------------- */}
      <Section id="draft" title="Newsletter Draft" open={open("draft")}
        summary={d.stories.length ? `${d.health.count} stories · ${d.health.topics.length} topics · ${d.health.needsReview} need${d.health.needsReview === 1 ? "s" : ""} review` : "No draft yet — selection runs Wednesday 3 PM"}>
        {d.stories.length ? (
          <>
            {d.health.warnings.length > 0 && <div className="note">⚠️ {d.health.warnings.join(" · ")}</div>}
            <div className="rows">
              <div className="head g-draft"><span>#</span><span>Headline</span><span>Source</span><span>Topic</span></div>
              {d.stories.map((s) => (
                <details className="row" key={s.id}>
                  <summary className="g-draft">
                    <span className="muted">{s.position}</span>
                    <span className="cell-title">{s.title}{s.needs_review && <> <span className="tag warn">needs review</span></>}</span>
                    <span className="muted small cell-title">{s.source_name}</span>
                    <span><span className="tag">{s.topic}</span></span>
                  </summary>
                  <div className="detail">
                    <p className="commentary">{s.commentary}</p>
                    <dl className="kv">
                      <dt>Why Gemini picked it</dt><dd>{s.gemini_rationale ?? "—"}</dd>
                      {s.connects_with && <><dt>Connects with</dt><dd>{s.connects_with}</dd></>}
                      {s.needs_review && <><dt>Needs review</dt><dd>{s.review_notes}</dd></>}
                      {s.edited_at && <><dt>Edited</dt><dd>{formatIst(s.edited_at)} (original: “{s.original_commentary}”)</dd></>}
                      <dt>Link</dt><dd><a href={s.url} target="_blank" rel="noreferrer">{s.url}</a></dd>
                    </dl>
                    {admin ? (
                      <div className="actions">
                        <details className="nested" style={{ width: "100%" }}>
                          <summary>Edit commentary</summary>
                          <form className="inner edit-form" method="post" action="/api/admin/action">
                            <input type="hidden" name="action" value="story_edit" /><input type="hidden" name="story_id" value={s.id} />
                            <textarea name="commentary" defaultValue={s.commentary ?? ""} />
                            <button className="btn" type="submit">Save commentary</button>
                          </form>
                        </details>
                        <form method="post" action="/api/admin/action"><input type="hidden" name="action" value="story_swap" /><input type="hidden" name="story_id" value={s.id} /><button className="btn" type="submit">🔄 Swap</button></form>
                        <form method="post" action="/api/admin/action"><input type="hidden" name="action" value="story_reject" /><input type="hidden" name="story_id" value={s.id} /><button className="btn danger" type="submit">❌ Reject</button></form>
                      </div>
                    ) : <p className="muted small">Edit / Swap / Reject are available in Telegram, or here after logging in via “Run manually”.</p>}
                  </div>
                </details>
              ))}
            </div>
            <details className="nested">
              <summary>Reserves ({d.reserves.length}) and removed stories ({d.removed.length})</summary>
              <div className="inner">
                {d.reserves.map((r) => <p key={r.id} className="small"><span className="tag">reserve {r.reserve_rank}</span> {r.title} <span className="muted">· {r.topic}</span></p>)}
                {d.removed.map((r) => <p key={r.id} className="small"><span className="tag">{r.state.replace("_", " ")}</span> {r.title} <span className="muted">· {r.topic}</span></p>)}
                {!d.reserves.length && !d.removed.length && <p className="muted small">None.</p>}
              </div>
            </details>
            {admin && ["pending_approval", "skipped"].includes(d.issue!.status) && (
              <form className="actions" method="post" action="/api/admin/action">
                <input type="hidden" name="action" value="approve" /><input type="hidden" name="issue_id" value={d.issue!.id} />
                <label className="small check"><input type="checkbox" name="confirm" /> Approve issue #{d.issue!.issue_number} with {d.health.count} stories from the dashboard</label>
                <button className="btn" type="submit">Approve draft</button>
              </form>
            )}
            {emailPreview && (
              <details className="nested">
                <summary>Preview email</summary>
                <div className="inner">
                  <p className="small muted">Subject: {emailPreview.subject}</p>
                  <iframe className="preview" title="Email preview" srcDoc={emailPreview.html} sandbox="" />
                </div>
              </details>
            )}
          </>
        ) : <p className="muted">The draft will appear here after selection on Wednesday at 3 PM IST ({SCHEDULE.draft.cron} UTC).</p>}
      </Section>

      {/* ---------------- Editorial Voice ---------------- */}
      <Section id="voice" title="Editorial Voice" open={open("voice")}
        summary={latestVoice ? `Assumed voice guide · v${latestVoice.version} · edited ${formatIst(latestVoice.updated_at, { weekday: undefined, hour: undefined, minute: undefined })}` : "No voice guide yet"}>
        {latestVoice && (
          <>
            <div className="note">ASSUMPTION — no real writing samples of Shreya were provided. The latest version is loaded from Neon into every Gemini prompt.</div>
            <div className="guide"><Markdown text={latestVoice.content} /></div>
            {admin && (
              <details className="nested">
                <summary>Edit</summary>
                <form className="inner edit-form" method="post" action="/api/admin/action">
                  <input type="hidden" name="action" value="voice_save" />
                  <textarea name="content" defaultValue={latestVoice.content} style={{ minHeight: 360 }} className="mono" />
                  <button className="btn" type="submit">Save as v{latestVoice.version + 1}</button>
                </form>
              </details>
            )}
            <details className="nested">
              <summary>Version history ({d.voices.length})</summary>
              <div className="inner">
                {d.voices.map((v) => (
                  <details className="nested" key={v.id}>
                    <summary>v{v.version} · {formatIst(v.updated_at)}</summary>
                    <div className="inner"><pre className="json">{v.content}</pre></div>
                  </details>
                ))}
              </div>
            </details>
          </>
        )}
      </Section>

      {/* ---------------- Approval Status ---------------- */}
      <Section id="approval" title="Approval Status" open={open("approval")} summary={approvalSummary(d)}>
        {d.events.length ? (
          <div className="rows">
            <div className="head g-timeline"><span>When</span><span>Event</span><span>Channel</span></div>
            {d.events.map((e) => (
              <details className="row" key={e.id}>
                <summary className="g-timeline">
                  <span className="muted small">{formatIst(e.created_at)}</span>
                  <Status dot={eventDot(e.event)} text={eventLabel(e.event)} />
                  <span className="muted small">{e.channel}</span>
                </summary>
                <div className="detail"><dl className="kv">
                  <dt>Time</dt><dd>{formatIst(e.created_at, { second: "2-digit" })} IST</dd>
                  <dt>Channel</dt><dd>{e.channel}</dd>
                  <dt>Details</dt><dd>{e.detail ?? "—"}</dd>
                </dl></div>
              </details>
            ))}
          </div>
        ) : <p className="muted">Nothing has happened for this week's issue yet.</p>}
        <details className="nested">
          <summary>Last four sent issues (used for the repeat check)</summary>
          <div className="inner">
            {d.pastIssues.map((p) => <p key={p.issue_number} className="small">#{p.issue_number} · {p.week_key} · sent {formatIst(p.sent_at)} {p.is_sample && <span className="tag sample">SAMPLE — assignment data</span>}</p>)}
          </div>
        </details>
      </Section>

      {/* ---------------- Subscribers ---------------- */}
      <Section id="subscribers" title="Subscribers" open={open("subscribers")}
        summary={`${d.subCounts.active} active · ${d.subCounts.unsubscribed} unsubscribed · ${d.subCounts.bounced} bounced · ${d.subCounts.complained} complained (sample data)`}>
        <div className="note">Sample list for the assignment. The real list (2,200 subscribers) would be imported via CSV. In test mode only rows marked “test” receive email.</div>
        <div className="rows">
          <div className="head g-subs"><span>Email</span><span>Status</span><span>Flags</span></div>
          {d.subscribers.map((s) => (
            <details className="row" key={s.id}>
              <summary className="g-subs">
                <span className="cell-title">{admin ? s.email : maskEmail(s.email)}</span>
                <Status dot={subDot(s.status)} text={cap(s.status)} />
                <span>{s.is_test_recipient && <span className="tag test">test</span>} {s.is_sample && <span className="tag sample">sample</span>}</span>
              </summary>
              <div className="detail">
                <dl className="kv">
                  <dt>Name</dt><dd>{s.name ?? "—"}</dd>
                  <dt>Status reason</dt><dd>{s.status_reason ?? "—"}</dd>
                  {s.unsubscribed_at && <><dt>Unsubscribed</dt><dd>{formatIst(s.unsubscribed_at)}</dd></>}
                </dl>
                <div className="small">
                  <b>History</b>
                  {(s.history ?? []).map((h: any, i: number) => <div key={i} className="muted">{formatIst(h.at)} — {h.status}{h.reason ? `: ${h.reason}` : ""}</div>)}
                  {!s.history && <div className="muted">No status changes.</div>}
                  {(s.deliveries ?? []).map((x: any, i: number) => <div key={`d${i}`} className="muted">{formatIst(x.at)} — issue #{x.issue}: {x.status} ({x.mode})</div>)}
                </div>
              </div>
            </details>
          ))}
        </div>
      </Section>

      {/* ---------------- Workflow Logs ---------------- */}
      <Section id="logs" title="Workflow Logs" open={open("logs")}
        summary={lastRun ? `Last run: ${cap(lastRun.job.replace(/_/g, " "))} ${lastRun.status === "failed" ? "✗" : lastRun.status === "skipped" ? "–" : "✓"} ${ago(lastRun.started_at, d.at)} · ${d.failuresThisWeek} failure${d.failuresThisWeek === 1 ? "" : "s"} this week` : "No runs yet"}>
        <div className="rows">
          <div className="head g-runs"><span>Job</span><span>Time</span><span>Trigger</span><span>Result</span></div>
          {d.runs.map((r) => (
            <details className="row" key={r.id} id={`run-${r.id}`} open={sp.run === String(r.id)}>
              <summary className="g-runs">
                <Status dot={r.status === "failed" ? "red" : r.status === "skipped" ? "grey" : r.status ? "green" : "blue"} text={cap(r.job.replace(/_/g, " "))} />
                <span className="muted small">{formatIst(r.started_at)}</span>
                <span className="muted small">{r.trigger}{r.simulated_now ? " · sim" : ""}</span>
                <span className="small cell-title">{r.summary ?? "Running…"}</span>
              </summary>
              <div className="detail">
                <dl className="kv">
                  <dt>Result</dt><dd>{r.status ?? "running"} — {r.summary}</dd>
                  <dt>Started / finished</dt><dd>{formatIst(r.started_at, { second: "2-digit" })} → {formatIst(r.finished_at, { second: "2-digit" })}</dd>
                  {r.simulated_now && <><dt>Simulated time</dt><dd>{formatIst(r.simulated_now)} IST</dd></>}
                </dl>
                {r.details && <pre className="json">{JSON.stringify(r.details, null, 2)}</pre>}
              </div>
            </details>
          ))}
        </div>
      </Section>

      {/* ---------------- How it works ---------------- */}
      <Section id="how" title="How it works" open={open("how")} summary="Components map and weekly flowchart">
        <p className="small muted">Cron (UTC → IST): ingest <span className="mono">{SCHEDULE.ingest.cron}</span> = {SCHEDULE.ingest.when} · draft <span className="mono">{SCHEDULE.draft.cron}</span> = {SCHEDULE.draft.when} · reminder <span className="mono">{SCHEDULE.reminder.cron}</span> = {SCHEDULE.reminder.when} · send <span className="mono">{SCHEDULE.send.cron}</span> = {SCHEDULE.send.when}.</p>
        <h3 className="small">Components map</h3>
        <img className="diagram" src="/diagrams/components-map.svg" alt="Components map: GitHub, Vercel, Cron, RSS/GNews, Neon, Gemini Flash, Telegram, Resend, subscribers, dashboard" />
        <h3 className="small">Weekly flowchart</h3>
        <img className="diagram" src="/diagrams/workflow-flowchart.svg" alt="Weekly workflow flowchart with decision points" />
      </Section>

      <p className="footer">The Dispatch · assignment prototype · AI by Gemini Flash · <a href="/api/health">health</a></p>
    </main>
  );
}

// ---------------------------------------------------------------------------
function RunMenu({ admin, login }: { admin: boolean; login?: string }) {
  return (
    <details className="menu" open={login === "failed" || login === "required" ? true : undefined}>
      <summary>Run manually ▾</summary>
      <div className="menu-panel">
        {!admin ? (
          <form method="post" action="/api/admin/login">
            <label>Admin password<input type="password" name="password" autoComplete="current-password" required /></label>
            <button className="btn" type="submit">Log in</button>
            <p className="small muted">Everything on this page is read-only without the password.</p>
          </form>
        ) : (
          <>
            <form method="post" action="/api/admin/action">
              <label>Simulate time (IST, optional)<input type="datetime-local" name="simulated_now" /></label>
              <p className="small muted">With a simulated time, each job checks the IST schedule as if it were that moment. Simulated runs can never send live email.</p>
              <hr />
              <div className="group">
                <button className="btn" name="action" value="run_ingest">Run ingestion now</button>
                <label className="check small"><input type="checkbox" name="broken_feed" /> include a deliberately broken test feed</label>
                <button className="btn" name="action" value="run_draft">Run selection + send draft to Telegram</button>
                <label className="check small"><input type="checkbox" name="force" /> regenerate even if a draft exists</label>
                <button className="btn" name="action" value="run_reminder">Run reminder check</button>
                <button className="btn" name="action" value="run_send">Run send check</button>
                <button className="btn" name="action" value="dry_run_email">Send dry-run email</button>
              </div>
            </form>
            <hr />
            <form method="post" action="/api/admin/logout"><button className="btn link" type="submit">Log out</button></form>
          </>
        )}
      </div>
    </details>
  );
}

function Section({ id, title, summary, open, children }: { id: string; title: string; summary: string; open?: boolean; children: React.ReactNode }) {
  return (
    <details className="section" id={id} open={open || undefined}>
      <summary><h2>{title}</h2><span className="sum">{summary}</span></summary>
      <div className="section-body">{children}</div>
    </details>
  );
}

const Card = ({ num, lbl }: { num: React.ReactNode; lbl: string }) => <div className="card"><div className="num">{num}</div><div className="lbl">{lbl}</div></div>;
const Status = ({ dot, text }: { dot: Dot; text: string }) => <span className="status small"><span className={`dot ${dot}`} />{text}</span>;
const Chip = ({ href, on, children }: { href: string; on: boolean; children: React.ReactNode }) => <a className={`chip${on ? " on" : ""}`} href={href}>{children}</a>;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function filterHref(sp: SP, change: Partial<SP>) {
  const p = new URLSearchParams();
  const next = { atopic: sp.atopic, astatus: sp.astatus, ...change };
  if (next.atopic) p.set("atopic", next.atopic);
  if (next.astatus) p.set("astatus", next.astatus);
  p.set("open", "articles");
  return `/?${p.toString()}#articles`;
}

function articleStatus(a: any): { label: string; dot: Dot; why: string } {
  if (a.draft_state === "selected") return { label: "In draft", dot: "green", why: "Selected by Gemini for this week's draft." };
  if (a.duplicate_reason === "covered_in_past_issue")
    return { label: "Covered before", dot: "grey", why: `Matches “${a.duplicate_title}”${a.duplicate_issue ? ` from issue #${a.duplicate_issue}` : ""}${a.duplicate_is_sample ? " (sample data)" : ""} — ${a.duplicate_score >= 0.999 ? "same link" : `title similarity ${Number(a.duplicate_score).toFixed(2)}`}. Excluded from candidates.` };
  if (a.duplicate_reason === "same_url") return { label: "Duplicate", dot: "grey", why: `Same link (after removing tracking parameters) as “${a.duplicate_title}”.` };
  if (a.duplicate_reason === "similar_title") return { label: "Duplicate", dot: "grey", why: `Headline is ${Math.round(a.duplicate_score * 100)}% similar (trigram) to “${a.duplicate_title}”, collected earlier.` };
  if (!a.topic) return { label: "Untagged", dot: "grey", why: "Not yet tagged with a topic." };
  if (a.topic === "Other") return { label: "Off-topic", dot: "grey", why: "Tagged “Other” (not Indian startup/tech news), so it isn't a candidate." };
  if (a.draft_state === "reserve") return { label: "Reserve", dot: "blue", why: "Ranked backup for Swap." };
  return { label: "Candidate", dot: "blue", why: "Unique this week and on-topic; eligible for selection." };
}

function approvalWord(status?: string) {
  return ({ pending_approval: "Pending", approved: "Approved", sent: "Sent", skipped: "Skipped", rejected: "Rejected", sending: "Sending", insufficient_stories: "No draft", drafting: "Drafting" } as Record<string, string>)[status ?? ""] ?? "No draft";
}

function approvalSummary(d: Awaited<ReturnType<typeof loadDashboard>>) {
  const i = d.issue;
  if (!i) return "No issue yet this week";
  switch (i.status) {
    case "pending_approval": return i.reminder_sent_at ? `Pending · reminder sent ${formatIst(i.reminder_sent_at)}` : "Pending · reminder due Wed 10 PM";
    case "approved": return `Approved ${formatIst(i.approved_at)} via ${i.approved_via} · sends Thu 8 AM`;
    case "sent": return `Sent ${formatIst(i.sent_at)}`;
    case "skipped": return "Skipped · not approved by Thursday 8 AM";
    case "rejected": return "Draft rejected";
    default: return `${cap(i.status.replace(/_/g, " "))} · draft due Wed 3 PM`;
  }
}

function eventLabel(e: string) {
  return ({ draft_created: "Draft created", draft_sent: "Draft sent to Telegram", edited: "Commentary edited", swapped: "Story swapped", story_rejected: "Story rejected",
    story_added: "Story added", reminder_sent: "Reminder sent", approved: "Approved", approval_revoked: "Approval revoked by an edit", rejected: "Draft rejected",
    sent: "Newsletter sent", send_failed: "Send failed", skipped: "Skipped (not approved)", insufficient_stories: "Not enough stories" } as Record<string, string>)[e] ?? e;
}
function eventDot(e: string): Dot {
  if (["approved", "sent", "draft_sent", "draft_created"].includes(e)) return "green";
  if (["skipped", "rejected", "send_failed"].includes(e)) return "red";
  if (["approval_revoked", "reminder_sent", "insufficient_stories"].includes(e)) return "amber";
  return "blue";
}
const subDot = (s: string): Dot => (s === "active" ? "green" : s === "unsubscribed" ? "grey" : "red");

function ago(t: string, at: Date) {
  const m = Math.round((at.getTime() - new Date(t).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
}

/** Tiny markdown renderer for the voice guide (headings, lists, quotes, bold/italic). */
function Markdown({ text }: { text: string }) {
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((part, i) =>
    part.startsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part.startsWith("*") && part.length > 2 ? <em key={i}>{part.slice(1, -1)}</em> : part);
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  const flush = () => { if (list.length) { blocks.push(<ul key={blocks.length}>{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>); list = []; } };
  for (const line of text.split(/\r?\n/)) {
    if (/^- /.test(line)) { list.push(line.slice(2)); continue; }
    flush();
    if (/^# /.test(line)) blocks.push(<h1 key={blocks.length}>{inline(line.slice(2))}</h1>);
    else if (/^## /.test(line)) blocks.push(<h2 key={blocks.length}>{inline(line.slice(3))}</h2>);
    else if (/^> /.test(line)) blocks.push(<blockquote key={blocks.length}>{inline(line.slice(2))}</blockquote>);
    else if (line.trim()) blocks.push(<p key={blocks.length}>{inline(line)}</p>);
  }
  flush();
  return <>{blocks}</>;
}
