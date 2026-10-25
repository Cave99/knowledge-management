import type { AiAnswer, AiSource, AiStreamEvent } from "../shared/ai";

// The server streams progress and complete, citation-validated answers. Never
// render partial provider JSON or unvalidated generated prose.
export async function readAiResponse(
  response: Response,
  onEvent: (event: AiStreamEvent) => void,
  signal: AbortSignal,
): Promise<AiAnswer> {
  signal.throwIfAborted();
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || "Ask AI is unavailable. Please try again.");
  }
  if (!response.headers.get("content-type")?.includes("application/x-ndjson")) {
    const answer: AiAnswer = await response.json();
    signal.throwIfAborted();
    return answer;
  }
  if (!response.body)
    throw new Error("The answer stream was unavailable. Please try again.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 128_000)
        throw new Error("The answer was too large. Please try again.");
      let newline: number;
      while (
        (newline = buffer.indexOf("\n")) !== -1 ||
        (done && buffer.trim())
      ) {
        const line = newline === -1 ? buffer : buffer.slice(0, newline);
        buffer = newline === -1 ? "" : buffer.slice(newline + 1);
        if (!line.trim()) continue;
        let event: AiStreamEvent;
        try {
          event = JSON.parse(line);
        } catch {
          throw new Error(
            "The answer stream was interrupted. Please try again.",
          );
        }
        if (!event || !["answer", "progress", "error"].includes(event.type))
          throw new Error("The answer stream was invalid. Please try again.");
        if (event.type === "error") throw new Error(event.message);
        onEvent(event);
        if (event.type === "answer") return event.answer;
      }
      if (done)
        throw new Error("The answer stream ended early. Please try again.");
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

// Retrieval sources are numbered per request; document + anchor identifies the
// same step across progress and answer events, so React keys stay stable.
export const sourceKey = (source: AiSource) =>
  `${source.documentId}#${source.anchor}`;

export function uniqueSources(sources: AiSource[]): AiSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = sourceKey(source);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
