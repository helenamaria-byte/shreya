import { sql } from "@/lib/db";
import { verifyUnsubscribeToken } from "@/lib/email";

export const dynamic = "force-dynamic";
export const metadata = { title: "Unsubscribe — The Dispatch" };

export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ token?: string; done?: string }> }) {
  const { token, done } = await searchParams;
  if (done) {
    return (
      <main className="narrow">
        <h1>You're unsubscribed</h1>
        <p className="muted">You won't receive The Dispatch any more. Sorry to see you go.</p>
      </main>
    );
  }
  const id = verifyUnsubscribeToken(token);
  const sub = id ? (await sql`SELECT email, status FROM subscribers WHERE id = ${id}`)[0] : null;
  if (!sub) {
    return (
      <main className="narrow">
        <h1>This link isn't valid</h1>
        <p className="muted">The unsubscribe link is incomplete or has been changed. Use the link from the bottom of the latest email.</p>
      </main>
    );
  }
  const masked = sub.email.replace(/^(.{2}).*(@.*)$/, "$1•••$2");
  return (
    <main className="narrow">
      <h1>Unsubscribe from The Dispatch?</h1>
      {sub.status === "active" ? (
        <form method="post" action={`/api/unsubscribe?token=${encodeURIComponent(token!)}`}>
          <input type="hidden" name="source" value="page" />
          <p className="muted">{masked} will stop receiving the weekly newsletter.</p>
          <button className="btn primary" type="submit">Unsubscribe</button>
        </form>
      ) : (
        <p className="muted">{masked} is already {sub.status}. You won't receive further issues.</p>
      )}
    </main>
  );
}
