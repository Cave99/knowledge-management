export interface AiStatus {
  state: "disabled" | "indexing" | "ready" | "error";
  indexedChunks: number;
  totalChunks: number;
  message?: string;
}

export interface AiSource {
  id: number;
  documentId: string;
  title: string;
  section: string;
  step: string;
  anchor: string;
  revision: string;
  excerpt: string;
}

export interface AiAnswer {
  outcome: "answer" | "no_answer";
  paragraphs: { text: string; sources: number[] }[];
  sources: AiSource[];
  timing?: {
    retrievalMs: number;
    generationMs: number;
    totalMs: number;
    cacheHit: boolean;
    retrieval: "keyword" | "hybrid" | "empty";
  };
}

export interface AiProgress {
  phase: "searching" | "answering";
  sources: AiSource[];
}

export type AiStreamEvent =
  | { type: "progress"; progress: AiProgress }
  | { type: "answer"; answer: AiAnswer }
  | { type: "error"; message: string };
