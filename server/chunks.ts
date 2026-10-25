import { createHash } from "node:crypto";
import type { KnowledgeDocument } from "../shared/library";
import { documentBody, markdownParser } from "./markdown";

export const CHUNK_VERSION = "steps-v1";
export const hash = (text: string) =>
  createHash("sha256").update(text).digest("hex");

export interface Chunk {
  id: string;
  documentId: string;
  revision: string;
  title: string;
  space: string;
  section: string;
  step: string;
  anchor: string;
  position: number;
  body: string;
  input: string;
  contentHash: string;
}

// A conservative character budget also bounds tables/code without requiring a
// provider-specific tokenizer. Split only whole Markdown blocks where possible.
const MAX_CHARS = 2000;
function boundedBlocks(blocks: string[]) {
  const pieces: string[] = [];
  let current = "";
  for (const block of blocks) {
    const fragments =
      block.length <= MAX_CHARS
        ? [block]
        : block.match(/[\s\S]{1,1800}(?:\s|$)|[\s\S]{1,1800}/g) || [];
    for (const fragment of fragments) {
      if (current && current.length + fragment.length + 2 > MAX_CHARS) {
        pieces.push(current);
        current = "";
      }
      current += (current ? "\n\n" : "") + fragment.trim();
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

export function chunkDocument(doc: KnowledgeDocument): Chunk[] {
  const source = documentBody(doc.markdown, doc.title);
  const lines = source.split(/\r?\n/);
  const tokens = markdownParser().parse(source, {});
  const groups: {
    section: string;
    step: string;
    anchor: string;
    blocks: string[];
  }[] = [];
  let section = "";
  let step = "";
  let anchor = "";
  let blocks: string[] = [];
  const flush = () => {
    if (blocks.length) groups.push({ section, step, anchor, blocks });
    blocks = [];
  };
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.level !== 0 || !token.map) continue;
    if (token.type === "heading_open") {
      const level = Number(token.tag.slice(1));
      const title =
        tokens[i + 1].children?.map((child) => child.content).join("") ||
        tokens[i + 1].content;
      if (level <= 3) {
        flush();
        if (level <= 2) {
          section = level === 2 ? title : "";
          step = "";
        } else step = title;
        anchor = String(token.attrGet("id") || "");
      } else {
        blocks.push(lines.slice(...token.map).join("\n"));
      }
      continue;
    }
    // Opening block tokens cover lists, tables, fences and blockquotes including
    // their children, so a table or checklist is not fragmented into sentences.
    if (token.nesting >= 0 && token.type !== "inline")
      blocks.push(lines.slice(...token.map).join("\n"));
  }
  flush();
  const chunks: Chunk[] = [];
  for (const group of groups) {
    boundedBlocks(group.blocks).forEach((body, part) => {
      const input = [
        `Process: ${doc.title}`,
        `Space: ${doc.space}`,
        doc.tags.length ? `Tags: ${doc.tags.join(", ")}` : "",
        group.section ? `Section: ${group.section}` : "",
        group.step ? `Step: ${group.step}` : "",
        body,
      ]
        .filter(Boolean)
        .join("\n");
      chunks.push({
        id: hash(JSON.stringify([doc.id, group.anchor, part])),
        documentId: doc.id,
        revision: doc.version,
        title: doc.title,
        space: doc.space,
        section: group.section,
        step: group.step,
        anchor: group.anchor,
        position: chunks.length,
        body,
        input,
        contentHash: hash(input),
      });
    });
  }
  return chunks;
}
