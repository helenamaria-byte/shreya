import Image from "next/image";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, validAdminSession } from "@/lib/auth";
import { fmtMinutes, loadDashboard, MANUAL_MINUTES, maskEmail, type Dot } from "@/lib/dashboard";
import { renderEmail } from "@/lib/email";
import { formatIst, SCHEDULE } from "@/lib/time";
import { tc, topicImage } from "@/lib/topic-art";
import { TOPICS } from "@/lib/topics";
import { Paper, type Tab } from "./paper";

export const dynamic = "force-dynamic";

type SP = { p?: string; msg?: string; err?: string; atopic?: string; astatus?: string; login?: string; run?: string };
type D = Awaited<ReturnType<typeof loadDashboard>>;

const PAGES = ["overview", "draft", "articles", "voice", "subscribers"] as const;

export default async function Dashboard({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const page = (PAGES as readonly string[]).includes(sp.p ?? "") ? sp.p! : "overview";
  const admin = validAdminSession((await cookies()).get(ADMIN_COOKIE)?.value);
  const d = await loadDashboard({ articleTopic: sp.atopic, articleStatus: sp.astatus });

  const tabs: Tab[] = [
    { id: "overview", label: "Overview" },
    { id: "draft", label: "Draft" },
    { id: "articles", label: "Articles" },
    { id: "voice", label: "Voice" },
    { id: "subscribers", label: "Subscribers" },
  ];
  const notice = (
    <>
      {sp.msg && <div className={`flash${sp.err ? " err" : ""}`}>{sp.msg}</div>}
      {sp.login === "failed" && <div className="flash err">Wrong admin password.</div>}
      {sp.login === "required" && <div className="flash err">Log in from “Run manually” to make changes.</div>}
    </>
  );

  return (
    <div className="stage">
      <article className="sheet">
        <div className="sheet-inner">
          <Masthead d={d} admin={admin} login={sp.login} />
          <Paper page={page} tabs={tabs} notice={notice}>
            {page === "overview" && <Overview d={d} />}
            {page === "draft" && <DraftPage d={d} admin={admin} />}
            {page === "articles" && <ArticlesPage d={d} sp={sp} />}
            {page === "voice" && <VoicePage d={d} admin={admin} />}
            {page === "subscribers" && <SubscribersPage d={d} admin={admin} />}
          </Paper>
        </div>
      </article>
      <p className="footer">Assignment prototype · sample data is labelled · AI by Gemini Flash · <a href="/api/health">health</a></p>
    </div>
  );
}

// ---------------------------------------------------------------------------
function Masthead({ d, admin, login }: { d: D; admin: boolean; login?: string }) {
  return (
    <header className="masthead">
      <span className="strap">Shreya's article on</span>
      <span className="dateline">{formatIst(d.at, { weekday: "long", day: "numeric", month: "long", hour: undefined, minute: undefined })}</span>
      <a className="title" href="/" data-page="overview">The Dispatch</a>
      <div className="right"><RunMenu admin={admin} login={login} /></div>
    </header>
  );
}

function Workflow({ d }: { d: D }) {
  return (
    <ol className="workflow" aria-label="This week's workflow">
      {d.overview.steps.map((s, i) => (
        <li key={s.label} className={i === d.overview.current ? "current" : ""}>
          <span className="name"><span className={`dot ${s.dot}`} />{s.label}</span>
          <span className="sub">{s.state}</span>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Page 1 — front page
// ---------------------------------------------------------------------------
// Collage layouts: tiles around the central "View this week's draft" card; sx/sy = where each flies when the page turns.
const T = (x: number, y: number, r: number) => ({ x: `${x}%`, y: `${y}%`, r: `${r}deg`, sx: `${50 + (x - 50) * 2.6}%`, sy: `${50 + (y - 50) * 2.6}%` });
const SPOTS_6 = [T(17, 23, -5), T(50, 18, 2), T(83, 23, 5), T(17, 77, 3), T(50, 82, -2), T(83, 77, -4)];
const SPOTS_8 = [T(14, 23, -5), T(38, 18, 2), T(62, 18, -2), T(86, 23, 5), T(14, 77, 3), T(38, 82, -2), T(62, 82, 2), T(86, 77, -4)];
const SPOTS_10 = [T(10, 24, -5), T(30, 18, 3), T(50, 15, -2), T(70, 18, 2), T(90, 24, 5), T(10, 76, 3), T(30, 82, -3), T(50, 85, 2), T(70, 82, -2), T(90, 76, -4)];

function Overview({ d }: { d: D }) {
  const o = d.overview;
  // One picture per story in the draft (8–10); before the draft exists, a few topic pictures.
  const shown = d.stories.length
    ? d.stories.slice(0, 10).map((s) => ({ key: String(s.id), topic: s.topic ?? "Other", cap: `${s.position}. ${s.topic ?? "Other"}` }))
    : TOPICS.filter((t) => t !== "Other").slice(0, 6).map((t) => ({ key: t, topic: t, cap: t }));
  const spots = shown.length <= 6 ? SPOTS_6 : shown.length <= 8 ? SPOTS_8 : SPOTS_10;
  const suppressed = d.subCounts.unsubscribed + d.subCounts.bounced + d.subCounts.complained;
  const hasDraft = d.stories.length > 0;
  return (
    <>
      <section className="front-head">
        <h1>{o.headline}</h1>
        <p className="next">{o.next}{o.telegram && <> <a href={`https://t.me/${process.env.TELEGRAM_BOT_USERNAME || ""}`} target="_blank" rel="noreferrer">Open Telegram ↗</a></>}</p>
        {o.stamp && <div className="stamp big" style={{ right: 0, top: 6 }}>{o.stamp[0]}<small>{o.stamp[1]}</small></div>}
      </section>

      <Workflow d={d} />

      <section className="cards" aria-label="This week in numbers">
        <Card tint="sage" href="/?p=articles" num={d.counts.total} lbl="Articles collected" sub={`from ${d.activeSources.length} sources`} />
        <Card tint="ochre" href="/?p=draft" num={hasDraft ? `${d.health.approved}/${d.health.count}` : "—"} lbl="Stories approved" sub={hasDraft ? `${d.health.topics.length} topics` : "draft due Wed 3 PM"} />
        <Card tint="rose" href="/?p=subscribers" num={suppressed} lbl="Unsubscribes & bounces" sub="all suppressed" />
        <Card tint="slate" href="/?p=draft" num={d.review ? fmtMinutes(d.review.minutes) : "—"} lbl={d.review?.done ? "Review time" : "In review"} sub={`vs ~${MANUAL_MINUTES / 60} h by hand`} />
      </section>

      <section className="edition" aria-label="This week's edition">
        <div className="collage">
          {shown.map((t, i) => {
            const s = spots[i];
            return (
              <figure className={`tile${shown.length > 8 ? " small" : ""}`} key={t.key} style={{ ...tc(t.topic), "--x": s.x, "--y": s.y, "--r": s.r, "--sx": s.sx, "--sy": s.sy } as React.CSSProperties}>
                <div style={{ position: "relative", width: "100%", height: "100%" }}>
                  <Image src={topicImage(t.topic)} alt={`Illustration for ${t.topic}`} fill sizes="(max-width: 760px) 30vw, 220px" />
                </div>
                <figcaption className="cap">{t.cap}</figcaption>
              </figure>
            );
          })}
          <div className="collage-center">
            <span className="kicker">{d.issue ? `Issue #${d.issue.issue_number}` : "This week"}{hasDraft ? ` · ${d.health.count} stories` : ""}</span>
            <a className="btn primary" href="/?p=draft" data-page="draft" data-scatter>{hasDraft ? "View this week's draft →" : "Draft arrives Wednesday"}</a>
          </div>
        </div>
      </section>
    </>
  );
}

function Card({ href, num, lbl, sub, tint }: { href: string; num: React.ReactNode; lbl: string; sub: string; tint: string }) {
  const page = new URLSearchParams(href.split("?")[1]).get("p") ?? "overview";
  return (
    <a className={`card tint-${tint}`} href={href} data-page={page}>
      <span className="num">{num}</span>
      <span className="lbl">{lbl}</span>
      <span className="sub">{sub}</span>
    </a>
  );
}

// ---------------------------------------------------------------------------
// Page 2 — inside: the draft
// ---------------------------------------------------------------------------
function DraftPage({ d, admin }: { d: D; admin: boolean }) {
  const o = d.overview;
  const email = d.issue && d.stories.length ? renderEmail(d.issue, d.stories, { unsubscribeUrl: "#preview", date: new Date() }) : null;
  if (!d.stories.length) {
    return (
      <section className="page-head"><div><h1>No draft yet</h1>
        <p className="lede">Gemini selects this week's stories on Wednesday at 3 PM IST ({SCHEDULE.draft.cron} UTC) and sends the draft to Telegram.</p></div></section>
    );
  }
  return (
    <>
      <section className="page-head">
        <div>
          <h1>Issue #{d.issue!.issue_number}: {d.health.count} stories, {d.health.topics.length} topics</h1>
          <p className="lede">{d.health.approved} of {d.health.count} stories approved individually{d.health.needsReview ? ` · ${d.health.needsReview} need${d.health.needsReview === 1 ? "s" : ""} a fact check` : ""}. {o.next}</p>
          <div className="meter" aria-label={`${d.health.approved} of ${d.health.count} approved`}>{d.stories.map((s) => <i key={s.id} className={s.approved_at ? "on" : ""} />)}</div>
          {d.health.warnings.length > 0 && <p className="note" style={{ marginTop: 10 }}>⚠️ {d.health.warnings.join(" · ")}</p>}
        </div>
        {o.stamp && <div className="stamp" style={{ right: 4, top: 24 }}>{o.stamp[0]}<small>{o.stamp[1]}</small></div>}
      </section>

      <section className="draft-grid">
        {d.stories.map((s, i) => (
          <article key={s.id} className={`story${i === 0 ? " lead" : ""}`} style={{ ...tc(s.topic), "--i": i } as React.CSSProperties}>
            <div className="art">
              <Image src={topicImage(s.topic)} alt={`Illustration for ${s.topic}`} fill sizes={i === 0 ? "(max-width: 760px) 100vw, 560px" : "(max-width: 760px) 100vw, 360px"} />
              <span className="pos">{s.position}</span>
            </div>
            <span className="topic">{s.topic}</span>
            <h3><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a></h3>
            <span className="src">{s.source_name}</span>
            <p className="commentary">{s.commentary}</p>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {s.approved_at ? <span className="badge ok">✓ Approved</span> : <span className="badge wait">Awaiting approval</span>}
              {s.needs_review && <span className="badge warn" title={s.review_notes ?? ""}>Check facts</span>}
              {s.edited_at && <span className="badge ok">Edited by Shreya</span>}
            </div>
            <details className="why">
              <summary>Why Gemini picked it</summary>
              <p>{s.gemini_rationale}</p>
              {s.connects_with && <p><em>Connects with:</em> {s.connects_with}</p>}
              {s.needs_review && <p><em>Needs review:</em> {s.review_notes}</p>}
              {s.edited_at && s.original_commentary !== s.commentary && <p><em>Gemini's original:</em> “{s.original_commentary}”</p>}
            </details>
            {admin && (
              <div className="story-actions">
                {!s.approved_at && <form method="post" action="/api/admin/action"><input type="hidden" name="action" value="story_keep" /><input type="hidden" name="story_id" value={s.id} /><button className="btn ok" type="submit">✅ Keep</button></form>}
                <form method="post" action="/api/admin/action"><input type="hidden" name="action" value="story_swap" /><input type="hidden" name="story_id" value={s.id} /><button className="btn" type="submit">🔄 Swap</button></form>
                <form method="post" action="/api/admin/action"><input type="hidden" name="action" value="story_reject" /><input type="hidden" name="story_id" value={s.id} /><button className="btn danger" type="submit">❌ Reject</button></form>
                <details>
                  <summary className="btn">✏️ Edit</summary>
                  <form method="post" action="/api/admin/action">
                    <input type="hidden" name="action" value="story_edit" /><input type="hidden" name="story_id" value={s.id} />
                    <textarea name="commentary" defaultValue={s.commentary ?? ""} />
                    <button className="btn" type="submit">Save commentary</button>
                  </form>
                </details>
              </div>
            )}
          </article>
        ))}
      </section>

      <section className="below">
        {admin && ["pending_approval", "skipped"].includes(d.issue!.status) && (
          <form className="confirm-row" method="post" action="/api/admin/action">
            <input type="hidden" name="action" value="approve" /><input type="hidden" name="issue_id" value={d.issue!.id} />
            <label className="small"><input type="checkbox" name="confirm" /> Confirm the final draft of issue #{d.issue!.issue_number} ({d.health.count} stories)</label>
            <button className="btn" type="submit">Confirm final draft</button>
          </form>
        )}
        <details className="nested">
          <summary>Approval history ({d.events.length} events)</summary>
          <div className="inner"><Timeline d={d} /></div>
        </details>
        <details className="nested">
          <summary>Topic mix vs the last four issues</summary>
          <div className="inner">
            <div className="topic-mix">
              {d.topicMix.map((t) => (
                <div className="row" key={t.topic}>
                  <span>{t.topic}</span>
                  <span className="bar" title={`this week ${t.now}, average ${t.pastAvg.toFixed(1)}`}>
                    <span style={{ width: `${Math.min(100, t.now * 25)}%` }} /><em style={{ left: `${Math.min(100, t.pastAvg * 25)}%` }} />
                  </span>
                  <span>{t.now} <span className="muted">/ {t.pastAvg.toFixed(1)}</span></span>
                </div>
              ))}
            </div>
            <p className="small muted">Bar = stories this week · tick = average of the last four issues{d.pastIssues.some((p) => p.is_sample) ? " (sample past issues)" : ""}.</p>
          </div>
        </details>
        <details className="nested">
          <summary>Reserves ({d.reserves.length}) and removed stories ({d.removed.length})</summary>
          <div className="inner">
            {d.reserves.map((r) => <p key={r.id} className="small"><span className="tag">reserve {r.reserve_rank}</span> {r.title} <span className="ttag" style={tc(r.topic)}>{r.topic}</span></p>)}
            {d.removed.map((r) => <p key={r.id} className="small"><span className="tag">{r.state.replace("_", " ")}</span> {r.title} <span className="ttag" style={tc(r.topic)}>{r.topic}</span></p>)}
            {!d.reserves.length && !d.removed.length && <p className="muted small">None.</p>}
          </div>
        </details>
        {email && (
        <details className="nested">
          <summary>Preview the email</summary>
          <div className="inner">
            <p className="small muted">Subject: {email.subject} · HTML and plain-text versions · one-click unsubscribe header included</p>
            <iframe className="preview" title="Email preview" srcDoc={email.html} sandbox="" />
          </div>
        </details>
        )}
      </section>
    </>
  );
}

function Timeline({ d }: { d: D }) {
  if (!d.events.length) return <p className="muted small">Nothing has happened for this week's issue yet.</p>;
  const recent = d.events.slice(-8);
  const older = d.events.slice(0, -8);
  return (
    <>
      <EventRows events={recent} />
      {older.length > 0 && (
        <details className="nested"><summary>Earlier events ({older.length})</summary><div className="inner"><EventRows events={older} /></div></details>
      )}
    </>
  );
}

function EventRows({ events }: { events: D["events"] }) {
  return (
    <div className="rows">
      <div className="head g-timeline"><span>When</span><span>Event</span><span>Channel</span></div>
      {events.map((e) => (
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
  );
}

// ---------------------------------------------------------------------------
// Page 3 — articles
// ---------------------------------------------------------------------------
function ArticlesPage({ d, sp }: { d: D; sp: SP }) {
  return (
    <>
      <section className="page-head"><div>
        <h1>{d.counts.total} articles read for Shreya</h1>
        <p className="lede">{d.counts.candidates} usable · {d.counts.duplicates} duplicates · {d.counts.covered} already covered in the last four issues · {d.counts.off_topic} off-topic · {d.failedFeeds} feed{d.failedFeeds === 1 ? "" : "s"} failing. Click any row to see why it was kept or dropped.</p>
      </div></section>
      <div style={{ display: "grid", gap: 10 }}>
        <div className="chips" aria-label="Filter by status">
          <Chip href={filterHref(sp, { astatus: undefined })} on={!sp.astatus}>All</Chip>
          {[["candidate", "Candidate"], ["duplicate", "Duplicate"], ["covered", "Covered before"], ["off_topic", "Off-topic"]].map(([k, l]) => (
            <Chip key={k} href={filterHref(sp, { astatus: k })} on={sp.astatus === k}>{l}</Chip>
          ))}
        </div>
        <div className="chips" aria-label="Filter by topic">
          <Chip href={filterHref(sp, { atopic: undefined })} on={!sp.atopic}>All topics</Chip>
          {TOPICS.map((t) => <Chip key={t} topic={t} href={filterHref(sp, { atopic: t })} on={sp.atopic === t}>{t} ({d.topicCounts.find((x) => x.topic === t)?.n ?? 0})</Chip>)}
        </div>
      </div>
      <div className="rows" style={{ marginTop: 14 }}>
        <div className="head g-articles"><span>Headline</span><span>Source</span><span>Topic</span><span>Published</span><span>Status</span></div>
        {d.articles.map((a) => {
          const st = articleStatus(a);
          return (
            <details className="row" key={a.id}>
              <summary className="g-articles">
                <span className="cell-title">{a.title}</span>
                <span className="muted small cell-title">{a.source_name}</span>
                <span><span className="ttag" style={tc(a.topic)}>{a.topic ?? "untagged"}</span></span>
                <span className="muted small">{a.published_at ? formatIst(a.published_at, { weekday: undefined, hour: undefined, minute: undefined }) : "—"}</span>
                <Status dot={st.dot} text={st.label} />
              </summary>
              <div className="detail">
                {a.summary && <p>{a.summary}</p>}
                <dl className="kv">
                  <dt>Why this status</dt><dd>{st.why}</dd>
                  <dt>Link</dt><dd><a href={a.url} target="_blank" rel="noreferrer">{a.url}</a></dd>
                  <dt>Topic</dt><dd>{a.topic ?? "—"} {a.topic_method && <span className="muted">({a.topic_method}{a.topic_confidence != null ? `, ${Math.round(a.topic_confidence * 100)}%` : ""})</span>}</dd>
                  <dt>Fetched</dt><dd>{formatIst(a.fetched_at)}</dd>
                </dl>
              </div>
            </details>
          );
        })}
        {!d.articles.length && <div className="detail muted">No articles match these filters yet.</div>}
      </div>
      {d.filteredTotal > d.articles.length && <p className="muted small" style={{ marginTop: 8 }}>Showing the {d.articles.length} most recent of {d.filteredTotal}.</p>}
      <details className="nested" style={{ marginTop: 16 }}>
        <summary>Source health · {d.activeSources.filter((s) => s.last_status === "ok").length} ok · {d.failedFeeds} failed · {d.activeSources.length} sources (RSS, Google News, GNews)</summary>
        <div className="inner">
          <div className="rows">
            <div className="head g-sources"><span>Source</span><span>Type</span><span>Items</span><span>Last result</span></div>
            {d.sources.map((s) => (
              <details className="row" key={s.name}>
                <summary className="g-sources">
                  <span className="cell-title">{s.name}{!s.active && <> <span className="tag">test · inactive</span></>}</span>
                  <span className="muted small">{s.type}</span>
                  <span className="small">{s.last_count ?? "—"}</span>
                  <Status dot={s.last_status === "ok" ? "green" : s.last_status === "failed" ? "red" : "grey"} text={s.last_status === "failed" ? `Failed: ${s.last_error}` : s.last_status === "ok" ? `OK · ${formatIst(s.last_fetched_at)}` : "Not fetched"} />
                </summary>
                <div className="detail"><dl className="kv">
                  <dt>{s.type === "gnews" ? "Query" : "Feed URL"}</dt><dd className="mono">{s.url_or_query}</dd>
                  <dt>Last fetched</dt><dd>{formatIst(s.last_fetched_at)}</dd>
                  <dt>Last error</dt><dd>{s.last_error ?? "—"} {s.last_status === "failed" && <span className="muted">(one failing feed never stops the run)</span>}</dd>
                </dl></div>
              </details>
            ))}
          </div>
        </div>
      </details>
    </>
  );
}

// ---------------------------------------------------------------------------
// Page 4 — editorial voice
// ---------------------------------------------------------------------------
function VoicePage({ d, admin }: { d: D; admin: boolean }) {
  const v = d.voices[0];
  if (!v) return <p className="muted">No voice guide yet.</p>;
  return (
    <>
      <section className="page-head"><div>
        <div className="kicker">Version {v.version} · {sourceWord(v.source)}</div>
        <h1>How The Dispatch sounds</h1>
        <p className="lede">The latest version is loaded from Neon into every Gemini prompt: selection and commentary.
          {v.source === "learned" ? " This version was learned by Gemini from Shreya's own past writing." : v.is_assumption ? " This is an assumed voice — no samples of Shreya's writing were provided. Use “Learn my voice” to replace it with one documented from her real newsletters." : ""}</p>
      </div></section>
      <div className="guide"><Markdown text={v.content} /></div>
      <section className="columns">
        {admin ? (
          <>
            <div className="box">
              <h3>✨ Learn my voice</h3>
              <p className="small muted">Paste 2–3 past issues of the newsletter. Gemini Flash documents how Shreya writes and saves it as a new version.</p>
              <form method="post" action="/api/admin/action" style={{ display: "grid", gap: 8 }}>
                <input type="hidden" name="action" value="voice_learn" />
                <textarea name="samples" placeholder="Paste past newsletter text here…" style={{ minHeight: 180 }} />
                <button className="btn" type="submit">Learn my voice</button>
              </form>
            </div>
            <div className="box">
              <h3>✏️ Edit the guide</h3>
              <form method="post" action="/api/admin/action" style={{ display: "grid", gap: 8 }}>
                <input type="hidden" name="action" value="voice_save" />
                <textarea name="content" defaultValue={v.content} style={{ minHeight: 220 }} className="mono" />
                <button className="btn" type="submit">Save as v{v.version + 1}</button>
              </form>
            </div>
          </>
        ) : <p className="small muted">Log in via “Run manually” to edit the guide or learn it from Shreya's writing.</p>}
      </section>
      <details className="nested">
        <summary>Version history ({d.voices.length})</summary>
        <div className="inner">
          {d.voices.map((x) => (
            <details className="nested" key={x.id}>
              <summary>v{x.version} · {sourceWord(x.source)} · {formatIst(x.updated_at)}</summary>
              <div className="inner"><pre className="json">{x.content}</pre></div>
            </details>
          ))}
        </div>
      </details>
    </>
  );
}

// ---------------------------------------------------------------------------
// Page 5 — subscribers, unsubscribes, bounces, delivery
// ---------------------------------------------------------------------------
function SubscribersPage({ d, admin }: { d: D; admin: boolean }) {
  const del = d.delivery;
  return (
    <>
      <section className="page-head"><div>
        <h1>Subscribers, unsubscribes & bounces</h1>
        <p className="lede">Gmail's one-click unsubscribe works on every email (List-Unsubscribe + List-Unsubscribe-Post), plus a signed link in the footer. Hard bounces and spam complaints arrive through signed Resend webhooks; temporary bounces are counted and only suppress after 3 in a row. Suppressed addresses never receive another issue.</p>
      </div></section>
      <div className="stats">
        <div className="ink-green"><div className="num">{d.subCounts.active}</div><div className="lbl">Active</div></div>
        <div className="ink-grey"><div className="num">{d.subCounts.unsubscribed}</div><div className="lbl">Unsubscribed</div></div>
        <div className="ink-red"><div className="num">{d.subCounts.bounced}</div><div className="lbl">Bounced</div></div>
        <div className="ink-plum"><div className="num">{d.subCounts.complained}</div><div className="lbl">Spam complaints</div></div>
        <div className="ink-ochre"><div className="num">{d.softWatch}</div><div className="lbl">Soft-bounce watch</div></div>
      </div>
      <section className="columns">
        <div className="box">
          <h3>📊 Track delivery{del ? ` · ${del.issue.issue_number < 1 ? "live test send" : `issue #${del.issue.issue_number}`}` : ""}</h3>
          {del ? (
            <>
              <p className="small">{del.delivered} delivered · {del.pending} awaiting confirmation · {del.bounced} bounced · {del.complained} spam · {del.failed} failed · {del.unsubscribed} unsubscribed since sending</p>
              <p className="small muted">Sent {formatIst(del.issue.sent_at)}{del.issue.week_key.startsWith("TEST-SEND") ? " (live test send to the test addresses)" : ""}. The Thursday-evening report goes to Telegram automatically ({SCHEDULE.report.when}).</p>
            </>
          ) : <p className="small muted">Nothing sent yet. After Thursday's send this shows delivered, bounced, spam and unsubscribed counts.</p>}
        </div>
        <div className="box">
          <h3>Recent unsubscribes & bounces</h3>
          {d.suppressionEvents.length ? d.suppressionEvents.slice(0, 8).map((e, i) => (
            <p key={i} className="small"><Status dot="red" text={cap(e.status)} /> {admin ? e.email : maskEmail(e.email)} <span className="muted">· {formatIst(e.created_at)} · {e.reason}</span> {e.is_sample && <span className="tag sample">sample</span>}</p>
          )) : <p className="small muted">None yet.</p>}
        </div>
      </section>
      <p className="note">Mode: <b>{process.env.EMAIL_MODE ?? "test"}</b> — only addresses marked “test” receive email. Rows marked “sample” are fictional assignment data; the real list (2,200 subscribers) is imported via CSV below.</p>
      {admin && (
        <form className="box" method="post" action="/api/admin/action" encType="multipart/form-data" style={{ marginTop: 14 }}>
          <h3>Import subscribers (CSV)</h3>
          <p className="small muted">Columns: email (required), name (optional); a header row is detected. Existing addresses — including unsubscribed or bounced ones — are left untouched.</p>
          <input type="hidden" name="action" value="import_csv" />
          <input type="file" name="csv" accept=".csv,text/csv,text/plain" />
          <button className="btn" type="submit">Import</button>
        </form>
      )}
      <div className="rows" style={{ marginTop: 16 }}>
        <div className="head g-subs"><span>Email</span><span>Status</span><span>Flags</span></div>
        {d.subscribers.map((s) => (
          <details className="row" key={s.id}>
            <summary className="g-subs">
              <span className="cell-title">{admin ? s.email : maskEmail(s.email)}</span>
              <Status dot={s.status === "active" ? (s.soft_bounces ? "amber" : "green") : s.status === "unsubscribed" ? "grey" : "red"} text={cap(s.status) + (s.soft_bounces && s.status === "active" ? ` · ${s.soft_bounces} soft` : "")} />
              <span>{s.is_test_recipient && <span className="tag test">test</span>} {s.is_sample && <span className="tag sample">sample</span>}</span>
            </summary>
            <div className="detail">
              <dl className="kv">
                <dt>Name</dt><dd>{s.name ?? "—"}</dd>
                <dt>Status reason</dt><dd>{s.status_reason ?? "—"}</dd>
                {s.unsubscribed_at && <><dt>Unsubscribed</dt><dd>{formatIst(s.unsubscribed_at)}</dd></>}
              </dl>
              <div className="small">
                {(s.history ?? []).map((h: any, i: number) => <div key={i} className="muted">{formatIst(h.at)} — {h.status}{h.reason ? `: ${h.reason}` : ""}</div>)}
                {(s.deliveries ?? []).map((x: any, i: number) => <div key={`d${i}`} className="muted">{formatIst(x.at)} — {x.issue < 1 ? "live test send" : `issue #${x.issue}`}: {x.status} ({x.mode})</div>)}
              </div>
            </div>
          </details>
        ))}
      </div>
    </>
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
            <p className="small muted">Everything here is read-only without the password.</p>
          </form>
        ) : (
          <>
            <form method="post" action="/api/admin/action">
              <label>Simulate time (IST, optional)<input type="datetime-local" name="simulated_now" /></label>
              <p className="small muted">With a simulated time each job checks the IST schedule as if it were that moment. Simulated runs can never send live email.</p>
              <hr />
              <div className="group">
                <button className="btn" name="action" value="run_ingest">Run ingestion now</button>
                <label className="check small"><input type="checkbox" name="broken_feed" /> include a deliberately broken test feed</label>
                <button className="btn" name="action" value="run_draft">Run selection + send draft to Telegram</button>
                <label className="check small"><input type="checkbox" name="force" /> regenerate even if a draft exists</label>
                <button className="btn" name="action" value="run_reminder">Run reminder check (Wed 10 PM)</button>
                <button className="btn" name="action" value="run_send">Run send check (Thu 8 AM)</button>
                <button className="btn" name="action" value="run_report">Run delivery report (Thu 6 PM)</button>
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

const Status = ({ dot, text }: { dot: Dot; text: string }) => <span className="status small"><span className={`dot ${dot}`} />{text}</span>;
const Chip = ({ href, on, children, topic }: { href: string; on: boolean; children: React.ReactNode; topic?: string }) => <a className={`chip${on ? " on" : ""}${topic ? " tchip" : ""}`} style={topic ? tc(topic) : undefined} href={href}>{children}</a>;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const sourceWord = (s?: string) => ({ learned: "learned from her writing", edited: "edited", assumed: "assumed voice" } as Record<string, string>)[s ?? "assumed"] ?? s ?? "";

function filterHref(sp: SP, change: Partial<SP>) {
  const p = new URLSearchParams({ p: "articles" });
  const next = { atopic: sp.atopic, astatus: sp.astatus, ...change };
  if (next.atopic) p.set("atopic", next.atopic);
  if (next.astatus) p.set("astatus", next.astatus);
  return `/?${p.toString()}`;
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
  if (a.draft_state === "rejected" || a.draft_state === "swapped_out") return { label: "Removed", dot: "grey", why: "Was in the draft; Shreya rejected or swapped it." };
  return { label: "Candidate", dot: "blue", why: "Unique this week and on-topic; Gemini considered it but picked others with higher signal." };
}

function eventLabel(e: string) {
  return ({ draft_created: "Draft created", draft_sent: "Draft sent to Telegram", edited: "Commentary edited", swapped: "Story swapped", story_rejected: "Story rejected",
    story_added: "Story added", story_approved: "Story approved", reminder_sent: "Reminder sent", approved: "Final draft confirmed", approval_revoked: "Approval revoked by an edit",
    rejected: "Draft rejected", sent: "Newsletter sent", send_failed: "Send failed", skipped: "Skipped (not approved)", insufficient_stories: "Not enough stories",
    report_sent: "Delivery report sent" } as Record<string, string>)[e] ?? e;
}
function eventDot(e: string): Dot {
  if (["approved", "sent", "draft_sent", "draft_created", "story_approved", "report_sent"].includes(e)) return "green";
  if (["skipped", "rejected", "send_failed"].includes(e)) return "red";
  if (["approval_revoked", "reminder_sent", "insufficient_stories"].includes(e)) return "amber";
  return "blue";
}

/** Tiny markdown renderer for the voice guide (headings, lists, quotes, bold/italic). */
function Markdown({ text }: { text: string }) {
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((part, i) =>
    part.startsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part.startsWith("*") && part.length > 2 ? <em key={i}>{part.slice(1, -1)}</em> : part);
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];
  const flush = () => { if (list.length) { blocks.push(<ul key={blocks.length}>{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>); list = []; } };
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*[-*] /.test(line)) { list.push(line.replace(/^\s*[-*] /, "")); continue; }
    flush();
    if (/^# /.test(line)) blocks.push(<h1 key={blocks.length}>{inline(line.slice(2))}</h1>);
    else if (/^##+ /.test(line)) blocks.push(<h2 key={blocks.length}>{inline(line.replace(/^##+ /, ""))}</h2>);
    else if (/^> /.test(line)) blocks.push(<blockquote key={blocks.length}>{inline(line.slice(2))}</blockquote>);
    else if (line.trim()) blocks.push(<p key={blocks.length}>{inline(line)}</p>);
  }
  flush();
  return <>{blocks}</>;
}
