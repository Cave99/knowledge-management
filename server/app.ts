import Fastify from "fastify";
import compress from "@fastify/compress";
import fastifyStatic from "@fastify/static";
import { readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import type { ServerResponse } from "node:http";
import { confinedAsset } from "./library";
import type { Library } from "../shared/library";

export async function createApp(options: {
  contentRoot: string;
  snapshot: () => Library;
  production?: boolean;
  webRoot?: string;
  onClient?: (response: ServerResponse) => void;
}) {
  const app = Fastify({ logger: !process.env.NODE_TEST_CONTEXT });
  await app.register(compress);
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
