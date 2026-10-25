import Fastify from "fastify";
import compress from "@fastify/compress";
import fastifyStatic from "@fastify/static";
import rateLimit from "@fastify/rate-limit";
import { readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import type { ServerResponse } from "node:http";
import { confinedAsset } from "./library";
import type { Library } from "../shared/library";
import type { KnowledgeAi } from "./ai";
import { AiError } from "./ai-providers";
import type { AiStreamEvent } from "../shared/ai";

export async function createApp(options: {
  contentRoot: string;
  snapshot: () => Library;
  production?: boolean;
  webRoot?: string;
  onClient?: (response: ServerResponse) => void;
  ai?: KnowledgeAi;
}) {
  const app = Fastify({
    logger: !process.env.NODE_TEST_CONTEXT,
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  });
  await app.register(compress);
  await app.register(rateLimit, { global: false });
  const disabledAi = {
    state: "disabled",
    indexedChunks: 0,
    totalChunks: 0,
    message:
      "Ask AI isn’t configured yet. Add the API keys to the server’s .env file and restart.",
  };
  app.get("/api/ai/status", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    return options.ai?.status() || disabledAi;
  });
  let answering = 0;
  app.post<{ Body: { question: string } }>(
    "/api/ai/ask",
    {
      bodyLimit: 8192,
      config: { rateLimit: { max: 12, timeWindow: "1 minute" } },
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["question"],
          properties: {
            question: { type: "string", minLength: 1, maxLength: 2000 },
          },
        },
      },
    },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const question = request.body.question.trim();
      if (!question)
        return reply.code(400).send({ message: "Enter a question first." });
      if (!options.ai)
        return reply.code(503).send({ message: disabledAi.message });
      if (answering >= 2)
        return reply
          .code(429)
          .send({ message: "Ask AI is busy. Please try again shortly." });
      const controller = new AbortController();
      const disconnected = () => {
        if (!reply.raw.writableEnded) controller.abort();
      };
      reply.raw.on("close", disconnected);
      answering++;
      const streaming = request.headers.accept?.includes(
        "application/x-ndjson",
      );
      const send = (event: AiStreamEvent) => {
        if (!reply.raw.destroyed && !reply.raw.writableEnded)
          reply.raw.write(JSON.stringify(event) + "\n");
      };
      if (streaming) {
        reply.hijack();
        reply.raw.writeHead(200, {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Accel-Buffering": "no",
          "X-Content-Type-Options": "nosniff",
        });
        reply.raw.flushHeaders();
        send({
          type: "progress",
          progress: { phase: "searching", sources: [] },
        });
      }
      try {
        const answer = await options.ai.ask(
          question,
          controller.signal,
          (progress) => {
            if (streaming && progress.phase !== "searching")
              send({ type: "progress", progress });
          },
        );
        if (streaming) {
          send({ type: "answer", answer });
          reply.raw.end();
          return reply;
        }
        if (answer.timing)
          reply.header(
            "Server-Timing",
            `retrieval;dur=${answer.timing.retrievalMs.toFixed(1)}, generation;dur=${answer.timing.generationMs.toFixed(1)}, total;dur=${answer.timing.totalMs.toFixed(1)}`,
          );
        return answer;
      } catch (error) {
        if (streaming) {
          send({
            type: "error",
            message:
              error instanceof AiError
                ? error.message
                : "Ask AI couldn’t finish this answer. Please try again.",
          });
          reply.raw.end();
          return reply;
        }
        if (error instanceof AiError)
          return reply.code(error.statusCode).send({ message: error.message });
        return reply.code(503).send({
          message: "Ask AI couldn’t finish this answer. Please try again.",
        });
      } finally {
        answering--;
        reply.raw.off("close", disconnected);
      }
    },
  );
  app.get("/api/library", async (request, reply) => {
    const library = options.snapshot();
    const etag = `"${library.revision}"`;
    reply.header("Cache-Control", "no-cache").header("ETag", etag);
    if (request.headers["if-none-match"] === etag)
      return reply.code(304).send();
    return library;
  });
  app.get<{ Params: { id: string } }>(
    "/api/documents/:id/raw",
    async (request, reply) => {
      const doc = options
        .snapshot()
        .documents.find((item) => item.id === request.params.id);
      if (!doc) return reply.code(404).send({ message: "Document not found" });
      return reply
        .type("text/plain; charset=utf-8")
        .header(
          "Content-Disposition",
          `attachment; filename="${path.basename(doc.path).replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
        )
        .send(doc.markdown);
    },
  );
  app.get<{ Params: { "*": string } }>(
    "/api/assets/*",
    async (request, reply) => {
      try {
        const filename = await confinedAsset(
          options.contentRoot,
          request.params["*"],
        );
        const extension = path.extname(filename).toLowerCase();
        const types: Record<string, string> = {
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".webp": "image/webp",
          ".gif": "image/gif",
          ".avif": "image/avif",
          ".svg": "image/svg+xml",
          ".pdf": "application/pdf",
        };
        return reply
          .type(types[extension])
          .header("X-Content-Type-Options", "nosniff")
          .header(
            "Content-Security-Policy",
            "default-src 'none'; style-src 'unsafe-inline'; sandbox",
          )
          .send(createReadStream(filename));
      } catch {
        return reply.code(404).send({ message: "Asset not found" });
      }
    },
  );
  app.get("/api/events", (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write(`data: ${options.snapshot().revision}\n\n`);
    options.onClient?.(reply.raw);
    const heartbeat = setInterval(
      () => reply.raw.write(": heartbeat\n\n"),
      20_000,
    );
    request.raw.on("close", () => clearInterval(heartbeat));
  });
  app.get("/api/health", async () => ({
    status: "ok",
    documents: options.snapshot().documents.length,
  }));
  if (options.production) {
    const dist = path.resolve(options.webRoot || "dist");
    await app.register(fastifyStatic, {
      root: dist,
      wildcard: false,
      maxAge: 0,
      setHeaders(response, filename) {
        if (filename.startsWith(path.join(dist, "assets") + path.sep))
          response.header(
            "Cache-Control",
            "public, max-age=31536000, immutable",
          );
      },
    });
    app.setNotFoundHandler(async (request, reply) => {
      if (
        request.url.startsWith("/api/") ||
        request.url.startsWith("/assets/") ||
        request.url.startsWith("/fonts/")
      )
        return reply.code(404).send({ message: "Not found" });
      return reply
        .type("text/html")
        .header("Cache-Control", "no-cache")
        .send(await readFile(path.join(dist, "index.html")));
    });
  }
  return app;
}
