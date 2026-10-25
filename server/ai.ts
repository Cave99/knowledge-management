import type { AiAnswer, AiProgress, AiSource, AiStatus } from "../shared/ai";
import type { Library } from "../shared/library";
import { AiError, AiProviders, type AiConfig } from "./ai-providers";
import { AiStore } from "./ai-store";
import { CHUNK_VERSION, chunkDocument, hash, type Chunk } from "./chunks";

export interface KnowledgeAi {
  status(): AiStatus;
  ask(
    question: string,
    signal: AbortSignal,
    onProgress?: (progress: AiProgress) => void,
  ): Promise<AiAnswer>;
}

const noAnswer = (): AiAnswer => ({
  outcome: "no_answer",
  sources: [],
  paragraphs: [
    {
      text: "I couldn’t find an answer to that in your knowledge library. Try a more specific question, or add the missing information to a guide.",
      sources: [],
    },
  ],
});

export class RagService implements KnowledgeAi {
  private state: AiStatus;
  private store?: AiStore;
  private worker?: Promise<void>;
  private requested = false;
  private stopped = false;
  private indexedRevision = "";
  private abort = new AbortController();
  private providers: AiProviders;
  private signature: string;
  private answers = new Map<string, { answer: AiAnswer; expires: number }>();
  private queries = new Map<string, number[]>();

  constructor(
    private config: AiConfig,
    private snapshot: () => Library,
    private onError: (message: string) => void = () => {},
    fetcher?: typeof fetch,
  ) {
    this.providers = new AiProviders(config, fetcher);
    this.signature = hash(
      JSON.stringify([
        CHUNK_VERSION,
        config.embeddingModel,
        config.embeddingDimensions,
        "qwen-query-v1",
      ]),
    );
    this.state = {
      state:
        config.openRouterKey && config.inceptionKey ? "indexing" : "disabled",
      indexedChunks: 0,
      totalChunks: 0,
      ...(!config.openRouterKey || !config.inceptionKey
        ? {
            message:
              "Ask AI isn’t configured yet. Add the API keys to the server’s .env file and restart.",
          }
        : {}),
    };
  }

  status(): AiStatus {
    return { ...this.state };
  }

  refresh(): Promise<void> {
    if (this.stopped || this.state.state === "disabled")
      return Promise.resolve();
    this.requested = true;
    if (this.worker) return this.worker;
    this.worker = this.run()
      .catch((error) => {
        if (!this.stopped) {
          const message =
            error instanceof AiError
              ? error.message
              : "The knowledge index is unavailable. Check the server logs and try again shortly.";
          this.state = { ...this.state, state: "error", message };
          // Sanitized diagnostics only, never upstream bodies or credentials.
          this.onError(
            error instanceof AiError
              ? message
              : "Unable to update the AI index. Check AI_DATA_DIR permissions and that only one server owns it.",
          );
        }
      })
      .finally(() => {
        this.worker = undefined;
      });
    return this.worker;
  }

  private async run() {
    this.store ||= await AiStore.open(this.config.dataDir);
    while (this.requested && !this.stopped) {
      this.requested = false;
      const library = this.snapshot();
      if (
        library.revision === this.indexedRevision &&
        this.state.state === "ready"
      )
        continue;
      this.state = { ...this.state, state: "indexing", message: undefined };
      this.answers.clear();
      const chunks = library.documents.flatMap(chunkDocument);
      await this.store.sync(chunks, this.signature);
      await this.updateCounts();
      while (!this.stopped) {
        if (this.snapshot().revision !== library.revision) {
          this.requested = true;
          break;
        }
        const batch = await this.store.pending(this.signature);
        if (!batch.length) {
          this.indexedRevision = library.revision;
          this.state = { ...this.state, state: "ready" };
          break;
        }
        const vectors = await this.providers.embed(
          batch.map((chunk) => chunk.input),
          this.abort.signal,
        );
        await this.store.saveEmbeddings(batch, vectors, this.signature);
        await this.updateCounts();
      }
    }
  }

  private async updateCounts() {
    const count = await this.store!.counts(this.signature);
    this.state = {
      ...this.state,
      totalChunks: count.total,
      indexedChunks: count.indexed,
    };
  }

