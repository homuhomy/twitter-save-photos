// Unofficial X/Twitter web-client scraper.
// Uses the same public bearer token as x.com's own web app plus a guest token,
// so no paid API key is required. Set AUTH_TOKEN + CT0 in .env.local (cookies
// from a logged-in x.com session) for better reliability/rate limits.

const BEARER =
  "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

const API = "https://x.com/i/api/graphql";
const Q_USER_BY_SCREEN_NAME = "qW5u-DAuXpMEG0zA1F7UGQ";
const Q_USER_TWEETS = "E3opETHurmVJflFsUBVuUQ";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export interface MediaItem {
  id: string;
  type: "photo" | "video";
  url: string;
  filename: string;
  postUrl: string;
}

export interface ScrapeResult {
  user: { name: string; screenName: string; avatar?: string };
  items: MediaItem[];
  pagesFetched: number;
  tweetsScanned: number;
  nextCursor: string | null;
  done: boolean;
  error?: string;
}

interface UserInfo {
  rest_id: string;
  legacy?: { name?: string; screen_name?: string; profile_image_url_https?: string };
}

// In-memory cache: username -> resolved user (survives across requests on the
// same warm serverless instance).
const userCache = new Map<string, UserInfo>();
let cachedGuest: { token: string; expires: number } | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function usesCookies(): boolean {
  return Boolean(process.env.AUTH_TOKEN && process.env.CT0);
}

async function getGuestToken(): Promise<string | null> {
  if (usesCookies()) return null;
  if (cachedGuest && cachedGuest.expires > Date.now() + 30_000) {
    return cachedGuest.token;
  }
  const res = await fetch("https://api.x.com/1.1/guest/activate.json", {
    method: "POST",
    headers: { authorization: BEARER, "user-agent": UA },
  });
  if (!res.ok) throw new Error(`guest token failed: ${res.status}`);
  const data = (await res.json()) as { guest_token: string };
  cachedGuest = { token: data.guest_token, expires: Date.now() + 3 * 60 * 60 * 1000 };
  return data.guest_token;
}

async function gql(
  queryId: string,
  operation: string,
  variables: Record<string, unknown>
): Promise<any> {
  const authToken = process.env.AUTH_TOKEN;
  const ct0 = process.env.CT0;
  const url = `${API}/${queryId}/${operation}?variables=${encodeURIComponent(
    JSON.stringify(variables)
  )}&features=${encodeURIComponent(JSON.stringify({}))}`;

  const headers: Record<string, string> = {
    authorization: BEARER,
    "user-agent": UA,
    "x-twitter-active-user": "yes",
    "x-twitter-client-language": "en",
    accept: "*/*",
  };
  if (authToken && ct0) {
    headers.cookie = `auth_token=${authToken}; ct0=${ct0}`;
    headers["x-csrf-token"] = ct0;
  }

  // One retry on 429: fresh guest token + short backoff.
  for (let attempt = 0; attempt < 2; attempt++) {
    const guest = await getGuestToken();
    const h = { ...headers };
    if (guest) h["x-guest-token"] = guest;

    const res = await fetch(url, { headers: h, cache: "no-store" });
    if (res.status === 429 && attempt === 0) {
      cachedGuest = null;
      await sleep(3000);
      continue;
    }
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`X API ${res.status} for ${operation}: ${text.slice(0, 200)}`);
    }
    const json = JSON.parse(text) as { data?: any; errors?: { message?: string }[] };
    if (json.errors?.length) {
      throw new Error(`X API error for ${operation}: ${json.errors[0]?.message ?? "unknown"}`);
    }
    return json.data;
  }
  throw new Error(`X API 429 for ${operation}: Rate limit exceeded`);
}

async function resolveUser(screenName: string): Promise<UserInfo> {
  const key = screenName.toLowerCase();
  const cached = userCache.get(key);
  if (cached) return cached;
  const data = await gql(Q_USER_BY_SCREEN_NAME, "UserByScreenName", {
    screen_name: screenName,
    withSafetyModeUserFields: true,
  });
  const result = data?.user?.result;
  if (!result?.rest_id) throw new Error(`User "@${screenName}" not found`);
  userCache.set(key, result as UserInfo);
  return result as UserInfo;
}

function unwrapTweet(entry: any): any {
  let t = entry?.content?.itemContent?.tweet_results?.result;
  if (!t) return null;
  if (t.__typename === "TweetWithVisibilityResults") t = t.tweet;
  if (t?.__typename === "TweetTombstone" || !t?.legacy) return null;
  return t;
}

