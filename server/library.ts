import { createHash } from "node:crypto";
import { readdir, readFile, stat, realpath } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import sanitizeHtml from "sanitize-html";
import { slug } from "github-slugger";
import { documentBody, markdownParser, plainText as plain } from "./markdown";
import type { Heading, KnowledgeDocument, Library } from "../shared/library";

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex").slice(0, 20);
const label = (value: string) =>
  value.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const string = (value: unknown, fallback = "") =>
  typeof value === "string" && value.trim() ? value.trim() : fallback;

function parseFile(raw: string): {
  data: Record<string, unknown>;
  content: string;
} {
  const source = raw.replace(/^\uFEFF/, "");
  if (!/^---[^\r\n]*\r?\n/.test(source)) return { data: {}, content: source };
  const lines = source.split(/\r?\n/);
  if (lines[0].trim() !== "---")
    throw new Error("Frontmatter must use YAML between plain --- delimiters");
  const end = lines.findIndex(
    (line, index) => index > 0 && /^(---|\.\.\.)\s*$/.test(line),
  );
  if (end < 0)
    throw new Error("YAML frontmatter is missing its closing --- delimiter");
  const data = parseYaml(lines.slice(1, end).join("\n")) ?? {};
  if (typeof data !== "object" || Array.isArray(data))
    throw new Error("YAML frontmatter must be a mapping of metadata fields");
  return { data, content: lines.slice(end + 1).join("\n") };
}

async function markdownPaths(root: string, directory = ""): Promise<string[]> {
  const entries = await readdir(path.join(root, directory), {
    withFileTypes: true,
  });
  const groups = await Promise.all(
    entries
      .filter((e) => !e.name.startsWith(".") && e.name !== "node_modules")
      .map(async (entry) => {
        const relative = path.posix.join(directory, entry.name);
        if (entry.isDirectory()) return markdownPaths(root, relative);
        return entry.isFile() && /\.md$/i.test(entry.name) ? [relative] : [];
      }),
  );
  return groups.flat().sort();
}

export async function confinedAsset(root: string, relative: string) {
  const rootReal = await realpath(root);
  const target = await realpath(path.resolve(root, relative));
  if (!target.startsWith(rootReal + path.sep))
    throw new Error("Asset is outside the knowledge directory");
  if (!/\.(png|jpe?g|gif|webp|avif|svg|pdf)$/i.test(target))
    throw new Error("Unsupported asset type");
  if (!(await stat(target)).isFile()) throw new Error("Asset is not a file");
  return target;
}

