import { NextRequest, NextResponse } from "next/server";
import { scrapeUserMedia } from "@/lib/twitter";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const username = params.get("username") ?? "";
  const cursor = params.get("cursor") ?? undefined;
  const pagesParam = parseInt(params.get("pages") ?? "5", 10);
  const pages = Math.min(Math.max(isNaN(pagesParam) ? 5 : pagesParam, 1), 20);

  try {
    const result = await scrapeUserMedia(username, pages, cursor);
    // Partial results are still a success — the client resumes via nextCursor.
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = /not found/i.test(message) ? 404 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
