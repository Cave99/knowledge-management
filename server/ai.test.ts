import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chunkDocument } from "./chunks";
import { loadLibrary } from "./library";
import { AiStore } from "./ai-store";
import { aiConfig, AiError, AiProviders, type AiConfig } from "./ai-providers";
import { RagService } from "./ai";

const signal = () => new AbortController().signal;
const config = (dataDir = ""): AiConfig => ({
  openRouterKey: "test-router",
  inceptionKey: "test-inception",
  embeddingModel: "qwen/qwen3-embedding-8b",
  embeddingDimensions: 32,
  inceptionModel: "mercury-3",
  dataDir,
});
const axis = (i: number) =>
  Array.from({ length: 32 }, (_, n) => Number(n === i));
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const completion = (answerable: boolean, paragraphs: unknown[] = []) =>
  json({
    choices: [
      {
        finish_reason: "stop",
        message: { content: JSON.stringify({ answerable, paragraphs }) },
      },
    ],
  });

const handover = `---
id: handover
title: Shift handover
tags: [daily]
secret_metadata: never-embed-this
---
## Before {#before}
General preparation for the shift handover.
### Review open work {#review}
Check unfinished jobs and update the shared record.
### Identify unusual issues {#issues}
Give each equipment issue a clear owner.
## During {#during}
### Cover essentials {#essentials}
| Topic | Include |
| --- | --- |
| Open issues | Impact, owner, next action |

1. Share priorities.
2. Confirm the next action.
`;

