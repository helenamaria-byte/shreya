import { NextResponse } from "next/server";
import { cronAuthorized } from "./auth";
import { JOBS } from "./jobs";
import type { Job } from "./time";

/** Vercel Cron calls GET with `Authorization: Bearer ${CRON_SECRET}`. Real time only — simulated time is admin/test-only. */
export function cronHandler(job: Job) {
  return async function GET(req: Request) {
    if (!cronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const result = await JOBS[job]({ trigger: "cron" });
    return NextResponse.json({ job, ...result }, { status: result.status === "failed" ? 500 : 200 });
  };
}
