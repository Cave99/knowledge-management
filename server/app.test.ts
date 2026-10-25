import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "./app";
import { loadLibrary } from "./library";
import { AiError } from "./ai-providers";

test("serves a versioned library and original Markdown, rejects writes and unsupported assets", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kmflow-api-"));
  await mkdir(path.join(root, "nested"));
  await writeFile(
    path.join(root, "nested", "example.md"),
    "# Example\n\nSome content.\n",
  );
  await writeFile(path.join(root, "private.txt"), "Not served");
  const library = await loadLibrary(root);
  const app = await createApp({ contentRoot: root, snapshot: () => library });
  try {
    const response = await app.inject("/api/library");
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().documents[0].title, "Example");
    assert.equal(response.headers["cache-control"], "no-cache");
    const cached = await app.inject({
      url: "/api/library",
      headers: { "if-none-match": String(response.headers.etag) },
    });
    assert.equal(cached.statusCode, 304);
    const source = await app.inject("/api/documents/nested%2Fexample/raw");
    assert.equal(source.statusCode, 200);
    assert.equal(source.body, "# Example\n\nSome content.\n");
    assert.match(String(source.headers["content-disposition"]), /attachment/);
    assert.equal(
      (await app.inject("/api/documents/missing/raw")).statusCode,
      404,
    );
    assert.equal((await app.inject("/api/assets/private.txt")).statusCode, 404);
    assert.equal(
      (await app.inject({ method: "POST", url: "/api/library", payload: {} }))
        .statusCode,
      404,
    );
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("production serves hashed assets and deep links without swallowing API misses", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kmflow-production-"));
  await mkdir(path.join(root, "assets"));
  await writeFile(
    path.join(root, "index.html"),
    '<html><div id="root">Application</div></html>',
  );
  await writeFile(
    path.join(root, "assets", "app-hash.js"),
    'console.log("app")',
  );
  const app = await createApp({
    contentRoot: root,
    snapshot: () => ({
      revision: "test",
      documents: [],
      spaces: [],
      diagnostics: [],
    }),
    production: true,
    webRoot: root,
  });
  try {
    const asset = await app.inject("/assets/app-hash.js");
    assert.equal(asset.statusCode, 200);
    assert.equal(
      asset.headers["cache-control"],
      "public, max-age=31536000, immutable",
    );
    for (const url of [
      "/documents/welcome",
      "/documents/nested%2Fexample",
      "/documents/name.with.dots",
    ]) {
      const route = await app.inject(url);
      assert.equal(route.statusCode, 200);
      assert.match(route.body, /Application/);
    }
    assert.equal((await app.inject("/api/missing")).statusCode, 404);
    assert.equal((await app.inject("/assets/missing.js")).statusCode, 404);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("AI is optional and validates requests without breaking ordinary library search", async () => {
  const library = {
    revision: "empty",
    documents: [],
    spaces: [],
    diagnostics: [],
  };
  const app = await createApp({ contentRoot: ".", snapshot: () => library });
  try {
    const status = await app.inject("/api/ai/status");
    assert.equal(status.json().state, "disabled");
    assert.equal(status.headers["cache-control"], "no-store");
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/ai/ask",
          payload: { question: "Question" },
        })
      ).statusCode,
      503,
    );
    for (const payload of [
      {},
      { question: 4 },
      { question: "" },
      { question: "  " },
      { question: "q".repeat(2001) },
    ])
      assert.equal(
        (await app.inject({ method: "POST", url: "/api/ai/ask", payload }))
          .statusCode,
        400,
      );
    assert.equal((await app.inject("/api/library")).statusCode, 200);
  } finally {
    await app.close();
  }
});