  async ask(
    question: string,
    signal: AbortSignal,
    onProgress?: (progress: AiProgress) => void,
  ): Promise<AiAnswer> {
    const started = performance.now();
    signal.throwIfAborted();
    if (this.state.state === "disabled" || this.state.state === "error")
      throw new AiError(this.state.message!);
    if (
      !this.store ||
      this.state.state !== "ready" ||
      this.snapshot().revision !== this.indexedRevision
    )
      throw new AiError(
        "Your knowledge library is still being indexed. Please try again shortly.",
      );
    const cacheKey = JSON.stringify([
      this.indexedRevision,
      this.config.inceptionModel,
      question.trim(),
    ]);
    const cached = this.answers.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      this.answers.delete(cacheKey);
      this.answers.set(cacheKey, cached);
      const answer = structuredClone(cached.answer);
      answer.timing = {
        ...answer.timing!,
        retrievalMs: 0,
        generationMs: 0,
        totalMs: performance.now() - started,
        cacheHit: true,
      };
      return answer;
    }
    if (cached) this.answers.delete(cacheKey);
    if (!this.state.totalChunks)
      return {
        ...noAnswer(),
        timing: {
          retrievalMs: 0,
          generationMs: 0,
          totalMs: performance.now() - started,
          cacheHit: false,
          retrieval: "empty",
        },
      };
    const combinedSignal = AbortSignal.any([
      signal,
      this.abort.signal,
      AbortSignal.timeout(65_000),
    ]);
    const library = this.snapshot();
    const revision = library.revision;
    const current = (chunk: Chunk) =>
      library.documents.some(
        (doc) => doc.id === chunk.documentId && doc.version === chunk.revision,
      );
    onProgress?.({ phase: "searching", sources: [] });
    const fast = (
      await this.store.fastMatches(question, this.signature)
    ).filter(current);
    const retrieval = fast.length ? "keyword" : "hybrid";
    const context = new Map<string, Chunk>();
    if (fast.length) {
      for (const chunk of fast) context.set(chunk.id, chunk);
    } else {
      let embedding = this.queries.get(question.trim());
      if (!embedding) {
        [embedding] = await this.providers.embed(
          [question],
          combinedSignal,
          true,
        );
        if (this.queries.size >= 256)
          this.queries.delete(this.queries.keys().next().value!);
        this.queries.set(question.trim(), embedding);
      }
      const matches = (
        await this.store.search(question, embedding, this.signature)
      ).filter(current);
      // Include neighbors so a retrieved action retains prerequisites and order.
      for (const match of matches) {
        if (context.size >= 10) break;
        context.set(match.id, match);
        for (const neighbor of await this.store.neighbors(
          match,
          this.signature,
        ))
          if (current(neighbor) && context.size < 10)
            context.set(neighbor.id, neighbor);
      }
    }
    const retrieved = performance.now();
    const retrievalMs = retrieved - started;
    if (!context.size)
      return {
        ...noAnswer(),
        timing: {
          retrievalMs,
          generationMs: 0,
          totalMs: performance.now() - started,
          cacheHit: false,
          retrieval,
        },
      };
    const chunks = [...context.values()].sort(
      (a, b) =>
        a.documentId.localeCompare(b.documentId) || a.position - b.position,
    );
    const sources: AiSource[] = chunks.map((chunk, i) => ({
      id: i + 1,
      documentId: chunk.documentId,
      title: chunk.title,
      section: chunk.section,
      step: chunk.step,
      anchor: chunk.anchor,
      revision: chunk.revision,
      excerpt: chunk.body.slice(0, 280),
    }));
    combinedSignal.throwIfAborted();
    if (this.snapshot().revision !== revision)
      throw new AiError(
        "The knowledge library changed while searching. Please ask again for the latest version.",
        409,
      );
    onProgress?.({ phase: "answering", sources });
    const generated = await this.providers.answer(
      question,
      chunks.map((chunk, i) => ({
        id: i + 1,
        process: chunk.title,
        section: chunk.section,
        step: chunk.step,
        order: chunk.position,
        text: chunk.body,
      })),
      combinedSignal,
    );
    combinedSignal.throwIfAborted();
    if (this.snapshot().revision !== revision)
      throw new AiError(
        "The knowledge library changed while answering. Please ask again for the latest version.",
        409,
      );
    const timing: NonNullable<AiAnswer["timing"]> = {
      retrievalMs,
      generationMs: performance.now() - retrieved,
      totalMs: performance.now() - started,
      cacheHit: false,
      retrieval,
    };
    if (!generated.answerable) return { ...noAnswer(), timing };
    const cited = new Set(
      generated.paragraphs.flatMap((paragraph) => paragraph.sources),
    );
    const answer: AiAnswer = {
      outcome: "answer",
      paragraphs: generated.paragraphs,
      sources: sources.filter((source) => cited.has(source.id)),
      timing,
    };
    if (this.answers.size >= 128)
      this.answers.delete(this.answers.keys().next().value!);
    this.answers.set(cacheKey, {
      answer: structuredClone(answer),
      expires: Date.now() + 5 * 60_000,
    });
    return answer;
  }

  async close() {
    this.stopped = true;
    this.abort.abort();
    await this.worker;
    await this.store?.close();
  }
}