async function fixture(
  run: (root: string) => Promise<void>,
  source = handover,
) {
  const root = await mkdtemp(path.join(tmpdir(), "kmflow-ai-"));
  try {
    await writeFile(path.join(root, "guide.md"), source);
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("chunks real process steps, keeps tables/lists, excludes YAML and preserves explicit IDs", async () => {
  await fixture(async (root) => {
    const library = await loadLibrary(root);
    const doc = library.documents[0];
    const chunks = chunkDocument(doc);
    assert.equal(chunks.length, 4);
    assert.deepEqual(
      chunks.map((c) => c.anchor),
      ["before", "review", "issues", "essentials"],
    );
    assert.match(
      chunks[1].input,
      /Process: Shift handover[\s\S]*Section: Before[\s\S]*Step: Review open work/,
    );
    assert.doesNotMatch(
      chunks.map((c) => c.input).join(""),
      /never-embed-this|\{#review\}/,
    );
    assert.match(
      chunks[3].body,
      /\| Open issues \| Impact, owner, next action \|/,
    );
    assert.match(chunks[3].body, /1\. Share priorities\.\n2\. Confirm/);
    assert.match(doc.html, /<h3 id="review">Review open work<\/h3>/);
    await writeFile(
      path.join(root, "guide.md"),
      handover.replace("Review open work", "Inspect outstanding work"),
    );
    const changed = (await loadLibrary(root)).documents[0];
    assert.equal(chunkDocument(changed)[1].id, chunks[1].id);
    assert.match(changed.html, /id="review">Inspect outstanding work/);
  });
});

test("handles overview-only, setext headings, fences and oversized blocks without losing content", async () => {
  await fixture(async (root) => {
    let doc = (await loadLibrary(root)).documents[0];
    assert.equal(chunkDocument(doc)[0].anchor, "");
    assert.match(chunkDocument(doc)[0].body, /An overview/);
    await writeFile(
      path.join(root, "guide.md"),
      "Section\n-------\n\n```md\n### Not a step\n```\n\n### Actual step\n\n" +
        "word ".repeat(1500),
    );
    doc = (await loadLibrary(root)).documents[0];
    const chunks = chunkDocument(doc);
    assert.equal(chunks[0].section, "Section");
    assert.match(chunks[0].body, /### Not a step/);
    const long = chunks.filter((c) => c.step === "Actual step");
    assert.ok(long.length > 1);
    assert.ok(long.every((c) => c.body.length <= 2000));
    assert.equal(
      long
        .map((c) => c.body)
        .join(" ")
        .match(/word/g)?.length,
      1500,
    );
  }, "# Example\n\nAn overview without steps.\n");
});

test("duplicate explicit heading IDs produce a diagnostic and retain the last valid file", async () => {
  await fixture(async (root) => {
    const good = await loadLibrary(root);
    await writeFile(
      path.join(root, "guide.md"),
      "## First {#same}\nOne\n## Second {#same}\nTwo",
    );
    const next = await loadLibrary(root, good);
    assert.match(next.diagnostics[0].message, /Duplicate heading ID/);
    assert.equal(next.documents[0].version, good.documents[0].version);
  });
});

test("frontmatter with a BOM, CRLF or padded delimiters is never embedded", async () => {
  await fixture(
    async (root) => {
      const library = await loadLibrary(root);
      assert.equal(library.diagnostics.length, 0);
      const chunks = chunkDocument(library.documents[0]);
      assert.ok(chunks.length);
      assert.doesNotMatch(
        chunks.map((chunk) => chunk.input).join(""),
        /never-embed-this/,
      );
    },
    "\uFEFF" + handover.replace(/^---/, "---  ").replaceAll("\n", "\r\n"),
  );
});

test("chunk source anchors exactly match the reader when a section repeats the document title", async () => {
  await fixture(async (root) => {
    const doc = (await loadLibrary(root)).documents[0];
    const chunks = chunkDocument(doc);
    assert.deepEqual(
      chunks.map((chunk) => chunk.anchor),
      ["", "example", "example-1"],
    );
    for (const chunk of chunks)
      assert.ok(
        !chunk.anchor ||
          doc.headings.some((heading) => heading.id === chunk.anchor),
      );
  }, "# Example\n\nOverview text.\n\n## Example\n\nSection text.\n\n## Example\n\nAnother section.");
});

test("automatic heading slugs cannot take an explicit stable ID", async () => {
  await fixture(async (root) => {
    const library = await loadLibrary(root);
    assert.equal(library.diagnostics.length, 0);
    const ids = library.documents[0].headings.map((heading) => heading.id);
    assert.deepEqual(ids, ["review-1", "review", "review-2"]);
  }, "## Review\n\nOne\n\n## Stable step {#review}\n\nTwo\n\n## Review\n\nThree");
});

test("persists vectors, reuses unchanged embeddings, removes deleted chunks and invalidates model changes", async () => {
  await fixture(async (root) => {
    const dir = path.join(root, "index");
    const chunks = chunkDocument((await loadLibrary(root)).documents[0]);
    let store = await AiStore.open(dir);
    try {
      await store.sync(chunks, "model-a");
      await store.saveEmbeddings(
        chunks,
        chunks.map(() => axis(0)),
        "model-a",
      );
      assert.deepEqual(await store.counts("model-a"), { total: 4, indexed: 4 });
      await assert.rejects(() => AiStore.open(dir), /lock/i);
    } finally {
      await store.close();
    }
    store = await AiStore.open(dir);
    try {
      await store.sync(
        chunks.map((c) => ({ ...c, revision: "metadata-change" })),
        "model-a",
      );
      assert.equal((await store.pending("model-a")).length, 0);
      const updated = chunks.slice(0, 2).map((c, i) =>
        i
          ? {
              ...c,
              body: "New instruction",
              input: "New instruction",
              contentHash: "changed",
            }
          : c,
      );
      await store.sync(updated, "model-a");
      assert.deepEqual(await store.counts("model-a"), { total: 2, indexed: 1 });
      assert.equal((await store.pending("model-a"))[0].id, chunks[1].id);
      await store.saveEmbeddings([chunks[1]], [axis(1)], "model-a");
      assert.equal(
        (await store.pending("model-a")).length,
        1,
        "stale embedding response cannot overwrite changed text",
      );
      await store.sync(updated, "model-b");
      assert.deepEqual(await store.counts("model-b"), { total: 2, indexed: 0 });
      assert.deepEqual(await store.search("handover", axis(0), "model-a"), []);
      await store.sync([], "model-b");
      assert.deepEqual(await store.counts("model-b"), { total: 0, indexed: 0 });
    } finally {
      await store.close();
    }
  });
});

test("OpenRouter batches honor response indices, privacy filtering, dimensions and query instructions", async () => {
  let calls = 0;
  const providers = new AiProviders(config(), async (url, init) => {
    assert.equal(url, "https://openrouter.ai/api/v1/embeddings");
    assert.equal(
      (init?.headers as Record<string, string>).Authorization,
      "Bearer test-router",
    );
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.provider, {
      data_collection: "deny",
      sort: "latency",
    });
    assert.equal(body.dimensions, 32);
    if (calls++ === 0)
      return json({
        data: [
          { index: 1, embedding: axis(1) },
          { index: 0, embedding: axis(0) },
        ],
      });
    assert.match(body.input[0], /^Instruct:.*\nQuery: Question/);
    return json({ data: [{ index: 0, embedding: axis(0) }] });
  });
  assert.deepEqual(await providers.embed(["One", "Two"], signal()), [
    axis(0),
    axis(1),
  ]);
  await providers.embed(["Question"], signal(), true);
  const invalid = new AiProviders(config(), async () =>
    json({ data: [{ index: 0, embedding: [0, 0] }] }),
  );
  await assert.rejects(
    () => invalid.embed(["One"], signal()),
    /incompatible vectors/,
  );
});

test("Mercury uses Inception directly and rejects nonexistent citations or truncated answers", async () => {
  const providers = new AiProviders(config(), async (url, init) => {
    assert.equal(url, "https://api.inceptionlabs.ai/v1/chat/completions");
    assert.equal(
      (init?.headers as Record<string, string>).Authorization,
      "Bearer test-inception",
    );
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "mercury-3");
    assert.equal(body.reasoning_effort, "instant");
    assert.equal(body.temperature, 0.5);
    assert.equal(body.max_completion_tokens, 1200);
    assert.equal(body.response_format.type, "json_schema");
    assert.equal(body.response_format.json_schema.strict, true);
    return completion(true, [{ text: "Grounded answer", sources: [2] }]);
  });
  await assert.rejects(
    () => providers.answer("Question", [{ id: 1 }], signal()),
    /supported answer/,
  );
  const truncated = new AiProviders(config(), async () =>
    json({
      choices: [{ finish_reason: "length", message: { content: "{}" } }],
    }),
  );
  await assert.rejects(
    () => truncated.answer("Question", [], signal()),
    /incomplete/,
  );
  const malformed = new AiProviders(config(), async () =>
    completion(true, [null]),
  );
  await assert.rejects(
    () => malformed.answer("Question", [{}], signal()),
    /supported answer/,
  );
});

test("the local fast path requires complete query coverage, an unambiguous title and a short complete process", async () => {
  await fixture(async (root) => {
    const chunks = chunkDocument((await loadLibrary(root)).documents[0]);
    const store = await AiStore.open();
    try {
      await store.sync(chunks, "test");
      assert.equal(
        (
          await store.fastMatches(
            "What should I review before a shift handover?",
            "test",
          )
        ).length,
        chunks.length,
      );
      assert.equal(
        (
          await store.fastMatches(
            "What is the annual budget for the shift handover?",
            "test",
          )
        ).length,
        0,
      );
      assert.equal(
        (await store.fastMatches("How should we handle a changeover?", "test"))
          .length,
        0,
      );
      const other = chunks.map((chunk) => ({
        ...chunk,
        id: chunk.id + "other",
        documentId: "other",
      }));
      await store.sync([...chunks, ...other], "test");
      assert.equal(
        (await store.fastMatches("shift handover", "test")).length,
        0,
        "ambiguous titles fall back to semantic search",
      );
      await store.sync(
        Array.from({ length: 11 }, (_, i) => ({
          ...chunks[0],
          id: `long-${i}`,
          position: i,
        })),
        "test",
      );
      assert.equal(
        (await store.fastMatches("shift handover", "test")).length,
        0,
        "long processes use normal retrieval",
      );
    } finally {
      await store.close();
    }
  });
});

test("fast answers skip query embedding, cache only validated results and invalidate on library changes", async () => {
  await fixture(async (root) => {
    let library = await loadLibrary(root);
    let queries = 0;
    let generated = 0;
    let fail = false;
    const rag = new RagService(
      config(path.join(root, "index")),
      () => library,
      () => {},
      async (url, init) => {
        const body = JSON.parse(String(init?.body));
        if (String(url).includes("openrouter")) {
          if (body.input[0].startsWith("Instruct:")) queries++;
          return json({
            data: body.input.map((_: string, index: number) => ({
              index,
              embedding: axis(0),
            })),
          });
        }
        generated++;
        if (fail) return json({}, 401);
        return completion(true, [
          { text: "Review open work and assign an owner.", sources: [1] },
        ]);
      },
    );
    try {
      await rag.refresh();
      const progress: string[] = [];
      const first = await rag.ask(
        "What should I review before a shift handover?",
        signal(),
        (event) => progress.push(event.phase),
      );
      assert.deepEqual(progress, ["searching", "answering"]);
      assert.equal(first.timing?.retrieval, "keyword");
      assert.equal(queries, 0);
      const cached = await rag.ask(
        "What should I review before a shift handover?",
        signal(),
      );
      assert.equal(cached.timing?.cacheHit, true);
      assert.equal(generated, 1);
      cached.paragraphs[0].text = "Mutated caller data";
      assert.notEqual(
        (
          await rag.ask(
            "What should I review before a shift handover?",
            signal(),
          )
        ).paragraphs[0].text,
        "Mutated caller data",
      );
      await writeFile(
        path.join(root, "guide.md"),
        handover.replace("Check unfinished jobs", "Check all unfinished jobs"),
      );
      library = await loadLibrary(root);
      await rag.refresh();
      assert.equal(
        (
          await rag.ask(
            "What should I review before a shift handover?",
            signal(),
          )
        ).timing?.cacheHit,
        false,
      );
      assert.equal(generated, 2);
      // The query vector is reusable even when a previous generation failed.
      fail = true;
      await assert.rejects(
        () => rag.ask("changeover", signal()),
        /key was rejected/,
      );
      fail = false;
      assert.equal(
        (await rag.ask("changeover", signal())).timing?.cacheHit,
        false,
      );
      assert.equal(queries, 1);
      const cancelled = new AbortController();
      cancelled.abort();
      await assert.rejects(
        () =>
          rag.ask(
            "What should I review before a shift handover?",
            cancelled.signal,
          ),
        { name: "AbortError" },
      );
    } finally {
      await rag.close();
    }
  });
});

test("provider errors are sanitized, transient failures retry and cancellation stops requests", async () => {
  const rejected = new AiProviders(config(), async () =>
    json({ error: "secret echoed by upstream" }, 401),
  );
  await assert.rejects(
    () => rejected.embed(["One"], signal()),
    (error: unknown) =>
      error instanceof AiError &&
      /key was rejected/.test(error.message) &&
      !error.message.includes("secret"),
  );
  let calls = 0;
  const retry = new AiProviders(config(), async () =>
    ++calls === 1
      ? json({}, 503)
      : json({ data: [{ index: 0, embedding: axis(0) }] }),
  );
  await retry.embed(["One"], signal());
  assert.equal(calls, 2);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(() => retry.embed(["One"], abort.signal), {
    name: "AbortError",
  });
  assert.equal(calls, 2);
});

test("rendered citations do not duplicate Mercury's parenthesized source labels", async () => {
  const providers = new AiProviders(config(), async () =>
    completion(true, [
      {
        text: "Set the dial to position (2), then review the record (source 1).",
        sources: [1],
      },
    ]),
  );
  const answer = await providers.answer("Question", [{ id: 1 }], signal());
  assert.equal(
    answer.paragraphs[0].text,
    "Set the dial to position (2), then review the record.",
  );
});

test("RAG retrieves semantic paraphrases with neighbors, cites current steps, abstains and reindexes incrementally", async () => {
  await fixture(async (root) => {
    let library = await loadLibrary(root);
    let embedded = 0;
    let generated = 0;
    let answerable = true;
    let changeDuringAnswer = false;
    const rag = new RagService(
      config(path.join(root, "index")),
      () => library,
      () => {},
      async (url, init) => {
        const body = JSON.parse(String(init?.body));
        if (String(url).includes("openrouter")) {
          if (!body.input[0].startsWith("Instruct:"))
            embedded += body.input.length;
          return json({
            data: body.input.map((text: string, index: number) => ({
              index,
              embedding: axis(/handover|changeover/i.test(text) ? 0 : 2),
            })),
          });
        }
        generated++;
        const context = JSON.parse(body.messages[1].content);
        const source = context.sources.find(
          (s: { step: string }) => s.step === "Identify unusual issues",
        );
        assert.ok(source);
        assert.ok(
          context.sources.some(
            (s: { step: string }) => s.step === "Review open work",
          ),
          "includes prerequisite neighbor",
        );
        if (changeDuringAnswer) library = { ...library, revision: "newer" };
        return completion(
          answerable,
          answerable
            ? [
                {
                  text: "Give each equipment issue a clear owner.",
                  sources: [source.id],
                },
              ]
            : [],
        );
      },
    );
    try {
      await assert.rejects(
        () => rag.ask("Question", signal()),
        /still being indexed/,
      );
      await rag.refresh();
      assert.equal(rag.status().state, "ready");
      assert.equal(embedded, 4);
      const answer = await rag.ask(
        "How should we handle a changeover?",
        signal(),
      );
      assert.equal(answer.outcome, "answer");
      assert.equal(answer.sources[0].anchor, "issues");
      assert.equal(answer.sources[0].revision, library.documents[0].version);
      assert.equal(answer.sources.length, 1, "only cited sources are returned");
      await rag.refresh();
      assert.equal(embedded, 4);
      const unrelated = await rag.ask("orbital launch trajectories", signal());
      assert.equal(unrelated.outcome, "no_answer");
      assert.equal(
        generated,
        1,
        "no generation when retrieval has no relevant matches",
      );
      answerable = false;
      assert.equal(
        (await rag.ask("handover annual budget", signal())).outcome,
        "no_answer",
      );
      answerable = true;
      changeDuringAnswer = true;
      await assert.rejects(
        () => rag.ask("handover", signal()),
        /library changed/,
      );
      changeDuringAnswer = false;
      await writeFile(
        path.join(root, "guide.md"),
        handover.replace(
          "Give each equipment issue a clear owner.",
          "Assign an owner and escalation deadline.",
        ),
      );
      library = await loadLibrary(root);
      await rag.refresh();
      assert.equal(embedded, 5, "only the changed step is embedded again");
      await rm(path.join(root, "guide.md"));
      library = await loadLibrary(root);
      await rag.refresh();
      assert.equal(rag.status().totalChunks, 0);
      assert.equal((await rag.ask("handover", signal())).outcome, "no_answer");
    } finally {
      await rag.close();
    }
  });
});

test("RAG recovers after indexing failure and coalesces changes made during embedding", async () => {
  await fixture(async (root) => {
    let library = await loadLibrary(root);
    let fail = true;
    let release!: () => void;
    let started!: () => void;
    const embeddingStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const embeddingAllowed = new Promise<void>((resolve) => {
      release = resolve;
    });
    let wait = true;
    const rag = new RagService(
      config(path.join(root, "index")),
      () => library,
      () => {},
      async (_url, init) => {
        if (fail) return json({}, 401);
        if (wait) {
          started();
          await embeddingAllowed;
          wait = false;
        }
        const body = JSON.parse(String(init?.body));
        return json({
          data: body.input.map((_: string, index: number) => ({
            index,
            embedding: axis(0),
          })),
        });
      },
    );
    try {
      await rag.refresh();
      assert.equal(rag.status().state, "error");
      fail = false;
      const running = rag.refresh();
      await embeddingStarted;
      await rm(path.join(root, "guide.md"));
      library = await loadLibrary(root);
      const queued = rag.refresh();
      release();
      await Promise.all([running, queued]);
      assert.equal(rag.status().state, "ready");
      assert.equal(rag.status().totalChunks, 0);
    } finally {
      release?.();
      await rag.close();
    }
  });
});

test("AI configuration is optional, validates dimensions and accepts the Inception Labs key alias", async () => {
  const defaults = aiConfig({});
  assert.equal(defaults.inceptionModel, "mercury-3");
  assert.equal(
    aiConfig({ INCEPTION_LABS_API_KEY: " alias " }).inceptionKey,
    "alias",
  );
  assert.throws(
    () => aiConfig({ EMBEDDING_DIMENSIONS: "bad" }),
    /EMBEDDING_DIMENSIONS/,
  );
  const rag = new RagService(defaults, () => ({
    revision: "empty",
    documents: [],
    spaces: [],
    diagnostics: [],
  }));
  await rag.refresh();
  assert.equal(rag.status().state, "disabled");
  await assert.rejects(() => rag.ask("Question", signal()), /isn’t configured/);
  await rag.close();
});
