# KM flow architecture

## Product and principles

KM flow is an open-source knowledge management application for operations teams. Each complete document is a real UTF-8 Markdown file. YAML frontmatter describes the document; Markdown headings describe its sections and steps. Humans, external editors, and AI agents can all work with the same portable format.

The application follows the supplied KM flow demo: warm neutral surfaces, orange brand colour, workspace navigation, spaces, document cards, a focused reading view, and a contents sidebar. Frequent actions respond immediately. The original logo animation is available as an optional replay and never gates access to knowledge.

## Agreed technology

- Frontend: React and TypeScript, built with Vite. No full-stack React framework or server rendering is required for this workspace.
- Navigation: TanStack Router, keeping the application shell mounted.
- Server data: TanStack Query, caching library snapshots and refreshing them in the background.
- Backend: Fastify on Node.js, sharing TypeScript contracts with the frontend.
- Content: actual `.md` files in a configurable directory, mounted as a persistent volume when deployed.
- Future editing: Tiptap's MIT-licensed editor and Markdown package, using only free open-source dependencies. Preserve licence notices and verify each added extension's licence. Paid Tiptap services are not required.
- Future storage/search: PostgreSQL for application data and derived content, PostgreSQL full-text search plus pgvector for retrieval, and a background worker with a Postgres-backed queue.

## V1 scope

V1 loads and reads existing Markdown files. It includes home, a document library, spaces, local full-text filtering, recently opened documents, browser-local bookmarks, source viewing, raw Markdown downloads, deep links, a contents outline, responsive layouts, and light/dark appearance.

There is no editor, document creation API, authentication, database, embeddings, RAG, chatbot, or simulated user identity. Bookmarks, reading history, and theme preferences are device-local conveniences, not shared application records. All content served by this unauthenticated release is accessible to anyone who can reach the server.

## Markdown contract

```markdown
---
id: opening-procedure
title: Opening procedure
description: Prepare the site for the morning shift.
space: Guides & Playbooks
author: Operations team
updated_at: 2026-10-25T08:30:00Z
pinned: true
tags: [daily, operations]
---

## Before opening

### Check the handover

Read the previous shift's notes.

### Inspect the equipment

Record any faults before opening.
```

`##` headings represent sections and `###` headings represent steps. V1 reads conventional Markdown without enforcing that hierarchy; existing notes remain usable. Supported content includes headings, paragraphs, emphasis, links, lists, code blocks, tables, blockquotes, and images. Raw HTML is disabled and rendered output is sanitised. Relative Markdown links resolve to application documents; local images resolve within the content directory. External images require network access.

All metadata is optional. Title falls back to the first H1 or filename; space to the containing folder (or General); ID to the relative path without extension; author to Team; edit date to filesystem mtime. A leading H1 matching the document title is omitted from the rendered body. Explicit IDs must be unique and remain stable when a file moves. Invalid YAML or conflicting IDs are reported as diagnostics. Invalid updates retain the last valid document while a diagnostic is present.

Stable step identifiers are required before editing and AI citations ship. V1 heading anchors are derived from text and may change when headings are renamed. That limitation is explicit rather than promising stable citations prematurely.

## V1 read path

The backend recursively reads `CONTENT_DIR` (default `./knowledge`), parses frontmatter, compiles Markdown to sanitised HTML and an outline, and builds an immutable library snapshot in memory. Symlinks are not followed. The server never compiles Markdown as part of a document navigation request.

`GET /api/library` returns the complete snapshot with an ETag and compression. The browser loads it once using TanStack Query. Routes select already-loaded documents synchronously, with no per-document network dependency. The reader renders prepared HTML. Source Markdown is available in the snapshot and from a read-only download endpoint.

This deliberately favours small initial team libraries. It transfers all document bodies, including source and prepared HTML, on first load. It is not an unbounded scaling strategy. At larger sizes, replace the full snapshot with a metadata manifest, versioned per-document responses, bounded prefetching, and optional persistent local caching. Benchmark before setting that threshold.

