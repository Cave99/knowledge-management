import "dotenv/config";
import path from "node:path";
import type { ServerResponse } from "node:http";
import { watch } from "chokidar";
import { loadLibrary } from "./library";
import { createApp } from "./app";

const contentRoot = path.resolve(process.env.CONTENT_DIR || "knowledge");
let library = await loadLibrary(contentRoot);
const clients = new Set<ServerResponse>();
const app = await createApp({
  contentRoot,
  snapshot: () => library,
  production: process.env.NODE_ENV === "production",
  onClient(response) {
    clients.add(response);
    response.on("close", () => clients.delete(response));
  },
});

let running = false;
let queued = false;
async function refresh() {
  if (running) {
    queued = true;
    return;
  }
  running = true;
  try {
    do {
      queued = false;
      const next = await loadLibrary(contentRoot, library);
      if (next.revision !== library.revision) {
        library = next;
        for (const client of clients)
          client.write(`data: ${library.revision}\n\n`);
        app.log.info(
          {
            documents: library.documents.length,
            diagnostics: library.diagnostics,
          },
          "Knowledge library refreshed",
        );
      }
    } while (queued);
  } catch (error) {
    app.log.error(error, "Unable to refresh knowledge library");
  } finally {
    running = false;
  }
}

let debounce: ReturnType<typeof setTimeout>;
const watcher = watch(contentRoot, {
  ignoreInitial: true,
  followSymlinks: false,
  ignored: (filename) =>
    path
      .relative(contentRoot, filename)
      .split(path.sep)
      .some((part) => part.startsWith(".") || part === "node_modules"),
  awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
});
watcher.on("all", () => {
  clearTimeout(debounce);
  debounce = setTimeout(() => void refresh(), 80);
});
watcher.on("error", (error) =>
  app.log.error(error, "Knowledge folder watcher error"),
);
const reconcile = setInterval(() => void refresh(), 30_000);
await app.listen({ port: Number(process.env.PORT || 3001), host: "0.0.0.0" });
app.log.info(
  { contentRoot, documents: library.documents.length },
  "Knowledge library ready",
);

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  clearTimeout(debounce);
  clearInterval(reconcile);
  await watcher.close();
  for (const client of clients) client.end();
  await app.close();
}
process.on("SIGINT", () => void close());
process.on("SIGTERM", () => void close());
