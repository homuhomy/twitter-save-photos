"use client";

import { useState } from "react";
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
  done: boolean;
}

export default function Home() {
  const [username, setUsername] = useState("");
  const [pages, setPages] = useState(25);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<ScrapeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    if (!username.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(
        `/api/media?username=${encodeURIComponent(username.trim())}&pages=${pages}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function downloadAll() {
    if (!result) return;
    setDownloading(true);
    setError(null);
    setProgress({ done: 0, total: result.items.length });

    const zip = new JSZip();
    const photos = zip.folder("photos")!;
    const videos = zip.folder("videos")!;
    const folderFor = (t: string) => (t === "video" ? videos : photos);

    let done = 0;
    let failed = 0;
    const queue = [...result.items];
    const workers = Array.from({ length: 6 }, async () => {
      while (queue.length) {
        const item = queue.shift()!;
        try {
          const res = await fetch(`/api/proxy?url=${encodeURIComponent(item.url)}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          folderFor(item.type).file(item.filename, blob);
        } catch {
          failed++;
        }
        done++;
        setProgress({ done, total: result.items.length });
      }
    });
    await Promise.all(workers);

    if (failed > 0) {
      setError(`${failed} file(s) failed to download and were skipped.`);
    }

    const blob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `twitter-${result.user.screenName}-media.zip`;
    a.click();
    URL.revokeObjectURL(a.href);
    setDownloading(false);
  }

  const photos = result?.items.filter((i) => i.type === "photo").length ?? 0;
  const vids = result?.items.filter((i) => i.type === "video").length ?? 0;

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
            onKeyDown={(e) => e.key === "Enter" && search()}
            placeholder="@username"
            className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 outline-none focus:border-neutral-400"
          />
        </label>
        <label>
          <span className="text-sm text-neutral-400">Max pages</span>
          <input
            type="number"
            min={1}
            max={100}
            value={pages}
            onChange={(e) => setPages(parseInt(e.target.value) || 25)}
            className="mt-1 w-24 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 outline-none focus:border-neutral-400"
          />
        </label>
        <button
          onClick={search}
          disabled={loading}
          className="rounded-lg bg-white px-5 py-2 font-medium text-black disabled:opacity-50"
        >
          {loading ? "Scanning…" : "Scan"}
        </button>
        {result && (
          <button
            onClick={downloadAll}
            disabled={downloading}
            className="rounded-lg bg-emerald-500 px-5 py-2 font-medium text-black disabled:opacity-50"
          >
            {downloading
              ? `Downloading ${progress.done}/${progress.total}…`
              : `Download ZIP (${result.items.length})`}
          </button>
        )}
      </div>

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

      {result && (
        <div className="mt-8">
          <h2 className="text-xl font-semibold">
            @{result.user.screenName}{" "}
            <span className="text-sm font-normal text-neutral-400">
              — {photos} photos, {vids} videos
              {!result.done && " (hit page limit, more may exist)"}
            </span>
          </h2>
          <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
            {result.items.map((item) => (
              <a
                key={item.id + item.url}
                href={item.postUrl}
                target="_blank"
                rel="noreferrer"
                className="group relative aspect-square overflow-hidden rounded-lg bg-neutral-800"
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
