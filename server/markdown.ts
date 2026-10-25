import MarkdownIt from "markdown-it";
import GithubSlugger from "github-slugger";

export const plainText = (value: string) =>
  value
    .replace(/\s+\{#[a-zA-Z][\w-]*\}/g, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#*_`>~]/g, "")
    .replace(/\s+/g, " ")
    .trim();

// Explicit IDs are portable with the Markdown and survive heading renames.
// Keep ordinary heading slugs for existing files and links.
export function markdownParser() {
  const parser = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: true,
  });
  parser.core.ruler.after("inline", "knowledge-heading-ids", (state) => {
    const slugger = new GithubSlugger();
    const used = new Set<string>();
    const reserved = new Set<string>();
    for (let i = 0; i < state.tokens.length; i++) {
      if (state.tokens[i].type !== "heading_open") continue;
      const id = state.tokens[i + 1].content.match(
        /\s+\{#([a-zA-Z][\w-]*)\}\s*$/,
      )?.[1];
      if (id && reserved.has(id))
        throw new Error(`Duplicate heading ID: ${id}`);
      if (id) reserved.add(id);
    }
    for (let i = 0; i < state.tokens.length; i++) {
      const token = state.tokens[i];
      if (token.type !== "heading_open") continue;
      const inline = state.tokens[i + 1];
      const explicit = inline.content.match(/\s+\{#([a-zA-Z][\w-]*)\}\s*$/);
      if (explicit) {
        inline.content = inline.content.slice(0, explicit.index).trimEnd();
        inline.children = parser.parseInline(
          inline.content,
          state.env,
        )[0].children;
      }
      const text =
        inline.children?.map((child) => child.content).join("") ||
        inline.content;
      let id = explicit?.[1] || slugger.slug(text) || `section-${i}`;
      if (!explicit) {
        let suffix = 0;
        while (used.has(id) || reserved.has(id))
          id = slugger.slug(text) || `section-${i}-${++suffix}`;
      }
      used.add(id);
      token.attrSet("id", id);
    }
  });
  return parser;
}

export function markdownBody(raw: string) {
  const source = raw.replace(/^\uFEFF/, "");
  return source.replace(
    /^---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/,
    "",
  );
}

export function documentBody(raw: string, title: string) {
  return markdownBody(raw).replace(/^\s*#\s+(.+)\r?\n/, (match, h1: string) =>
    plainText(h1) === title ? "" : match,
  );
}
