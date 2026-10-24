import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  symlink,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { confinedAsset, loadLibrary } from "./library";

async function fixture(
  files: Record<string, string>,
  run: (root: string) => Promise<void>,
) {
  const root = await mkdtemp(path.join(tmpdir(), "kmflow-"));
  try {
    for (const [name, content] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(root, name)), { recursive: true });
      await writeFile(path.join(root, name), content);
    }
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("reads real Markdown, derives defaults, and gives repeated headings unique anchors", async () => {
  await fixture(
    {
      "my-space/hello.md":
        "# Hello world\n\nA practical **guide**.\n\n## Check\n\n### Do it\n\n## Check\n",
    },
    async (root) => {
      const result = await loadLibrary(root);
      assert.equal(result.documents.length, 1);
      const doc = result.documents[0];
      assert.equal(doc.id, "my-space/hello");
      assert.equal(doc.title, "Hello world");
      assert.equal(doc.space, "My Space");
      assert.deepEqual(
        doc.headings.map((heading) => heading.id),
        ["check", "do-it", "check-1"],
      );
      assert.match(doc.html, /<strong>guide<\/strong>/);
      assert.doesNotMatch(doc.html, /<h1/);
      assert.equal(doc.markdown.startsWith("# Hello world"), true);
      assert.equal(result.diagnostics.length, 0);
    },
  );
});

test("supports metadata, relative document links, and local images without executable HTML", async () => {
  await fixture(
    {
      "guide.md":
        "---\nid: guide\ntitle: My guide\nspace: Operations\nupdated_at: 2026-10-25\npinned: true\ntags: [daily]\n---\n\n## Start\n\n[Other](./notes/other.md#check)\n\n![Example](./images/sample.png)\n\n<script>alert(1)</script>\n\n[Bad](javascript:alert(1))",
      "notes/other.md": "---\nid: other\n---\n\n## Check\n",
    },
    async (root) => {
      const library = await loadLibrary(root);
      const doc = library.documents.find((item) => item.id === "guide")!;
      assert.equal(doc.pinned, true);
      assert.deepEqual(doc.tags, ["daily"]);
      assert.equal(doc.updatedAt, "2026-10-25T00:00:00.000Z");
      assert.match(doc.html, /href="\/documents\/other#check"/);
      assert.match(doc.html, /src="\/api\/assets\/images\/sample.png"/);
      assert.match(doc.html, /loading="lazy"/);
      assert.doesNotMatch(doc.html, /<script|href="javascript:/);
    },
  );
});

test("reports invalid YAML and duplicate IDs; preserves the last valid document on invalid edits", async () => {
  await fixture(
    {
      "first.md": "---\nid: first\ntitle: First\n---\n\nGood content",
      "second.md": "---\nid: first\n---\n\nDuplicate",
    },
    async (root) => {
      const first = await loadLibrary(root);
      assert.equal(first.documents.length, 1);
      assert.match(first.diagnostics[0].message, /Duplicate/);
      await writeFile(
        path.join(root, "first.md"),
        "---\ntitle: [broken\n---\n\nInvalid",
      );
      await rm(path.join(root, "second.md"));
      const next = await loadLibrary(root, first);
      assert.equal(next.documents[0].title, "First");
      assert.equal(next.documents[0].version, first.documents[0].version);
      assert.equal(next.diagnostics.length, 1);
      await rm(path.join(root, "first.md"));
      assert.equal((await loadLibrary(root, next)).documents.length, 0);
    },
  );
});

test("does not execute frontmatter languages and confines file access to the content directory", async () => {
  await fixture(
    {
      "unsafe.md":
        '---javascript\n{ title: (() => { throw new Error("executed") })() }\n---\n',
      "asset.png": "image",
      "secret.txt": "not an asset",
    },
    async (root) => {
      const result = await loadLibrary(root);
      assert.equal(result.documents.length, 0);
      assert.match(result.diagnostics[0].message, /must use YAML/);
      assert.equal(
        await confinedAsset(root, "asset.png"),
        await realpath(path.join(root, "asset.png")),
      );
      await assert.rejects(confinedAsset(root, "secret.txt"), /Unsupported/);
      await symlink("/etc/hosts", path.join(root, "escape.png"));
      await symlink("/etc/hosts", path.join(root, "escape.md"));
      await assert.rejects(confinedAsset(root, "escape.png"), /outside/);
      assert.equal((await loadLibrary(root)).documents.length, 0);
    },
  );
});

test("handles empty and missing content directories and stable unchanged snapshots", async () => {
  await fixture({}, async (root) => {
    assert.equal((await loadLibrary(root)).documents.length, 0);
    assert.equal(
      (await loadLibrary(path.join(root, "missing"))).diagnostics.length,
      1,
    );
    await writeFile(
      path.join(root, "plain.md"),
      "An ordinary note without metadata.",
    );
    assert.equal(
      (await loadLibrary(root)).revision,
      (await loadLibrary(root)).revision,
    );
  });
});
