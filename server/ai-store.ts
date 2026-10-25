import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";
import type { Chunk } from "./chunks";

export interface StoredChunk extends Chunk {
  similarity?: number;
  rank?: number;
}

const columns = `id, document_id AS "documentId", revision, title, space,
  section, step, anchor, position, body, input, content_hash AS "contentHash"`;

export class AiStore {
  private constructor(
    private db: PGlite,
    private release?: () => Promise<void>,
  ) {}

  static async open(dataDir?: string) {
    let release: (() => Promise<void>) | undefined;
    if (dataDir) {
      await mkdir(dataDir, { recursive: true });
      // PGlite is single-process. Refuse a second owner rather than corrupting
      // the persisted index; stale locks recover after an unclean shutdown.
      release = await lockfile.lock(dataDir, { stale: 30_000, update: 10_000 });
    }
    let db: PGlite | undefined;
    try {
      db = new PGlite({
        dataDir: dataDir ? path.join(dataDir, "postgres") : undefined,
        extensions: { vector },
      });
      await db.exec(`
        CREATE EXTENSION IF NOT EXISTS vector;
        CREATE TABLE IF NOT EXISTS knowledge_chunks (
          id text PRIMARY KEY,
          document_id text NOT NULL,
          revision text NOT NULL,
          title text NOT NULL,
          space text NOT NULL,
          section text NOT NULL,
          step text NOT NULL,
          anchor text NOT NULL,
          position integer NOT NULL,
          body text NOT NULL,
          input text NOT NULL,
          content_hash text NOT NULL,
          signature text NOT NULL,
          embedding vector,
          search_text tsvector GENERATED ALWAYS AS (to_tsvector('english', input)) STORED
        );
        CREATE INDEX IF NOT EXISTS knowledge_chunks_search ON knowledge_chunks USING gin(search_text);
        CREATE INDEX IF NOT EXISTS knowledge_chunks_document ON knowledge_chunks(document_id, position);
      `);
      return new AiStore(db, release);
    } catch (error) {
      await db?.close().catch(() => {});
      await release?.();
      throw error;
    }
  }

  async sync(chunks: Chunk[], signature: string) {
    await this.db.transaction(async (tx) => {
      await tx.query(
        `
        INSERT INTO knowledge_chunks
          (id, document_id, revision, title, space, section, step, anchor, position, body, input, content_hash, signature)
        SELECT id, "documentId", revision, title, space, section, step, anchor, position, body, input, "contentHash", $2
        FROM jsonb_to_recordset($1::jsonb) AS x(
          id text, "documentId" text, revision text, title text, space text, section text,
          step text, anchor text, position integer, body text, input text, "contentHash" text)
        ON CONFLICT (id) DO UPDATE SET
          document_id = EXCLUDED.document_id, revision = EXCLUDED.revision,
          title = EXCLUDED.title, space = EXCLUDED.space, section = EXCLUDED.section,
          step = EXCLUDED.step, anchor = EXCLUDED.anchor, position = EXCLUDED.position,
          body = EXCLUDED.body, input = EXCLUDED.input, content_hash = EXCLUDED.content_hash,
          signature = EXCLUDED.signature,
          embedding = CASE WHEN knowledge_chunks.content_hash = EXCLUDED.content_hash
            AND knowledge_chunks.signature = EXCLUDED.signature THEN knowledge_chunks.embedding ELSE NULL END
      `,
        [JSON.stringify(chunks), signature],
      );
      await tx.query(
        `DELETE FROM knowledge_chunks WHERE NOT (id IN (
        SELECT jsonb_array_elements_text($1::jsonb)))`,
        [JSON.stringify(chunks.map((chunk) => chunk.id))],
      );
    });
  }

  async pending(signature: string) {
    return (
      await this.db.query<Chunk>(
        `SELECT ${columns} FROM knowledge_chunks
      WHERE signature = $1 AND embedding IS NULL ORDER BY document_id, position LIMIT 16`,
        [signature],
      )
    ).rows;
  }

  async saveEmbeddings(
    chunks: Chunk[],
    vectors: number[][],
    signature: string,
  ) {
    await this.db.transaction(async (tx) => {
      for (let i = 0; i < chunks.length; i++)
        await tx.query(
          `UPDATE knowledge_chunks SET embedding = $1::vector
          WHERE id = $2 AND content_hash = $3 AND signature = $4`,
          [
            JSON.stringify(vectors[i]),
            chunks[i].id,
            chunks[i].contentHash,
            signature,
          ],
        );
    });
  }

