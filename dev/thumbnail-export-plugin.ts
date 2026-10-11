import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import type { Plugin } from "vite";
import { VISIBLE_PRODUCTS } from "../src/data/catalog";
import { COLOR_STYLES } from "../src/lib/color-styles";
import { getThumbnailDefinition } from "../src/lib/catalog-thumbnail-contract";

const ENDPOINT = "/__catalog-export/assets";
const MAX_JSON_BYTES = 3 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");
const sha256 = (value: Buffer) => createHash("sha256").update(value).digest("hex");

class RequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function assertLocalOrigin(request: IncomingMessage) {
  const host = request.headers.host, origin = request.headers.origin;
  if (!host || typeof origin !== "string" || /[\s/@?#\\]/.test(host))
    throw new RequestError(403, "A same-origin localhost request is required.");
  const protocol = "encrypted" in request.socket && request.socket.encrypted ? "https:" : "http:";
  try {
    const expected = new URL(`${protocol}//${host}`);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(expected.hostname)
      || new URL(origin).origin !== expected.origin || origin !== new URL(origin).origin)
      throw new Error("origin");
  } catch { throw new RequestError(403, "A same-origin localhost request is required."); }
}

function readJson(request: IncomingMessage): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] ?? ""))
    throw new RequestError(415, "Content-Type must be application/json.");
  const length = request.headers["content-length"];
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_JSON_BYTES))
    throw new RequestError(413, "JSON exceeds the 3 MB limit.");
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    const cleanup = () => {
      request.off("data", onData); request.off("end", onEnd);
      request.off("error", onError); request.off("aborted", onAborted);
    };
    const onError = () => { cleanup(); reject(new RequestError(400, "Request body could not be read.")); };
    const onAborted = () => { cleanup(); reject(new RequestError(400, "Request body was interrupted.")); };
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_JSON_BYTES) {
        cleanup(); request.resume(); reject(new RequestError(413, "JSON exceeds the 3 MB limit."));
      } else chunks.push(chunk);
    };
    const onEnd = () => {
      cleanup();
      try { resolveBody(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(new RequestError(400, "Malformed JSON.")); }
    };
    request.on("data", onData); request.once("end", onEnd);
    request.once("error", onError); request.once("aborted", onAborted);
  });
}

function readPng(value: unknown): Buffer {
  if (typeof value !== "string" || !/^data:image\/png;base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
    throw new RequestError(400, "png must be a base64 PNG data URL.");
  const png = Buffer.from(value.slice("data:image/png;base64,".length), "base64");
  if (png.length < 45 || !png.subarray(0, 8).equals(PNG_SIGNATURE)
    || png.readUInt32BE(8) !== 13 || png.toString("ascii", 12, 16) !== "IHDR"
    || png.readUInt32BE(16) !== 480 || png.readUInt32BE(20) !== 400)
    throw new RequestError(400, "PNG must have a valid signature and measure 480 × 400.");
  let offset = 8, imageData = false, ended = false;
  while (offset + 12 <= png.length) {
    const size = png.readUInt32BE(offset), type = png.toString("ascii", offset + 4, offset + 8);
    if (offset + size + 12 > png.length) break;
    if (type === "IDAT" && size > 0) imageData = true;
    offset += size + 12;
    if (type === "IEND") { ended = size === 0 && offset === png.length; break; }
  }
  if (!imageData || !ended) throw new RequestError(400, "PNG data is incomplete.");
  return png;
}

async function atomicWrite(path: string, contents: Buffer | string) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, contents); await rename(temporary, path); }
  finally { await unlink(temporary).catch(() => {}); }
}

function respond(response: ServerResponse, status: number, body: unknown) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

/** Local authoring endpoint only; omitted entirely from production/preview servers. */
export function thumbnailExportPlugin(): Plugin {
  let writes = Promise.resolve();
  return {
    name: "hamilymart-thumbnail-export",
    apply: "serve",
    config: () => ({ server: { watch: { ignored: [/[\\/]public[\\/]thumbnails(?:[\\/]|$)/] } } }),
    configureServer(server) {
      const root = resolve(server.config.root, "public", "thumbnails");
      // A generated image must not reload the export page midway through its queue.
      server.watcher.unwatch(root);
      server.middlewares.use((request, response, next) => {
        if (request.url?.split("?", 1)[0] !== ENDPOINT) return next();
        void (async () => {
          try {
            assertLocalOrigin(request);
            if (request.method !== "POST") throw new RequestError(405, "Use POST for thumbnail exports.");
            const body = await readJson(request);
            if (!body || typeof body !== "object" || Array.isArray(body)) throw new RequestError(400, "Expected an export object.");
            const input = body as Record<string, unknown>;
            const styleIndex = COLOR_STYLES.findIndex(style => style.id === input.styleId);
            const product = VISIBLE_PRODUCTS.find(product => product.id === input.productId);
            if (styleIndex < 0 || !product) throw new RequestError(400, "Unknown style or product.");
            const style = COLOR_STYLES[styleIndex], png = readPng(input.png);
            // Paths and provenance come exclusively from trusted catalog definitions.
            const definition = getThumbnailDefinition(product.id, styleIndex);
            const job = writes.then(async () => {
              const modelSha256 = Object.fromEntries(await Promise.all(definition.parts.map(async part =>
                [part.id, sha256(await readFile(resolve(server.config.root, "public", "models", `${part.id}.glb`)))])));
              const pngSha256 = sha256(png);
              const manifestPath = join(root, "style-manifest.json");
              let manifest: Record<string, Record<string, unknown>> = {};
              try { manifest = JSON.parse(await readFile(manifestPath, "utf8")); }
              catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
              await mkdir(join(root, style.id), { recursive: true });
              await atomicWrite(join(root, style.id, `${product.id}.png`), png);
              if (style.id === "original") await atomicWrite(join(root, `${product.id}.png`), png);
              manifest[style.id] ??= {};
              manifest[style.id][product.id] = {
                renderer: "three-shared-v1", materialColors: definition.materialColors,
                materialHexColors: definition.materialHexColors, modelSha256, pngSha256,
              };
              await atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
              return pngSha256;
            });
            writes = job.then(() => undefined, () => undefined);
            const pngSha256 = await job;
            respond(response, 200, { ok: true, styleId: style.id, productId: product.id, pngSha256 });
          } catch (error) {
            if (!(error instanceof RequestError)) server.config.logger.error(`Thumbnail export failed: ${String(error)}`);
            respond(response, error instanceof RequestError ? error.status : 500,
              { ok: false, error: error instanceof RequestError ? error.message : "Thumbnail export could not be saved." });
          }
        })();
      });
    },
  };
}
