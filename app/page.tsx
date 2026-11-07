"use client";

import { useRef, useState } from "react";
import JSZip from "jszip";

interface MediaItem {
  id: string;
  type: "photo" | "video";
  url: string;
  filename: string;
  postUrl: string;
}

interface ScrapeResult {
  user: { name: string; screenName: string; avatar?: string };
  items: MediaItem[];
  pagesFetched: number;
  tweetsScanned: number;
  nextCursor: string | null;
  done: boolean;
  error?: string;
}

const PAGES_PER_REQUEST = 5;
const MAX_TOTAL_PAGES = 100; // ~4000 tweets; raise if needed

export default function Home() {
  const [username, setUsername] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [maxMedia, setMaxMedia] = useState("");
  const [scanning, setScanning] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [stats, setStats] = useState({ pages: 0, tweets: 0 });
  const [items, setItems] = useState<MediaItem[]>([]);
  const [user, setUser] = useState<ScrapeResult["user"] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seen = useRef(new Set<string>());

  async function fetchBatch(startCursor: string | null) {
    const params = new URLSearchParams({
      username: username.trim(),
      pages: String(PAGES_PER_REQUEST),
    });
    if (startCursor) params.set("cursor", startCursor);
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    if (maxMedia) params.set("maxMedia", maxMedia);
    const res = await fetch(`/api/media?${params}`);
    const data = (await res.json()) as ScrapeResult & { error?: string };
    if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
    return data;
  }

  async function scan(first: boolean) {
    if (!username.trim()) return;
    setScanning(true);
    setError(null);

    let cur = first ? null : cursor;
    let pages = first ? 0 : stats.pages;
    let tweets = first ? 0 : stats.tweets;
    if (first) {
      setItems([]);
      setUser(null);
      seen.current = new Set();
    }

    try {
      while (pages < MAX_TOTAL_PAGES) {
        const data = await fetchBatch(cur);
        setUser(data.user);
        const fresh = data.items.filter((i) => !seen.current.has(i.url));
        fresh.forEach((i) => seen.current.add(i.url));
        if (fresh.length) setItems((prev) => [...prev, ...fresh]);

        pages += data.pagesFetched;
        tweets += data.tweetsScanned;
        setStats({ pages, tweets });
        cur = data.nextCursor;
        setCursor(cur);

        if (data.error) {
          setError(data.error + " — progress saved, hit Resume to continue.");
          return;
        }
        if (data.done) return;
      }
      setError("Reached max page limit — use Resume to keep going.");
    } catch (e) {
      setError(
        (e instanceof Error ? e.message : "Something went wrong") +
          " — progress saved, hit Resume to continue."
      );
    } finally {
      setScanning(false);
    }
  }

  async function downloadAll() {
    setDownloading(true);
    setError(null);
    setProgress({ done: 0, total: items.length });

    const zip = new JSZip();
    const photos = zip.folder("photos")!;
    const videos = zip.folder("videos")!;

    let done = 0;
    let failed = 0;
    const queue = [...items];
    const workers = Array.from({ length: 6 }, async () => {
      while (queue.length) {
        const item = queue.shift()!;
        try {
          const res = await fetch(`/api/proxy?url=${encodeURIComponent(item.url)}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          (item.type === "video" ? videos : photos).file(item.filename, blob);
        } catch {
          failed++;
        }
        done++;
        setProgress({ done, total: items.length });
      }
    });
    await Promise.all(workers);
    if (failed > 0) setError(`${failed} file(s) failed to download and were skipped.`);

    const blob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `twitter-${user?.screenName ?? "user"}-media.zip`;
    a.click();
    URL.revokeObjectURL(a.href);
    setDownloading(false);
  }

  const photos = items.filter((i) => i.type === "photo").length;
  const vids = items.filter((i) => i.type === "video").length;

  return (
    <main className="mx-auto max-w-4xl px-4 py-12">
      <h1 className="text-3xl font-bold">Twitter / X Media Downloader</h1>
      <p className="mt-2 text-sm text-neutral-500">
        Free, no API key required. Downloads all media from a profile into a ZIP
        with <code>photos/</code> and <code>videos/</code> folders.
      </p>

      <div className="mt-6 flex flex-wrap items-end gap-3">
        <label className="flex-1 min-w-52">
          <span className="text-sm text-neutral-400">Username</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && scan(true)}
            placeholder="@username"
            className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 outline-none focus:border-neutral-400"
          />
        </label>
        {!cursor || !items.length ? (
          <button
            onClick={() => scan(true)}
            disabled={scanning}
            className="rounded-lg bg-white px-5 py-2 font-medium text-black disabled:opacity-50"
          >
            {scanning ? "Scanning…" : "Scan"}
          </button>
        ) : (
          <button
            onClick={() => scan(false)}
            disabled={scanning}
            className="rounded-lg bg-white px-5 py-2 font-medium text-black disabled:opacity-50"
          >
            {scanning ? "Scanning…" : "Resume"}
          </button>
        )}
        {items.length > 0 && (
          <button
            onClick={downloadAll}
            disabled={downloading || scanning}
            className="rounded-lg bg-emerald-500 px-5 py-2 font-medium text-black disabled:opacity-50"
          >
            {downloading
              ? `Downloading ${progress.done}/${progress.total}…`
              : `Download ZIP (${items.length})`}
          </button>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label>
          <span className="text-xs text-neutral-500">From (oldest)</span>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="mt-1 block rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm outline-none focus:border-neutral-400"
          />
        </label>
        <label>
          <span className="text-xs text-neutral-500">To (newest)</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="mt-1 block rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm outline-none focus:border-neutral-400"
          />
        </label>
        <label>
          <span className="text-xs text-neutral-500">Max media (blank = all)</span>
          <input
            type="number"
            min={1}
            value={maxMedia}
            onChange={(e) => setMaxMedia(e.target.value)}
            placeholder="e.g. 100"
            className="mt-1 block w-36 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm outline-none focus:border-neutral-400"
          />
        </label>
      </div>

      {stats.pages > 0 && (
        <p className="mt-3 text-sm text-neutral-500">
          Scanned {stats.tweets} tweets ({stats.pages} pages) → {items.length} media
          {cursor && " — more available, Resume to continue"}
        </p>
      )}

      {error && (
        <div className="mt-4 rounded-lg border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {downloading && (
        <div className="mt-4 h-2 w-full overflow-hidden rounded bg-neutral-800">
          <div
            className="h-full bg-emerald-500 transition-all"
            style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }}
          />
        </div>
      )}

      {user && (
        <div className="mt-8">
          <h2 className="text-xl font-semibold">
            @{user.screenName}{" "}
            <span className="text-sm font-normal text-neutral-400">
              — {photos} photos, {vids} videos
            </span>
          </h2>
          <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
            {items.map((item) => (
              <a
                key={item.url}
                href={item.postUrl}
                target="_blank"
                rel="noreferrer"
                className="relative aspect-square overflow-hidden rounded-lg bg-neutral-800"
                title={item.postUrl}
              >
                {item.type === "photo" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/proxy?url=${encodeURIComponent(item.url)}`}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-neutral-400">
                    ▶ video
                  </div>
                )}
                <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[10px]">
                  {item.type === "video" ? "MP4" : "IMG"}
                </span>
              </a>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
