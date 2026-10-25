import "dotenv/config";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { aiConfig } from "../server/ai-providers";
import { loadLibrary } from "../server/library";
import { chunkDocument, hash } from "../server/chunks";

// Public bundled examples only. Never use CONTENT_DIR here: Liquid's free
// endpoint may retain/train on inputs. The app's privacy settings stay intact.
const models = [
  {
    id: "baai/bge-large-en-v1.5",
    dimensions: undefined,
    query: "Represent this sentence for searching relevant passages: ",
    document: "",
    trainingAllowed: false,
    usdPerMillion: 0.01,
  },
  {
    id: "perplexity/pplx-embed-v1-0.6b",
    dimensions: 1024,
    query: "",
    document: "",
    trainingAllowed: false,
    usdPerMillion: 0.004,
  },
  {
    id: "liquid/lfm-2.5-embedding-350m:free",
    dimensions: undefined,
    query: "query: ",
    document: "document: ",
    trainingAllowed: true,
    usdPerMillion: 0,
  },
  {
    id: "openai/text-embedding-3-small",
    dimensions: 1024,
    query: "",
    document: "",
    trainingAllowed: false,
    usdPerMillion: 0.02,
  },
] as const;
const cases = [
  [
    "What must be passed to the next crew when a work shift ends?",
    "shift-handover",
    "cover-the-essentials",
  ],
  [
    "Who takes responsibility for abnormal equipment problems?",
    "shift-handover",
    "identify-anything-unusual",
  ],
  [
    "How do we verify the incoming crew knows what to do?",
    "shift-handover",
    "confirm-understanding",
  ],
  [
    "Where should the written handoff notes be kept afterwards?",
    "shift-handover",
    "after-the-handover",
  ],
  [
    "How should I format individual actions in a procedure?",
    "write-guide",
    "write-concrete-steps",
  ],
  [
    "How do we avoid two documents describing the same process?",
    "write-guide",
    "check-what-already-exists",
  ],
  [
    "Who is responsible for keeping an instruction document accurate?",
    "write-guide",
    "choose-an-owner",
  ],
  [
    "How can we discover confusing parts of a procedure before publishing?",
    "write-guide",
    "write-concrete-steps",
  ],
  [
    "What details should I send when reporting a problem to a colleague?",
    "team-help",
    "share-the-context",
  ],
  [
    "How do I tell someone whether I want advice, a review, or investigation?",
    "team-help",
    "make-the-next-step-clear",
  ],
  [
    "What should I do with the solution after someone answers my question?",
    "team-help",
    "close-the-loop",
  ],
  [
    "I need permission to use a shared tool. What should the request include?",
    "tools",
    "explain-what-you-need",
  ],
  [
    "I can open a page but cannot perform the required action. What next?",
    "tools",
    "check-that-it-works",
  ],
  [
    "How do I use a common template without editing the original?",
    "tools",
    "use-a-shared-template",
  ],
  [
    "Which outcomes and success criteria should be agreed before a project?",
    "project-check",
    "write-down-the-outcome",
  ],
  [
    "Who is accountable, who contributes, and who reviews a new project?",
    "project-check",
    "name-the-people",
  ],
  [
    "Where do I configure a different folder of Markdown documents?",
    "markdown-files",
    "put-the-file-in-the-knowledge-folder",
  ],
  [
    "Which metadata fields go at the top of a knowledge document?",
    "markdown-files",
    "describe-it-with-frontmatter",
  ],
  [
    "As a new starter, how should I learn a real working procedure?",
    "first-week",
    "follow-a-process-with-someone",
  ],
  [
    "How can a new employee learn who looks after each area?",
    "first-week",
    "meet-your-team",
  ],
] as const;
const probes = [
  "Before colleagues change shifts, how should unresolved incidents be described?",
  "Who should maintain the accuracy of a procedure over time?",
  "What should I send with my application for access to a shared resource?",
  "How should ownership and review responsibilities be set for a new project?",
  "How can a newcomer practice the procedures that the team follows?",
];

const key = aiConfig().openRouterKey;
if (!key)
  throw new Error(
    "Set OPENROUTER_API_KEY in .env before running this benchmark.",
  );
