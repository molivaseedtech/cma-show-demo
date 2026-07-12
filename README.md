# The Carla Marie & Anthony Show platform

This repository now contains two connected products:

- `/` — the listener-facing PWA, hydrated from published content.
- `/admin` — CMA's editorial control room for Twitch/audio ingest, transcription, AI drafting, editing, review, synchronized scheduling, and publishing.

The original static demo remains embedded in `index.html` as an offline fallback. When the Node server is running, published records from `data/content.json` replace that fallback.

## Brand direction

The public site and control room now inherit the current CMA website's core palette and visual language: hot pink, teal, plum, deep blue-black, wide geometric headings, plus-sign patterns, squared editorial controls, the current CMA logo, and existing host photography. Mirrored client assets live in `assets/` so the demo does not rely on WordPress at runtime. Cursor followers and custom pointer effects are intentionally excluded.

## Run it

```bash
npm start
```

Open `http://127.0.0.1:4173/admin`. The server has no runtime package dependencies and requires Node 22 or newer. Localhost works without a password during development.

### Preview the admin on the Vercel demo

Open `/admin/?staticPreview=1` on the Vercel demo domain. This intentionally uses sample records and browser-local storage so the redesigned workflow can be clicked without exposing CMA passwords, drafts, uploads, or the OpenAI key. A yellow **Demo preview** banner distinguishes it from the real authenticated admin. Resetting site data resets the preview.

## Private online admin

`/admin` is designed to work from a phone or computer anywhere in the world, but it must be deployed with the Node server—not as static GitHub Pages. A real hosted setup requires HTTPS, a persistent volume, and these server-side secrets:

```dotenv
HOST=0.0.0.0
CMA_CARLA_PASSWORD=<separate strong password>
CMA_ANTHONY_PASSWORD=<separate strong password>
SESSION_SECRET=<long random secret>
CMA_DATA_DIR=/data/content
CMA_UPLOAD_DIR=/data/uploads
```

The included `Dockerfile` is ready for a single-instance container host. Mount `/data` as a persistent volume so drafts, published content, and private uploads survive a deployment. Point either `admin.carlamarieandanthonyshow.com` at this service or use `/admin` on the same Node-hosted domain. The login page itself can be reached publicly; all CMA records, uploads, publishing actions, and AI keys are protected by the authenticated server API.

For a production pilot, use one running instance. Moving to multiple instances requires a shared database and durable job queue rather than the included file store.

## Editorial workflow

1. Create one **show package** the night before.
2. Attach a Twitch VOD, upload media, link a source, or upload/paste a transcript created on the M4.
3. If there is no transcript, transcribe in `Auto` mode. It tries the M4 first and OpenAI second.
4. Generate the editorial package. `Auto` tries local Ollama, OpenAI, then Gemini.
5. Edit the blog, episode title, excerpt, chapters, links, named mentions, quote, and media destinations.
6. Complete all four human-review checks.
7. Set 4:00 AM once. The blog, episode page, chapters, links, mentions, and media references become public in one atomic publish operation.

AI never publishes by itself. A draft cannot be scheduled until the parts CMA chose to include are reviewed.

### Lowest-cost M4 workflow

1. Anthony exports the final audio from Adobe Audition.
2. A local Mac tool or Apple Shortcut creates a TXT, VTT, or SRT transcript. The audio remains on the Mac.
3. In the online `/admin`, choose **Upload a transcript from the Mac**.
4. The server sends only transcript text and CMA's focus note to the selected writing model, then returns editable titles, chapters, links, mentions, quotes, and the optional post.
5. CMA reviews and schedules the selected website pieces for the same 4:00 AM Eastern release as Megaphone.

If CMA is traveling or needs the quickest path, uploading the audio to `/admin` uses local transcription when the server is running on the M4 and OpenAI transcription as the hosted fallback.

## M4 on-device setup

The server already supports the two local interfaces; installation is intentionally separate from the app.

### Transcription with whisper.cpp

