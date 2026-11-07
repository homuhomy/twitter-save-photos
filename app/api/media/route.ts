import { NextRequest, NextResponse } from "next/server";
import { scrapeUserMedia } from "@/lib/twitter";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const username = req.nextUrl.searchParams.get("username") ?? "";
  const pagesParam = parseInt(req.nextUrl.searchParams.get("pages") ?? "25", 10);
  const pages = Math.min(Math.max(isNaN(pagesParam) ? 25 : pagesParam, 1), 100);

  try {
    const result = await scrapeUserMedia(username, pages);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = /not found/i.test(message) ? 404 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
