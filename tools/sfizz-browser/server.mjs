import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureSfizzRuntime } from "./vendor/ensure-sfizz-runtime.mjs";

const host = "127.0.0.1";
const requestedPort = Number.parseInt(process.argv[2] ?? "4399", 10);
const root = path.dirname(fileURLToPath(import.meta.url));

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
]);

function resolveRequestPath(requestUrl) {
  const url = new URL(requestUrl, `http://${host}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const decoded = decodeURIComponent(pathname);
  const candidate = path.resolve(root, `.${decoded}`);
  const relative = path.relative(root, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  return candidate;
}

async function sendFile(response, filePath) {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) {
    response.writeHead(404).end("Not found");
    return;
  }
  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Length": fileStat.size,
    "Content-Type": contentTypes.get(path.extname(filePath)) ?? "application/octet-stream",
    "Cross-Origin-Opener-Policy": "same-origin",
  });
  createReadStream(filePath).pipe(response);
}

async function handleRequest(request, response) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end("Method not allowed");
    return;
  }
  try {
    const filePath = resolveRequestPath(request.url ?? "/");
    if (!filePath) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    await sendFile(response, filePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      response.writeHead(404).end("Not found");
      return;
    }
    console.error(error);
    response.writeHead(500).end("Internal server error");
  }
}

function listenOnAvailablePort(server, port, remainingAttempts) {
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE" && remainingAttempts > 0) {
      listenOnAvailablePort(server, port + 1, remainingAttempts - 1);
      return;
    }
    throw error;
  });
  server.listen(port, host, () => {
    const address = server.address();
    console.log(`sfizz browser proof server: http://${host}:${address.port}/`);
  });
}

await ensureSfizzRuntime();
listenOnAvailablePort(createServer(handleRequest), requestedPort, 20);
