import { NextRequest, NextResponse } from "next/server";
import { scrapeUserMedia } from "@/lib/twitter";

export const maxDuration = 60;

function parseDate(s: string | null, endOfDay = false): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s + (endOfDay && !s.includes("T") ? "T23:59:59" : ""));
  return isNaN(d.getTime()) ? undefined : d;
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const username = params.get("username") ?? "";
  const pagesParam = parseInt(params.get("pages") ?? "5", 10);
  const pages = Math.min(Math.max(isNaN(pagesParam) ? 5 : pagesParam, 1), 20);
  const maxMediaParam = parseInt(params.get("maxMedia") ?? "0", 10);
  const maxMedia = isNaN(maxMediaParam) || maxMediaParam <= 0 ? undefined : maxMediaParam;

  try {
    const result = await scrapeUserMedia(username, {
      maxPages: pages,
      cursor: params.get("cursor") ?? undefined,
      from: parseDate(params.get("from")),
      to: parseDate(params.get("to"), true),
      maxMedia,
    });
    // Partial results are still a success — the client resumes via nextCursor.
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = /not found/i.test(message) ? 404 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