function pickVideoUrl(media: any): string | null {
  const variants = media?.video_info?.variants ?? [];
  const mp4s = variants.filter((v: any) => v.content_type === "video/mp4" && v.url);
  if (!mp4s.length) return null;
  mp4s.sort((a: any, b: any) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
  return mp4s[0].url;
}

function extOf(url: string, fallback: string): string {
  const m = url.match(/\.(jpg|jpeg|png|webp|gif|mp4)(\?|$)/i);
  if (!m) return fallback;
  const e = m[1].toLowerCase();
  return e === "jpeg" ? "jpg" : e;
}

export interface ScrapeOptions {
  maxPages?: number;
  cursor?: string;
  from?: Date; // oldest date to include
  to?: Date; // newest date to include
  maxMedia?: number; // stop after this many items
}

function tweetDate(legacy: any): Date | null {
  const s: string | undefined = legacy?.created_at;
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Scrapes up to `maxPages` timeline pages starting at `cursor`.
 * Never throws mid-loop: on error it returns partial results plus nextCursor
 * so the caller can resume later.
 */
export async function scrapeUserMedia(
  rawUsername: string,
  opts: ScrapeOptions = {}
): Promise<ScrapeResult> {
  const { maxPages = 5, from, to, maxMedia } = opts;
  let cursor = opts.cursor;
  const screenName = rawUsername.replace(/^@/, "").trim();
  if (!screenName) throw new Error("Username is required");

  const user = await resolveUser(screenName);
  const items: MediaItem[] = [];
  const seen = new Set<string>();
  let pagesFetched = 0;
  let tweetsScanned = 0;
  let done = false;
  let error: string | undefined;

  while (pagesFetched < maxPages && !done) {
    const variables: Record<string, unknown> = {
      userId: user.rest_id,
      count: 40,
      includePromotedContent: false,
      withVoice: false,
    };
    if (cursor) variables.cursor = cursor;

    let data: any;
    try {
      data = await gql(Q_USER_TWEETS, "UserTweets", variables);
    } catch (e) {
      error = e instanceof Error ? e.message : "Scrape failed";
      break;
    }

    const instructions =
      data?.user?.result?.timeline?.timeline?.instructions ?? [];

    let nextCursor: string | undefined;
    let tweetsThisPage = 0;
    let oldest: Date | null = null;
    for (const ins of instructions) {
      for (const entry of ins.entries ?? []) {
        const entryId: string = entry.entryId ?? "";
        if (
          entryId.startsWith("cursor-bottom-") ||
          (entry.content?.__typename === "TimelineTimelineCursor" &&
            entry.content.cursorType === "Bottom")
        ) {
          nextCursor = entry.content?.value ?? nextCursor;
          continue;
        }
        const tweet = unwrapTweet(entry);
        if (!tweet?.rest_id) continue;
        const legacy = tweet.legacy;
        const ts = tweetDate(legacy);
        if (ts && (oldest == null || ts < oldest)) oldest = ts;
        // Date filter: skip tweets outside the range.
        if (to && ts && ts > to) continue;
        if (from && ts && ts < from) continue;
        tweetsThisPage++;
        // Skip retweets — only media owned by this user.
        if (legacy.retweeted_status_result) continue;
        const media =
          legacy.extended_entities?.media ?? legacy.entities?.media ?? [];
        const postUrl = `https://x.com/${screenName}/status/${tweet.rest_id}`;

        media.forEach((m: any, i: number) => {
          const isVideo = m.type === "video" || m.type === "animated_gif";
          let url: string | null = null;
          let fallback = "jpg";
          if (isVideo) {
            url = pickVideoUrl(m);
            fallback = "mp4";
          } else {
            url = m.media_url_https ? `${m.media_url_https}?name=orig` : null;
          }
          if (!url || seen.has(url)) return;
          seen.add(url);
          const filename = `${tweet.rest_id}-${i + 1}.${extOf(url, fallback)}`;
          items.push({
            id: m.media_key ?? `${tweet.rest_id}-${i}`,
            type: isVideo ? "video" : "photo",
            url,
            filename,
            postUrl,
          });
        });
      }
    }

    pagesFetched++;
    tweetsScanned += tweetsThisPage;
    cursor = nextCursor;
    // Stop early: hit max media, ran out of pages, or timeline went
    // older than the "from" bound (timeline is reverse-chronological).
    if (maxMedia && items.length >= maxMedia) {
      items.length = maxMedia;
      cursor = undefined;
      done = true;
    }
    // Guard against pinned old tweets on page 1 stopping the scan early.
    if (from && oldest && oldest < from && pagesFetched > 1) done = true;
    if (!cursor) done = true;
  }

  return {
    user: {
      name: user.legacy?.name ?? screenName,
      screenName: user.legacy?.screen_name ?? screenName,
      avatar: user.legacy?.profile_image_url_https,
    },
    items,
    pagesFetched,
    tweetsScanned,
    nextCursor: done ? null : (cursor ?? null),
    done,
    error,
  };
}
