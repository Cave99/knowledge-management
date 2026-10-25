<img src="public/logo.svg" width="72" alt="KM flow">

# KM flow

A shared home for your team's operational knowledge. Real Markdown files, a focused reader, and fast navigation.

KM flow reads Markdown files. It includes spaces, document browsing, full-text filtering, search (`⌘K` / `Ctrl K`), a contents sidebar, source viewing and downloads, browser-local bookmarks and recent history, and light/dark appearance. Optional Ask AI answers questions inside the search menu using your knowledge library. There is no editor or authentication; ordinary reading and search require no database or AI service.

## Run locally

Requires Node.js 22.12 or later.

```sh
npm install
npm run dev
```

Open <http://localhost:5173>. Vite runs on 5173 and proxies the Fastify API on 3001.

## Load your existing files

The included `knowledge/` directory contains eight example Markdown documents adapted from the supplied demo. Add or replace `.md` files there, or point the application at another directory:

```sh
CONTENT_DIR=/absolute/path/to/your/markdown npm run dev
```

You can also copy `.env.example` to `.env` and set `CONTENT_DIR`. Restart after changing environment settings. File additions, updates, and deletions refresh the running library automatically; a periodic rescan catches missed filesystem events.

Each document can optionally start with YAML:

```markdown
---
id: opening-procedure
title: Opening procedure
description: Prepare the site for the morning shift.
space: Guides & Playbooks
author: Operations team
updated_at: 2026-10-25
pinned: true
tags: [daily, operations]
---

## Before opening

### Check the handover

Read the previous shift's notes.
```

Missing metadata falls back to the filename, folder, and filesystem modification date. Relative Markdown links open matching documents. Local images and PDFs are supported inside the content directory. HTML is escaped and content is sanitised. Invalid updates show diagnostics and preserve the last valid version until corrected. Symlinks are not indexed.

## Ask AI in Command K

Copy `.env.example` to `.env` and fill in `OPENROUTER_API_KEY` and `INCEPTION_API_KEY`. Restart `npm run dev` (or `npm start`) after changing these settings. `INCEPTION_LABS_API_KEY` is also accepted as an alias. Both keys stay on the server; never prefix them with `VITE_`.

Open `⌘K` / `Ctrl K`, type a question, then select **Ask AI** at the bottom of the results. The action appears for every nonempty search, including zero matches. Use the arrow keys and Enter, or click it. Answers, source links, loading, cancellation, retry and missing-answer states all live inside this dialog. Typing a different query or closing the dialog cancels the current request. There is no separate AI page or chat widget.

OpenRouter generates embeddings with `qwen/qwen3-embedding-8b` at 1,024 dimensions by default. Mercury 3 generates answers directly through `https://api.inceptionlabs.ai/v1/chat/completions`, using `mercury-3`; generation does not go through OpenRouter. The model names and embedding dimensions can be overridden in `.env`. Embedding requests deny providers that collect data; changing a model still requires reviewing that provider's terms. The selected embedding model/provider must support the configured output dimensions. Changing the embedding model, dimensions, or chunking version automatically rebuilds embeddings.

For low latency, a local fast path retrieves a complete short process when all non-stopword query terms are present, the title clearly names the topic, and exactly one process qualifies. This avoids a remote query-embedding call without dropping process steps. Ambiguous, indirect, long-process and cross-process questions keep the semantic/keyword retrieval path. Mercury uses `instant` reasoning, a 1,200-token output budget and concise answers. OpenRouter prefers low-latency embedding providers while preserving the data-collection restriction. These reduce latency but cannot guarantee sub-second completion from external services.

Command K shows feedback immediately and streams the retrieved source links while the answer is prepared. It displays generated prose only after the whole structured answer and citations pass validation. Valid answers have a bounded, five-minute memory cache (128 entries), keyed by the exact question, model and current library revision; document changes clear the cache. Up to 256 query vectors are also held in memory to speed retries. Nothing is prefetched while typing, and neither cache is written to disk. The API includes timing measurements in `timing`; ordinary JSON clients also receive `Server-Timing`, and the browser records `kmflow:ai-answer` Performance entries.

The first configured startup builds a persistent **Postgres + pgvector** index using PGlite at `AI_DATA_DIR` (default `./.data/ai`). No separate database service is needed. Run one server process per index directory; a filesystem lock prevents a second owner. Keep this directory on persistent storage. Stop the server before deleting it to rebuild the derived index. Markdown files remain authoritative and are never changed by the indexer.

Indexing runs in the background at startup and after file changes, with a 30-second reconciliation/retry interval. It batches embeddings, reuses unchanged chunks, removes deleted steps and documents, and blocks answers until the current library revision is indexed. Reading and ordinary search stay available during indexing and provider outages. `GET /api/ai/status` reports readiness and progress without exposing credentials.

Processes are chunked at `##` sections and `###` steps. Each embedding includes the process title, space, tags and section/step context. Lists, tables, code and warnings stay together where they fit; oversized blocks are split to a roughly 2,000-character body budget. Retrieval combines Postgres full-text matches and vector similarity using reciprocal rank fusion, then includes neighboring steps. The initial vector similarity cutoff is 0.35; tune retrieval against representative staff questions before expanding the library. This is text retrieval: linked images and PDFs are not OCR'd or embedded.

Stable section and step IDs use ordinary Markdown heading attributes:

```markdown
## Before opening {#before-opening}

### Inspect the equipment {#inspect-equipment}
```

Keep `{#inspect-equipment}` when renaming the heading so source links stay valid. IDs must start with a letter and contain only letters, numbers, underscores or hyphens; each must be unique within its document. The example guides already include IDs matching their existing anchors. Files without explicit IDs still work with title-derived anchors, which change on rename. Set an explicit frontmatter `id` to keep the document identity stable across file moves.

Mercury receives only the question and retrieved passages. It is instructed to abstain when information is missing and to cite supplied sources for every answer paragraph. The server validates structured output and citation IDs; the UI renders plain text and source links created from library records. These checks do not guarantee factual correctness: open the original guide before acting. Answers are discarded if the library changes while generating and marked outdated if their cited document changes while displayed. Questions and answers are not stored as conversation history.

The ask endpoint accepts questions up to 2,000 characters, allows two concurrent answers per server, and limits each client IP to 12 requests per minute. **This release has no authentication**, including on the AI endpoints. Limit access to the server to the intended audience; authentication and permissions remain future work.

Provider references: [OpenRouter embeddings](https://openrouter.ai/docs/api_reference/embeddings), [Inception quick start](https://docs.inceptionlabs.ai/get-started), [structured outputs](https://docs.inceptionlabs.ai/capabilities/structured-outputs), [PGlite](https://pglite.dev/docs/) and [pgvector](https://github.com/pgvector/pgvector).

## Production

```sh
npm run build
npm start
```

Fastify serves both the built frontend and API on <http://localhost:3001>. Set `PORT` to change the production port. Keep the knowledge directory on persistent storage. This release has no authentication: every indexed document is readable by anyone who can access the server.

## Checks

```sh
npm run check
npm test
npm run build
```

The complete V1 library loads into the browser once, including prepared HTML, so subsequent navigation does not fetch or compile individual documents. This approach is intended for modest team libraries. See [architecture.md](architecture.md) for the 200 ms navigation target, first-load limitations, scaling path, file contract, and future editor/retrieval design.

The original demo's WebGL logo animation is loaded only when replayed using the button beside the library status. It respects reduced motion and never blocks startup.
