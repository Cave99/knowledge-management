<img src="public/logo.svg" width="72" alt="KM flow">

# KM flow

A shared home for your team's operational knowledge. Real Markdown files, a focused reader, and fast navigation.

V1 is read-only. It includes spaces, document browsing, full-text filtering, search (`⌘K` / `Ctrl K`), a contents sidebar, source viewing and downloads, browser-local bookmarks and recent history, and light/dark appearance. It has no editor, authentication, database, or AI service requirement.

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
