import { test } from "node:test";
import assert from "node:assert/strict";
import { readAiResponse, sourceKey, uniqueSources } from "../src/ai-stream";
import type { AiAnswer, AiStreamEvent } from "../shared/ai";

const answer: AiAnswer = {
  outcome: "no_answer",
  sources: [],
  paragraphs: [{ text: "No answer yet—try another guide.", sources: [] }],
};
function stream(events: AiStreamEvent[], width = 7) {
  const bytes = new TextEncoder().encode(
    events.map((event) => JSON.stringify(event)).join("\n"),
  );
  let offset = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (offset >= bytes.length) return controller.close();
        controller.enqueue(bytes.slice(offset, (offset += width)));
      },
    }),
    { headers: { "Content-Type": "application/x-ndjson" } },
  );
}

test("AI progress streams handle arbitrary byte boundaries, Unicode and a final line without a newline", async () => {
  const events: AiStreamEvent[] = [
    { type: "progress", progress: { phase: "searching", sources: [] } },
    { type: "progress", progress: { phase: "answering", sources: [] } },
    { type: "answer", answer },
  ];
  const received: AiStreamEvent[] = [];
  assert.deepEqual(
    await readAiResponse(
      stream(events, 1),
      (event) => received.push(event),
      new AbortController().signal,
    ),
    answer,
  );
  assert.deepEqual(received, events);
});

test("AI streams reject truncated answers, server errors and cancelled requests", async () => {
  const signal = new AbortController().signal;
  await assert.rejects(
    () =>
      readAiResponse(
        stream([
          { type: "progress", progress: { phase: "searching", sources: [] } },
        ]),
        () => {},
        signal,
      ),
    /ended early/,
  );
  await assert.rejects(
    () =>
      readAiResponse(
        stream([{ type: "error", message: "Library changed." }]),
        () => {},
        signal,
      ),
    /Library changed/,
  );
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    () =>
      readAiResponse(
        stream([{ type: "answer", answer }]),
        () => {},
        abort.signal,
      ),
    { name: "AbortError" },
  );
  const bad = new Response('{"type":', {
    headers: { "Content-Type": "application/x-ndjson" },
  });
  await assert.rejects(
    () => readAiResponse(bad, () => {}, signal),
    /interrupted/,
  );
});

test("AI stream readers support JSON responses and ordinary HTTP errors", async () => {
  const signal = new AbortController().signal;
  assert.deepEqual(
    await readAiResponse(Response.json(answer), () => {}, signal),
    answer,
  );
  await assert.rejects(
    () =>
      readAiResponse(
        Response.json({ message: "Busy." }, { status: 429 }),
        () => {},
        signal,
      ),
    /Busy/,
  );
});

test("progress sources keep a stable identity across events and drop repeated steps", () => {
  const source = (id: number, documentId: string, anchor: string) => ({
    id,
    documentId,
    title: documentId,
    section: "",
    step: "",
    anchor,
    revision: "r1",
    excerpt: "",
  });
  const first = [
    source(1, "handover", "step-1"),
    source(2, "handover", "step-2"),
  ];
  // A later event renumbers and repeats a step; identity must not follow the number.
  const second = [
    source(3, "handover", "step-1"),
    source(4, "handover", "step-1"),
    source(5, "tools", ""),
  ];
  assert.equal(sourceKey(first[0]), sourceKey(second[0]));
  assert.deepEqual(
    uniqueSources(second).map((s) => s.id),
    [3, 5],
  );
  assert.deepEqual(uniqueSources(first), first);
});