Chokidar watches file creation, changes, moves, and deletion. A periodic rescan reconciles missed events. Rebuilds are serialised and published atomically so readers never see a partial snapshot. Server-sent events notify clients when a snapshot changes; reconnect and focus refresh recover missed notifications. Existing content remains visible during refresh.

Content assets are read through a directory-confined endpoint with an extension allowlist and realpath checks. Metadata dates and IDs are normalised. The app has explicit loading, empty, invalid-file, missing-document, and server-error states.

## Performance contract

The product requirement is under 200 ms from navigation input to usable destination content. An empty shell or spinner does not count. The persistent shell, precompiled content, and complete V1 client snapshot remove network and compilation work from navigation after bootstrap. No route entry animation delays reading. Pointer-driven page changes may settle from a 3px offset over 180 ms, with the entire destination already mounted, fully opaque, readable, and interactive. There is no outgoing-page wait. Keyboard navigation, heading deep links, and search stay immediate. Production navigation measurements use two animation frames after the destination commits; results are exposed as Performance entries named `kmflow:navigation`. This measures usability, not animation completion.

Motion uses existing CSS easing tokens and native Web Animations, with no new dependency, animation loop, or permanent compositing hints. Mobile navigation animates its panel and scrim explicitly (180 ms entrance, 140 ms exit), keeping the native dialog mounted until the exit completes so mobile browser support for discrete CSS transitions is not required. Native focus trapping remains active during this brief exit; focus returns when it closes. Escape and scrim dismissal use the same exit path. Reduced-motion settings bypass these animations. Bookmark and copy feedback take 120–160 ms; fine-pointer card arrows move only 2px. Frequent keyboard navigation and search remain immediate. Rapid navigation cancels the previous page animation, and no stagger hides document text or controls.

Cold startup includes network transfer, JavaScript startup, and the initial library fetch. A universal 200 ms cold-start guarantee is not possible across arbitrary networks and devices. Acceptance testing must identify device, browser, document size, network conditions, and cache state. Any navigation exceeding 200 ms under the agreed operating conditions is a failure to investigate. Images may load independently; the measured destination is usable text and controls.

The brand renderer is dynamically imported only on explicit replay, excluded from the critical path, respects reduced motion, and releases its animation resources on completion or dismissal. React is the UI runtime; avoid adding a general motion framework for simple interactions.

## Future write and retrieval path

Files remain authoritative. The database becomes a derived document/search projection alongside durable application records such as users and permissions; rebuilding content indexes must never discard those records.

Both human and AI edits will validate the same format, check an expected content hash, write a complete file atomically, and schedule projection updates. Conflicting versions must be surfaced, not silently overwritten. File changes made outside the application are reconciled through the same ingestion pipeline. Filesystem and database updates are not one transaction: use durable job tracking and reconciliation before introducing writes.

Prepared reading content and keyword indexes refresh independently of slower chunking and embedding. Chunk primarily at step boundaries, retain document/section context, and cite stable step IDs. Search combines keyword and semantic matching. Permissions and published revision visibility must apply before retrieved content reaches an AI model. No implementation of these future components is needed for V1.

## Deployment

Development runs Vite on port 5173, proxying `/api` to Fastify on 3001. Production builds the frontend and serves the application plus API from one Fastify process. Configure `PORT` and `CONTENT_DIR` through environment variables; a database is not needed. Keep content on persistent storage, independently of disposable build output.

The initial deployment is one server owning one content directory. Multiple instances, remote Git synchronisation, multi-user editing, publication workflows, and offline guarantees require additional design. Git can provide external version history, but V1 does not create commits or run Git synchronisation.

## Validation

Run `npm run check`, `npm test`, and `npm run build`. Test Markdown ingestion and sanitisation, frontmatter defaults, heading anchors, duplicate IDs, filesystem confinement, invalid-file recovery, and API behaviour. Browser checks cover routes/deep links, search, bookmarks/history, source/download, appearance, small screens, external file changes, and measured navigation against the 200 ms budget.