export async function loadLibrary(
  root: string,
  previous?: Library,
): Promise<Library> {
  let paths: string[];
  try {
    paths = await markdownPaths(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      const diagnostics = [
        {
          path: ".",
          message:
            "The knowledge folder does not exist. Set CONTENT_DIR to an existing folder.",
        },
      ];
      return {
        revision: digest(JSON.stringify(diagnostics)),
        documents: [],
        spaces: [],
        diagnostics,
      };
    }
    throw error;
  }
  const diagnostics: Library["diagnostics"] = [];
  const docs: KnowledgeDocument[] = [];
  const ids = new Set<string>();

  for (const file of paths) {
    try {
      // Recheck after directory traversal: symlinks must not escape the configured root.
      const fileReal = await realpath(path.join(root, file));
      const rootReal = await realpath(root);
      if (!fileReal.startsWith(rootReal + path.sep))
        throw new Error("File is outside the knowledge directory");
      const raw = await readFile(fileReal, "utf8");
      const { data, content } = parseFile(raw);
      markdownParser().parse(content, {}); // Validate explicit heading IDs inside file recovery.
      const title = string(
        data.title,
        content.match(/^#\s+(.+)$/m)?.[1] ||
          label(path.basename(file, path.extname(file))),
      );
      const folder = path.posix.dirname(file);
      const space = string(
        data.space,
        folder === "." ? "General" : label(folder.split("/")[0]),
      );
      const id = string(
        data.id,
        file
          .replace(/\.md$/i, "")
          .split("/")
          .map((part) => slug(part))
          .join("/"),
      );
      if (!id || !/^[\p{L}\p{N}][\p{L}\p{N}._/-]*$/u.test(id))
        throw new Error(
          "Use a document ID made of letters, numbers, dots, dashes, underscores, or slashes",
        );
      if (ids.has(id)) throw new Error(`Duplicate document ID: ${id}`);
      const info = await stat(fileReal);
      const providedDate = data.updated_at ?? data.updated;
      const date =
        providedDate instanceof Date
          ? providedDate
          : providedDate
            ? new Date(String(providedDate))
            : info.mtime;
      if (Number.isNaN(date.getTime()))
        throw new Error("updated_at must be a valid date");
      const text = plain(content);
      docs.push({
        id,
        title: plain(title),
        description: string(
          data.description,
          text.replace(plain(title), "").trim().slice(0, 160),
        ),
        space,
        spaceId: slug(space) || "general",
        author: string(data.author, "Team"),
        updatedAt: date.toISOString(),
        readMinutes: Math.max(1, Math.ceil(text.split(/\s+/).length / 220)),
        pinned: data.pinned === true,
        tags: Array.isArray(data.tags)
          ? data.tags.filter((tag): tag is string => typeof tag === "string")
          : [],
        path: file,
        version: digest(raw),
        markdown: raw,
        html: "",
        text,
        headings: [],
      });
      ids.add(id);
    } catch (error) {
      diagnostics.push({
        path: file,
        message: error instanceof Error ? error.message : "Unable to read file",
      });
      const lastGood = previous?.documents.find((doc) => doc.path === file);
      if (lastGood && !ids.has(lastGood.id)) {
        docs.push({ ...lastGood });
        ids.add(lastGood.id);
      }
    }
  }

  const byPath = new Map(docs.map((doc) => [doc.path, doc]));
  for (const doc of docs) {
    // A retained last-good document has already been rendered.
    if (doc.html) continue;
    const parser = markdownParser();
    const headings: Heading[] = [];
    const body = documentBody(doc.markdown, doc.title);
    const tokens = parser.parse(body, {});
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index];
      if (token.type === "heading_open") {
        const inline = tokens[index + 1];
        const text =
          inline.children
            ?.map((child) =>
              child.type === "image" ? child.content : child.content,
            )
            .join("") || plain(inline.content);
        const id = String(token.attrGet("id"));
        headings.push({ id, text, level: Number(token.tag.slice(1)) });
      }
      for (const child of token.children ?? []) {
        const attribute =
          child.type === "image"
            ? "src"
            : child.type === "link_open"
              ? "href"
              : null;
        if (!attribute) continue;
        const value = String(child.attrGet(attribute) || "");
        if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(value)) continue;
        const [relative, hash] = value.split("#", 2);
        let decoded: string;
        try {
          decoded = decodeURIComponent(relative);
        } catch {
          continue;
        }
        const resolved = path.posix.normalize(
          path.posix.join(path.posix.dirname(doc.path), decoded),
        );
        if (
          resolved === ".." ||
          resolved.startsWith("../") ||
          path.posix.isAbsolute(decoded)
        )
          continue;
        const linked = byPath.get(resolved);
        if (attribute === "href" && linked)
          child.attrSet(
            attribute,
            `/documents/${encodeURIComponent(linked.id)}${hash ? "#" + hash : ""}`,
          );
        else if (attribute === "src" || /\.pdf$/i.test(resolved))
          child.attrSet(
            attribute,
            `/api/assets/${resolved.split("/").map(encodeURIComponent).join("/")}${hash ? "#" + hash : ""}`,
          );
      }
    }
    doc.headings = headings;
    doc.html = sanitizeHtml(
      parser.renderer.render(tokens, parser.options, {}),
      {
        allowedTags: [...sanitizeHtml.defaults.allowedTags, "img"],
        allowedAttributes: {
          ...sanitizeHtml.defaults.allowedAttributes,
          "*": ["id"],
          img: [
            "src",
            "alt",
            "title",
            "width",
            "height",
            "loading",
            "decoding",
          ],
        },
        allowedSchemes: ["http", "https", "mailto"],
        transformTags: {
          img: sanitizeHtml.simpleTransform("img", {
            loading: "lazy",
            decoding: "async",
          }),
        },
      },
    );
  }

  docs.sort(
    (a, b) =>
      b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title),
  );
  const spaces: Library["spaces"] = [];
  for (const doc of docs) {
    const existing = spaces.find((space) => space.id === doc.spaceId);
    if (existing) existing.count++;
    else spaces.push({ id: doc.spaceId, name: doc.space, count: 1 });
  }
  spaces.sort((a, b) => a.name.localeCompare(b.name));
  const revision = digest(JSON.stringify({ docs, diagnostics }));
  return { revision, documents: docs, spaces, diagnostics };
}
