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
- Search storage: persistent embedded PostgreSQL (PGlite) with pgvector and PostgreSQL full-text search. A serialized background indexer reconciles the file snapshot at startup, after changes and every 30 seconds. A separate managed Postgres service, durable job queue, users and permissions remain future work.

## V1 scope

V1 loads and reads existing Markdown files. It includes home, a document library, spaces, local full-text filtering, recently opened documents, browser-local bookmarks, source viewing, raw Markdown downloads, deep links, a contents outline, responsive layouts, and light/dark appearance.

There is no editor, document creation API, authentication, standalone chatbot, or simulated user identity. Optional RAG is available exclusively through an Ask AI action in Command K. Bookmarks, reading history, and theme preferences are device-local conveniences, not shared application records. All content and the AI endpoints in this unauthenticated release are accessible to anyone who can reach the server.

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

Heading attributes such as `### Inspect the equipment {#inspect-equipment}` provide stable section and step identifiers. They are stripped from displayed heading text and used by the renderer, outline and retrieval chunks. Keep the explicit ID on rename. The example guides include IDs matching their original anchors. Files without explicit IDs retain title-derived anchors, which change when headings are renamed. Duplicate heading IDs invalidate an update and retain the last good file. Every AI source also includes the current document revision; answers are rejected if the library changes during generation, and the UI marks answers outdated if a cited revision changes.

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

Prepared reading content refreshes independently of slower chunking and embedding. The current RAG path is implemented in `server/chunks.ts`, `server/ai-store.ts`, `server/ai-providers.ts` and `server/ai.ts`:

1. Parse Markdown blocks using the same heading IDs as the reader. Chunk at section/step boundaries, with a roughly 2,000-character body budget and block-preserving splits when possible. Include title, space, tags, section and step context in the embedded input. Frontmatter values outside the selected metadata never enter the embedding input.
2. Atomically project the current library to `knowledge_chunks`. Rows carry document and chunk IDs, revision, current source anchor, step order, input hash, model/settings signature, text, full-text index and optional vector. Unchanged input hashes and signatures reuse vectors; deleted chunks are removed. Startup and periodic reconciliation make pending work recoverable after crashes without a separate queue. The worker serializes and coalesces snapshot updates, batches up to 16 embeddings, and retries failed indexing on the next reconciliation. Only one process can own the PGlite directory.
3. Embed through OpenRouter with Qwen3 Embedding 8B at 1,024 dimensions by default, using a retrieval instruction for Qwen queries. Validate response indices, vector dimensions and finite/nonzero values; normalize vectors. A signature change invalidates old embeddings. Require providers that deny data collection; secrets and upstream error bodies never reach the browser or logs.
4. On explicit Ask AI, first check a conservative local full-text fast path. A process qualifies only if it has at most 10 chunks, includes every non-stopword query lexeme, and at least two query lexemes match its title (one for a one-lexeme query). Exactly one process must qualify. Retrieve that entire process, preserving prerequisites and order without a remote query embedding. Otherwise embed the question and combine exact cosine retrieval (initial cutoff 0.35) with PostgreSQL full-text matching using reciprocal rank fusion. Add adjacent chunks, bounded to 10 passages. Cache up to 256 query vectors in memory for retry speed and prefer low-latency OpenRouter providers subject to the same privacy constraint. Exact vector search is appropriate for this modest library; larger libraries need benchmarking and potentially an approximate index or managed Postgres. Ordinary Command K filtering remains local and immediate, with no AI request while typing.
5. Send the question and retrieved text directly to Inception's Mercury 3 API, using `instant` reasoning, temperature 0.5, a 1,200-token output budget and a concise-answer instruction. Require strict structured output: answerable plus plain-text paragraphs with numeric citation IDs. Validate all IDs against supplied passages and abstain when retrieval or generation cannot answer. Cache only valid positive answers for five minutes, bounded to 128 entries. The cache key includes exact question, model and library revision; projection refreshes clear it. Return copies so callers cannot mutate cached answers. No tools, browsing or generated external links are involved. Model instructions cannot guarantee factual accuracy.
6. Show immediate loading feedback within Command K. Clients requesting `Accept: application/x-ndjson` receive flushed progress events, retrieved source metadata, then one complete validated answer (or a sanitized error). Never render partial provider JSON or unvalidated generated text. Existing JSON clients still work. Source links can be opened while Mercury is answering. Closing, editing the question, returning to results or cancelling aborts the client fetch; disconnects abort provider work. No questions, answers or query cache are persisted. The server limits request size, per-IP frequency and concurrent generation, and applies timeouts and bounded retries upstream. Responses report retrieval/generation/total durations and cache hits in `timing`; JSON responses also set `Server-Timing`. The UI records `kmflow:ai-answer` Performance entries. The targets are feedback within 500 ms and answers around one second; remote embedding/generation latency prevents a universal cold-answer guarantee.

Both API keys are optional server-only environment settings. Without them, ordinary search and reading work and Ask AI explains the missing configuration. `/api/ai/status` reports readiness and `/api/ai/ask` performs retrieval and generation. Reading remains available while indexing; Ask AI requires the complete current revision. Current content is all public to the server's audience. Permissions and published revision visibility must be applied before retrieved content reaches a model when authentication is introduced. Linked images and PDFs are not included in this text-only index.

## Deployment

Development runs Vite on port 5173, proxying `/api` to Fastify on 3001. Production builds the frontend and serves the application plus API from one Fastify process. Configure `PORT` and `CONTENT_DIR` through environment variables. AI uses `OPENROUTER_API_KEY`, `INCEPTION_API_KEY` (alias `INCEPTION_LABS_API_KEY`), `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`, `INCEPTION_MODEL` and `AI_DATA_DIR`. Defaults are documented in `.env.example`. Restart after changing environment settings. Keep content and the optional AI index on persistent storage, independently of disposable build output; only one server process may use a given index directory. No standalone database service is required.

The initial deployment is one server owning one content directory. Multiple instances, remote Git synchronisation, multi-user editing, publication workflows, and offline guarantees require additional design. Git can provide external version history, but V1 does not create commits or run Git synchronisation.

## Validation

Run `npm run check`, `npm test`, and `npm run build`. Test Markdown ingestion and sanitisation, frontmatter defaults, heading anchors, duplicate IDs, filesystem confinement, invalid-file recovery, and API behaviour. Browser checks cover routes/deep links, search, bookmarks/history, source/download, appearance, small screens, external file changes, and measured navigation against the 200 ms budget.