  async counts(signature: string) {
    const result = await this.db.query<{ total: number; indexed: number }>(
      `SELECT
      count(*)::integer AS total, count(embedding)::integer AS indexed
      FROM knowledge_chunks WHERE signature = $1`,
      [signature],
    );
    return result.rows[0];
  }

  async search(question: string, embedding: number[], signature: string) {
    const semantic = (
      await this.db.query<StoredChunk>(
        `SELECT ${columns},
      1 - (embedding <=> $1::vector) AS similarity FROM knowledge_chunks
      WHERE signature = $2 AND embedding IS NOT NULL
      ORDER BY embedding <=> $1::vector LIMIT 20`,
        [JSON.stringify(embedding), signature],
      )
    ).rows;
    // OR the terms to avoid requiring every word of a conversational question.
    const terms = question.match(/[\p{L}\p{N}_-]+/gu) || [];
    const lexical = (
      await this.db.query<StoredChunk>(
        `SELECT ${columns},
      ts_rank_cd(search_text, websearch_to_tsquery('english', $1)) AS rank
      FROM knowledge_chunks WHERE signature = $2 AND
        search_text @@ websearch_to_tsquery('english', $1)
      ORDER BY rank DESC, id LIMIT 20`,
        [terms.join(" OR "), signature],
      )
    ).rows;
    const ranked = new Map<string, { chunk: StoredChunk; score: number }>();
    semantic
      .filter((chunk) => (chunk.similarity ?? 0) >= 0.35)
      .forEach((chunk, i) => {
        ranked.set(chunk.id, { chunk, score: 1 / (60 + i + 1) });
      });
    lexical.forEach((chunk, i) => {
      const existing = ranked.get(chunk.id);
      ranked.set(chunk.id, {
        chunk: existing?.chunk || chunk,
        score: (existing?.score || 0) + 1 / (60 + i + 1),
      });
    });
    return [...ranked.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((item) => item.chunk);
  }

  async fastMatches(question: string, signature: string): Promise<Chunk[]> {
    // Skip the remote query embedding only when EVERY non-stopword query term
    // exists in one short process and its title names the topic unambiguously.
    // Keep the entire process, so this shortcut cannot drop a prerequisite.
    const matches = (
      await this.db.query<{ documentId: string }>(
        `
      WITH terms AS (
        SELECT tsvector_to_array(to_tsvector('english', $1)) AS words
      ), documents AS (
        SELECT document_id, count(*) AS chunks,
          to_tsvector('english', min(title)) AS title_text,
          to_tsvector('english', string_agg(input, ' ')) AS all_text
        FROM knowledge_chunks WHERE signature = $2 GROUP BY document_id
      )
      SELECT document_id AS "documentId" FROM documents, terms
      WHERE chunks <= 10 AND cardinality(words) BETWEEN 1 AND 12
        AND NOT EXISTS (SELECT 1 FROM unnest(words) AS word
          WHERE NOT (all_text @@ plainto_tsquery('simple', word)))
        AND (SELECT count(*) FROM unnest(words) AS word
          WHERE title_text @@ plainto_tsquery('simple', word)) >= LEAST(2, cardinality(words))
      LIMIT 2
    `,
        [question, signature],
      )
    ).rows;
    if (matches.length !== 1) return [];
    return (
      await this.db.query<Chunk>(
        `SELECT ${columns} FROM knowledge_chunks
      WHERE document_id = $1 AND signature = $2 ORDER BY position`,
        [matches[0].documentId, signature],
      )
    ).rows;
  }

  async neighbors(chunk: Chunk, signature: string) {
    return (
      await this.db.query<Chunk>(
        `SELECT ${columns} FROM knowledge_chunks
      WHERE document_id = $1 AND revision = $2 AND signature = $3
        AND position BETWEEN $4 AND $5 ORDER BY position`,
        [
          chunk.documentId,
          chunk.revision,
          signature,
          chunk.position - 1,
          chunk.position + 1,
        ],
      )
    ).rows;
  }

  async close() {
    try {
      await this.db.close();
    } finally {
      await this.release?.();
    }
  }
}
