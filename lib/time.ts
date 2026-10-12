/**
 * All scheduling decisions are made in Asia/Kolkata (IST, UTC+05:30, no DST).
 * `now()` is the single source of "current time"; jobs pass an optional simulated time.
 */
export const TZ = process.env.TZ_NAME || "Asia/Kolkata";

export function now(simulated?: string | Date | null): Date {
  if (simulated) {
    const d = typeof simulated === "string" ? parseIstInput(simulated) : simulated;
    if (isNaN(d.getTime())) throw new Error(`Invalid simulated time: ${simulated}`);
    return d;
  }
  return new Date();
}

/** Accepts ISO strings with an offset, or a bare "YYYY-MM-DDTHH:mm" which is read as IST. */
export function parseIstInput(s: string): Date {
  const bare = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s);
  return new Date(bare ? `${s.length === 16 ? s + ":00" : s}+05:30` : s);
}

export type IstParts = {
  year: number; month: number; day: number; hour: number; minute: number;
  weekday: number; // 1 = Monday … 7 = Sunday
  minutesOfDay: number;
  dateStr: string; // YYYY-MM-DD in IST
};

const fmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short",
});
const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function istParts(d: Date): IstParts {
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  const year = +p.year, month = +p.month, day = +p.day, hour = +p.hour, minute = +p.minute;
  return {
    year, month, day, hour, minute,
    weekday: WEEKDAYS[p.weekday],
    minutesOfDay: hour * 60 + minute,
    dateStr: `${p.year}-${p.month}-${p.day}`,
  };
}

/** ISO week key (e.g. 2026-W42) of the IST calendar date. */
export function weekKey(d: Date): string {
  const { year, month, day } = istParts(d);
  const date = new Date(Date.UTC(year, month - 1, day));
  const dow = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dow); // Thursday of this ISO week
  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/** IST date string (YYYY-MM-DD) for a weekday (1 = Mon) of an ISO week key. */
export function weekDate(key: string, weekday: number): string {
  const [y, w] = key.split("-W").map(Number);
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1) + (w - 1) * 7 + (weekday - 1));
  return monday.toISOString().slice(0, 10);
}

/** An IST wall-clock time converted to an absolute Date. */
export function istDate(dateStr: string, hh: number, mm = 0): Date {
  return new Date(`${dateStr}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+05:30`);
}

export function previousWeekKey(key: string, n = 1): string {
  return weekKey(new Date(istDate(weekDate(key, 4), 12, 0).getTime() - n * 7 * 86400000));
}

export function formatIst(d: Date | string | null | undefined, opts: Intl.DateTimeFormatOptions = {}): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", ...opts,
  }).format(date);
}

export function formatIstDate(d: Date | string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "numeric", month: "long", year: "numeric" })
    .format(typeof d === "string" ? new Date(d) : d);
}

// ---------------------------------------------------------------------------
// Weekly schedule (IST). Vercel Hobby crons fire somewhere inside the scheduled
// hour, so every job re-checks the IST time here before acting.
// ---------------------------------------------------------------------------
export type Job = "ingest" | "draft" | "reminder" | "send";

export const SCHEDULE = {
  ingest: { label: "Collect", when: "Mon–Wed ~07:00 IST", cron: "30 1 * * 1-3" },
  draft: { label: "Select + draft", when: "Wed ~15:00 IST", cron: "30 9 * * 3" },
  reminder: { label: "Reminder", when: "Wed after 22:00 IST", cron: "0 17 * * 3" },
  send: { label: "Send", when: "Thu ~08:00 IST", cron: "30 2 * * 4" },
} as const;

export const DRAFT_AT = 15 * 60;      // Wed 15:00
export const REMINDER_AT = 22 * 60;   // Wed 22:00
export const SEND_AT = 8 * 60;        // Thu 08:00

export function scheduleGate(job: Job, d: Date): { act: boolean; reason: string } {
  const { weekday, minutesOfDay } = istParts(d);
  const label = `${["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][weekday]} ${String(Math.floor(minutesOfDay / 60)).padStart(2, "0")}:${String(minutesOfDay % 60).padStart(2, "0")} IST`;
  switch (job) {
    case "ingest":
      return weekday >= 1 && weekday <= 3
        ? { act: true, reason: `${label} is within Mon–Wed collection` }
        : { act: false, reason: `${label} is outside Mon–Wed collection` };
    case "draft":
      return weekday === 3 && minutesOfDay >= DRAFT_AT
        ? { act: true, reason: `${label} is at/after Wed 15:00` }
        : { act: false, reason: `${label} is not Wed after 15:00` };
    case "reminder":
      return (weekday === 3 && minutesOfDay >= REMINDER_AT) || (weekday === 4 && minutesOfDay < SEND_AT)
        ? { act: true, reason: `${label} is at/after Wed 22:00 and before the Thursday send` }
        : { act: false, reason: `${label} is before Wed 22:00 (or past the send)` };
    case "send":
      return weekday === 4 && minutesOfDay >= SEND_AT
        ? { act: true, reason: `${label} is Thursday at/after 08:00` }
        : { act: false, reason: `${label} is not Thursday after 08:00` };
  }
}