const library = await loadLibrary("knowledge");
assert.equal(
  hash(
    JSON.stringify(
      library.documents
        .map((doc) => [doc.path, doc.markdown])
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
  ),
  "f5fa03993271f55a4e749016e3e31fd5d650df9b111d9470eb85e01cbcd19323",
  "The bundled demo guides have changed. This benchmark may send inputs to a training-enabled free endpoint; use only a reviewed public fixture corpus.",
);
const chunks = library.documents.flatMap(chunkDocument);
assert.equal(
  library.documents.length,
  8,
  "This benchmark expects the eight bundled example guides.",
);
for (const [, doc, anchor] of cases)
  assert.ok(
    chunks.some((chunk) => chunk.documentId === doc && chunk.anchor === anchor),
    `Missing fixture: ${doc}#${anchor}`,
  );

async function embed(
  model: (typeof models)[number],
  texts: string[],
  query: boolean,
) {
  const started = performance.now();
  const response = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model.id,
      dimensions: model.dimensions,
      encoding_format: "float",
      input: texts.map((text) => (query ? model.query : model.document) + text),
      provider: {
        data_collection: model.trainingAllowed ? "allow" : "deny",
        sort: "latency",
      },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json();
  const ms = Math.round(performance.now() - started);
  // No retries: record outages as failures rather than hiding them in medians.
  if (!response.ok)
    throw new Error(
      `Embedding request returned HTTP ${response.status} after ${ms} ms`,
    );
  assert.equal(data.data?.length, texts.length, "Wrong vector count");
  const vectors: number[][] = new Array(texts.length);
  for (const item of data.data) {
    assert.ok(
      Number.isInteger(item.index) &&
        item.index >= 0 &&
        item.index < texts.length &&
        !vectors[item.index],
    );
    assert.ok(
      Array.isArray(item.embedding) &&
        item.embedding.length === 1024 &&
        item.embedding.every(
          (n: unknown) => typeof n === "number" && Number.isFinite(n),
        ),
    );
    const norm = Math.hypot(...item.embedding);
    assert.ok(norm > 0);
    vectors[item.index] = item.embedding.map((n: number) => n / norm);
  }
  return { vectors, ms };
}

interface Result {
  model: string;
  usdPerMillion: number;
  trainingAllowed: boolean;
  indexMs?: number;
  accuracyBatchMs?: number;
  top1?: number;
  top3?: number;
  mrr?: number;
  cases?: { question: string; expected: string; rank: number; top: string[] }[];
  latencyMs: number[];
  errors: string[];
}
const results: Result[] = models.map((model) => ({
  model: model.id,
  usdPerMillion: model.usdPerMillion,
  trainingAllowed: model.trainingAllowed,
  latencyMs: [],
  errors: [],
}));
for (let i = 0; i < models.length; i++) {
  const model = models[i];
  const result = results[i];
  console.log(`Indexing and evaluating ${model.id}`);
  try {
    const vectors: number[][] = [];
    const started = performance.now();
    for (let offset = 0; offset < chunks.length; offset += 16)
      vectors.push(
        ...(
          await embed(
            model,
            chunks.slice(offset, offset + 16).map((chunk) => chunk.input),
            false,
          )
        ).vectors,
      );
    result.indexMs = Math.round(performance.now() - started);
    const queries = await embed(
      model,
      cases.map(([query]) => query),
      true,
    );
    result.accuracyBatchMs = queries.ms;
    result.cases = cases.map(([question, doc, anchor], qi) => {
      const ranked = vectors
        .map((vector, index) => ({
          index,
          score: vector.reduce(
            (sum, n, j) => sum + n * queries.vectors[qi][j],
            0,
          ),
        }))
        .sort((a, b) => b.score - a.score);
      const rank =
        ranked.findIndex(
          ({ index }) =>
            chunks[index].documentId === doc && chunks[index].anchor === anchor,
        ) + 1;
      return {
        question,
        expected: `${doc}#${anchor}`,
        rank,
        top: ranked
          .slice(0, 3)
          .map(
            ({ index }) =>
              `${chunks[index].documentId}#${chunks[index].anchor}`,
          ),
      };
    });
    result.top1 = result.cases.filter((c) => c.rank === 1).length;
    result.top3 = result.cases.filter((c) => c.rank <= 3 && c.rank > 0).length;
    result.mrr =
      result.cases.reduce((sum, c) => sum + (c.rank ? 1 / c.rank : 0), 0) /
      cases.length;
    console.log(
      JSON.stringify({
        model: model.id,
        top1: result.top1,
        top3: result.top3,
        cases: cases.length,
        indexMs: result.indexMs,
      }),
    );
  } catch (error) {
    result.errors.push(
      error instanceof Error ? error.message : "Unknown benchmark failure",
    );
    console.log(
      JSON.stringify({ model: model.id, error: result.errors.at(-1) }),
    );
  }
}

// Rotate model order each round to distribute connection warm-up and drift.
for (let round = 0; round < probes.length; round++) {
  for (let offset = 0; offset < models.length; offset++) {
    const i = (round + offset) % models.length;
    try {
      const { ms } = await embed(models[i], [probes[round]], true);
      results[i].latencyMs.push(ms);
      console.log(
        JSON.stringify({ model: models[i].id, probe: round + 1, ms }),
      );
    } catch (error) {
      results[i].errors.push(
        error instanceof Error ? error.message : "Unknown probe failure",
      );
      console.log(
        JSON.stringify({
          model: models[i].id,
          probe: round + 1,
          error: results[i].errors.at(-1),
        }),
      );
    }
  }
}
const summary = results.map((result) => {
  const sorted = [...result.latencyMs].sort((a, b) => a - b);
  return {
    ...result,
    medianMs: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
    minMs: sorted[0] ?? null,
    maxMs: sorted.at(-1) ?? null,
  };
});
const report = {
  timestamp: new Date().toISOString(),
  corpusRevision: library.revision,
  documents: library.documents.length,
  chunks: chunks.length,
  questionCount: cases.length,
  dimensions: 1024,
  latencyProbes: probes.length,
  method:
    "Pure cosine retrieval; no keyword fast path, reranker, generation or answer cache. Model-recommended prefixes. Batch accuracy queries; separate single-query latency probes, rotating order, no retries. Public bundled examples only. OpenAI shortened to 1024 dimensions; BGE and Liquid use native 1024. Production index and configuration unchanged.",
  results: summary,
};
await mkdir("benchmarks", { recursive: true });
await writeFile(
  "benchmarks/embedding-results.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  "SUMMARY " +
    JSON.stringify(
      summary.map(({ model, medianMs, minMs, maxMs, top1, top3, errors }) => ({
        model,
        medianMs,
        minMs,
        maxMs,
        top1,
        top3,
        errors,
      })),
    ),
);
