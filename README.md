# twitter-save-photos

A free web app that downloads **all photos and videos** from any X (Twitter)
profile and packages them into a ZIP file with `photos/` and `videos/` folders.

No paid API keys required — it uses X's own web endpoints.

## Features

- Enter a username → scans their timeline (paginated)
- Separates media into `photos/` and `videos/` inside the ZIP
- Videos are downloaded at the highest available MP4 quality
- Fully client-side ZIP packaging via [JSZip](https://stuk.github.io/jszip/)

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000

## Environment variables (optional)

Everything works **without** any env vars. However, X rate-limits anonymous
requests, so for heavy use you can add your own logged-in session cookies to
`.env.local` (see `.env.example`):

```bash
cp .env.example .env.local
```

Then fill in:

- `AUTH_TOKEN` — value of the `auth_token` cookie from x.com
- `CT0` — value of the `ct0` cookie from x.com

To get them: log in to x.com → DevTools (F12) → Application → Cookies →
`https://x.com` → copy the two values. **Never commit `.env.local`** — it's
gitignored. Treat these like passwords.

## Deploy to Vercel (free)

1. Push this repo to GitHub.
2. Go to [vercel.com/new](https://vercel.com/new), import the repo.
3. Framework preset: **Next.js** — no env vars needed, just Deploy.
4. Optionally add `AUTH_TOKEN`/`CT0` under Project → Settings → Environment
   Variables if you hit rate limits.

Hobby tier is free and sufficient for personal use.

## How it works

- `app/api/media` — server-side route that calls X's GraphQL endpoints
  (`UserByScreenName` + `UserTweets`) with a guest token and extracts media
  URLs from tweets.
- `app/api/proxy` — streams media bytes from `pbs.twimg.com` /
  `video.twimg.com` (avoids CORS and hotlink issues).
- `app/page.tsx` — UI + ZIP generation entirely in the browser.

## Notes & limitations

- This uses unofficial endpoints; X can change or rate-limit them at any time.
- Very large profiles take a while — use the "Max pages" setting to limit
  how much history is scanned (each page ≈ 40 tweets).
- Scraping may violate X's Terms of Service — use responsibly, only for
  content you have the right to download.
