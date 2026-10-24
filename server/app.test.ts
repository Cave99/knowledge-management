import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "./app";
import { loadLibrary } from "./library";

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
