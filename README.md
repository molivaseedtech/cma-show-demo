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

Open `http://127.0.0.1:4173/admin`. The server has no runtime package dependencies and requires Node 22 or newer.

On localhost, admin access works without a token. Before exposing the server to another device or the internet, set a strong `ADMIN_TOKEN`; remote admin requests are rejected when no token is configured.

## Editorial workflow

1. Create one **show package** the night before.
2. Attach a Twitch VOD, upload media, link a source, or paste a transcript from an Apple Shortcut.
3. Transcribe in `Auto` mode. It tries the M4 first and OpenAI second.
4. Generate the editorial package. `Auto` tries local Ollama, OpenAI, then Gemini.
5. Edit the blog, episode title, excerpt, chapters, links, named mentions, quote, and media destinations.
6. Complete all four human-review checks.
7. Set 4:00 AM once. The blog, episode page, chapters, links, mentions, and media references become public in one atomic publish operation.

AI never publishes by itself. A draft cannot be scheduled until the blog, chapters, links/mentions, and media destinations are separately approved.

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

## API map

- `GET /api/public/content` — published packages only.
- `GET/POST /api/admin/shows` — list/create packages.
- `PATCH /api/admin/shows/:id` — edit the complete package.
- `POST /api/admin/uploads` — private raw media upload.
- `POST /api/admin/shows/:id/download` — download linked media locally.
- `POST /api/admin/shows/:id/transcribe` — local/OpenAI transcription.
- `POST /api/admin/shows/:id/generate` — local/OpenAI/Gemini editorial draft.
- `POST /api/admin/shows/:id/schedule` — synchronized future release.
- `POST /api/admin/shows/:id/publish` — synchronized immediate release.
- `GET /api/admin/twitch/videos` — real Twitch VOD discovery.
- `POST /api/shortcuts/ingest` — automation entry point.

## Production hardening still required

The current persistence and scheduler are deliberately suited to one always-on M4 Mac. Before multi-instance cloud deployment, replace the JSON store and in-process timer with a transactional database and durable job queue, put `/admin` behind managed identity/MFA, add backups, configure HTTPS, connect Megaphone RSS/API release confirmation, and add Web Push subscription storage. The content model and API boundaries are designed so those swaps do not require rebuilding the admin UI.