Install/build [whisper.cpp](https://github.com/ggml-org/whisper.cpp), download a GGML Whisper model, and add these values to `.env.local`:

```dotenv
LOCAL_WHISPER_BIN=/absolute/path/to/whisper-cli
LOCAL_WHISPER_MODEL=/absolute/path/to/ggml-large-v3-turbo.bin
```

`whisper.cpp` is optimized for Apple Silicon and can use Metal/Core ML. The control room runs it as a private local process and only sends audio to OpenAI if local transcription is unavailable or explicitly bypassed.

### Drafting with Ollama

Install [Ollama for macOS](https://docs.ollama.com/macos), pull a model appropriate for the Mac's memory, then configure:

```dotenv
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=your-local-model
```

The adapter uses Ollama structured outputs, so the local model must return the same validated package shape as the cloud providers.

## Cloud fallback

The OpenAI key is stored only in `.env.local` as `OPENAI_API_KEY`. The defaults are:

```dotenv
OPENAI_TEXT_MODEL=gpt-5.4-mini
OPENAI_TRANSCRIBE_MODEL=gpt-4o-mini-transcribe
```

Optional Gemini fallback:

```dotenv
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.5-flash
```

Keys are read by `server.mjs`; neither the public site nor `/admin` can read them.

## Twitch

Create a Twitch developer application and configure server-side credentials:

```dotenv
TWITCH_CLIENT_ID=
TWITCH_CLIENT_SECRET=
TWITCH_CHANNEL_LOGIN=CarlaMarieandAnthony
```

The server uses Twitch's client-credentials OAuth flow and Helix `Get Users` / `Get Videos` endpoints to show recent archived streams. To turn a VOD page into local audio for transcription, install `yt-dlp` or set another compatible executable:

```dotenv
LOCAL_MEDIA_DOWNLOADER=yt-dlp
```

## Megaphone and the 4:00 AM release

Megaphone is CMA's podcast hosting system of record. Spotify, Apple Podcasts, and the other listening apps consume the Megaphone RSS feed; Spotify is a destination, not the publishing backend.

The confirmed release timezone is `America/New_York`. Configure the feed when CMA provides it:

```dotenv
CMA_TIMEZONE=America/New_York
PODCAST_PROVIDER=megaphone
MEGAPHONE_RSS_URL=
```

For the pilot, CMA schedules the audio episode in Megaphone and schedules the synchronized web package here for the same 4:00 AM Eastern instant. The next integration step is to use the RSS feed as a release confirmation and source for the final enclosure/player URL.

Megaphone's direct API is only available to enterprise members. If CMA's organization has it enabled, the later integration can use an external episode ID to key the website package and Megaphone episode together:

```dotenv
MEGAPHONE_PODCAST_ID=
MEGAPHONE_API_TOKEN=
```

Until that access is confirmed, this project will not assume the admin can create or schedule Megaphone episodes through an API.

## Apple Shortcuts

The Mac can send an existing transcript directly into the queue:

```http
POST /api/shortcuts/ingest
Content-Type: application/json
X-Admin-Token: <ADMIN_TOKEN when configured>

{
  "title": "Tuesday's show",
  "episodeTitle": "Optional episode title",
  "transcript": "00:00 ...",
  "sourceType": "shortcut",
  "sourceUrl": "optional",
  "airDate": "2026-07-14T08:00:00.000Z",
  "generate": true,
  "provider": "auto"
}
```

A practical Shortcut is: receive a Voice Memo or file → run a local transcription step → “Get Contents of URL” with the JSON above → open `/admin` for review. Keep `generate` false if CMA wants to clean the transcript first.

## Listener map, Discord, and PWA alerts

The public site includes a website-first listener check-in map rendered with MapLibre GL JS. It supports real map tiles, pan/zoom controls, globe view, animated city fly-to, and geographic markers. A check-in stores only the submitted display name, city/town, state/region, city-center coordinates, selected platforms, and time. It never asks for a street address or precise GPS coordinates. Pins change color by listening platform and use a gradient for multi-platform listeners. The same community feed can later power a Twitch overlay.

The demo uses MapLibre's public demonstration globe style and low-volume city lookup. Before audience launch, configure a managed MapTiler/Google Maps style or CMA-hosted tiles:

```dotenv
CMA_MAP_STYLE_URL=https://your-map-provider/style.json
```

Set the official Discord invite when CMA provides it:

```dotenv
CMA_DISCORD_INVITE_URL=https://discord.gg/...
```

The admin includes a plain-language alert composer. New published podcasts and Twitch replays also create automatic alert records. The installed PWA checks the alert feed while open and can show browser notifications after permission is granted. True closed-app Web Push still requires durable subscription storage plus VAPID delivery configuration on the production Vercel project.

Android and supported desktop browsers can use the browser's one-tap install prompt. Apple does not expose an equivalent web API on iPhone/iPad, so the app shows a short Safari Share → Add to Home Screen guide. Once installed, iOS/iPadOS Home Screen web apps can receive standards-based Web Push on supported OS versions.

## API map

- `GET /api/public/content` — published packages only.
- `GET /api/public/community` — listener pins, recent alerts, and the configured Discord invite.
- `POST /api/public/checkins` — privacy-limited city/state listener check-in.
- `POST /api/public/comments` — submit an episode comment into CMA's moderation queue.
- `GET/POST /api/admin/shows` — list/create packages.
- `PATCH /api/admin/shows/:id` — edit the complete package.
- `POST /api/admin/uploads` — private raw media upload.
- `POST /api/admin/alerts` — create a custom listener announcement.
- `GET /api/admin/comments` — comments waiting for CMA review.
- `POST /api/admin/comments/:id/approve|remove` — publish or discard a listener comment.
- `POST /api/admin/shows/:id/download` — download linked media locally.
- `POST /api/admin/shows/:id/transcribe` — local/OpenAI transcription.
- `POST /api/admin/shows/:id/generate` — local/OpenAI/Gemini editorial draft.
- `POST /api/admin/shows/:id/schedule` — synchronized future release.
- `POST /api/admin/shows/:id/publish` — synchronized immediate release.
- `GET /api/admin/twitch/videos` — real Twitch VOD discovery.
- `POST /api/shortcuts/ingest` — automation entry point.

## Production hardening still required

Before the final public launch, add managed identity/MFA, automated volume backups, Megaphone RSS/API release confirmation, and Web Push subscription storage. Before multi-instance deployment, replace the JSON store and in-process timer with a transactional database and durable job queue. The content model and API boundaries are designed so those swaps do not require rebuilding the admin UI.