test("AI routes return cited answers, sanitize failures and limit concurrent paid requests", async () => {
  const library = {
    revision: "empty",
    documents: [],
    spaces: [],
    diagnostics: [],
  };
  let mode = "success";
  let release!: () => void;
  let started!: () => void;
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve;
  });
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const app = await createApp({
    contentRoot: ".",
    snapshot: () => library,
    ai: {
      status: () => ({ state: "ready", indexedChunks: 2, totalChunks: 2 }),
      ask: async (question, signal) => {
        assert.equal(question, "Question");
        assert.equal(signal.aborted, false);
        if (mode === "known-error") throw new AiError("Still indexing.", 503);
        if (mode === "unknown-error") throw new Error("secret upstream data");
        if (mode === "wait") {
          started();
          await wait;
        }
        return {
          outcome: "no_answer",
          paragraphs: [{ text: "No answer", sources: [] }],
          sources: [],
        };
      },
    },
  });
  const ask = () =>
    app.inject({
      method: "POST",
      url: "/api/ai/ask",
      payload: { question: " Question " },
    });
  try {
    assert.equal((await app.inject("/api/ai/status")).json().state, "ready");
    const result = await ask();
    assert.equal(result.statusCode, 200);
    assert.equal(result.headers["cache-control"], "no-store");
    assert.equal(result.json().outcome, "no_answer");
    mode = "known-error";
    assert.equal((await ask()).json().message, "Still indexing.");
    mode = "unknown-error";
    const failure = await ask();
    assert.equal(failure.statusCode, 503);
    assert.doesNotMatch(failure.body, /secret/);
    mode = "wait";
    const first = ask();
    const second = ask();
    const inFlight = Promise.all([first, second]);
    await startedPromise;
    const busy = await ask();
    assert.equal(busy.statusCode, 429);
    release();
    assert.ok(
      (await inFlight).every((response) => response.statusCode === 200),
    );
  } finally {
    release();
    await app.close();
  }
});

test("Ask AI enforces a per-client request limit", async () => {
  const app = await createApp({
    contentRoot: ".",
    snapshot: () => ({
      revision: "empty",
      documents: [],
      spaces: [],
      diagnostics: [],
    }),
  });
  try {
    for (let i = 0; i < 12; i++)
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/api/ai/ask",
            payload: { question: "Question" },
          })
        ).statusCode,
        503,
      );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/ai/ask",
          payload: { question: "Question" },
        })
      ).statusCode,
      429,
    );
    assert.equal((await app.inject("/api/library")).statusCode, 200);
  } finally {
    await app.close();
  }
});

test("Ask AI streams progress before a complete answer and sends errors without leaking upstream details", async () => {
  let fail = false;
  const app = await createApp({
    contentRoot: ".",
    snapshot: () => ({
      revision: "empty",
      documents: [],
      spaces: [],
      diagnostics: [],
    }),
    ai: {
      status: () => ({ state: "ready", indexedChunks: 1, totalChunks: 1 }),
      ask: async (_question, _signal, onProgress) => {
        onProgress?.({ phase: "answering", sources: [] });
        if (fail) throw new Error("private upstream data");
        return {
          outcome: "no_answer",
          sources: [],
          paragraphs: [{ text: "No answer", sources: [] }],
        };
      },
    },
  });
  const ask = () =>
    app.inject({
      method: "POST",
      url: "/api/ai/ask",
      headers: { Accept: "application/x-ndjson" },
      payload: { question: "Question" },
    });
  try {
    const result = await ask();
    assert.equal(result.headers["x-accel-buffering"], "no");
    const events = result.body
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      events.map((event) => event.type),
      ["progress", "progress", "answer"],
    );
    assert.equal(events[0].progress.phase, "searching");
    assert.equal(events[1].progress.phase, "answering");
    fail = true;
    const error = await ask();
    assert.equal(
      JSON.parse(error.body.trim().split("\n").at(-1)!).type,
      "error",
    );
    assert.doesNotMatch(error.body, /private upstream/);
  } finally {
    await app.close();
  }
});

test(
  "streaming feedback arrives before generation finishes and disconnects cancel generation",
  { timeout: 5000 },
  async () => {
    let cancelled!: () => void;
    const cancellation = new Promise<void>((resolve) => {
      cancelled = resolve;
    });
    const app = await createApp({
      contentRoot: ".",
      snapshot: () => ({
        revision: "empty",
        documents: [],
        spaces: [],
        diagnostics: [],
      }),
      ai: {
        status: () => ({ state: "ready", indexedChunks: 1, totalChunks: 1 }),
        ask: async (_question, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => {
                cancelled();
                reject(new Error("Cancelled"));
              },
              { once: true },
            );
          }),
      },
    });
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await app.listen({ port: 0, host: "127.0.0.1" });
      const address = app.server.address();
      assert.ok(address && typeof address === "object");
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/ai/ask`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/x-ndjson",
          },
          body: JSON.stringify({ question: "Question" }),
          signal: controller.signal,
        },
      );
      const first = await response.body!.getReader().read();
      assert.match(
        new TextDecoder().decode(first.value),
        /"phase":"searching"/,
      );
      controller.abort();
      await Promise.race([
        cancellation,
        new Promise<void>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error("Disconnect did not cancel generation")),
            1500,
          );
        }),
      ]);
    } finally {
      controller.abort();
      clearTimeout(timer);
      await app.close();
    }
  },
);
