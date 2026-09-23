import type { GitHttpRequest, GitHttpResponse, HttpClient } from "isomorphic-git";
import { getCsrfToken } from "../auth";

type CsrfTokenProvider = () => Promise<{ token: string; headerName: string }>;

export function createCredentialedGitHttpClient(
  csrfTokenProvider: CsrfTokenProvider = () => getCsrfToken(undefined, { force: true }),
): HttpClient {
  return {
    async request(request: GitHttpRequest): Promise<GitHttpResponse> {
      const body = request.body ? await collectBody(request.body) : undefined;
      const headers: Record<string, string> = { ...request.headers };
      if ((request.method ?? "GET").toUpperCase() === "POST") {
        const csrf = await csrfTokenProvider();
        headers[csrf.headerName] = csrf.token;
      }
      const response = await fetch(request.url, {
        method: request.method ?? "GET",
        headers,
        body,
        credentials: "include",
      });
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });
      return {
        url: response.url,
        method: request.method,
        statusCode: response.status,
        statusMessage: response.statusText,
        headers: responseHeaders,
        body: response.body ? streamChunks(response.body) : singleChunk(new Uint8Array(await response.arrayBuffer())),
      };
    },
  };
}

async function collectBody(body: AsyncIterableIterator<Uint8Array>): Promise<ArrayBuffer> {
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  for await (const chunk of body) {
    chunks.push(chunk);
    byteLength += chunk.byteLength;
  }
  const buffer = new ArrayBuffer(byteLength);
  const collected = new Uint8Array(buffer);
  let offset = 0;
  for (const chunk of chunks) {
    collected.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return buffer;
}

async function* streamChunks(stream: ReadableStream<Uint8Array>): AsyncIterableIterator<Uint8Array> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

async function* singleChunk(chunk: Uint8Array): AsyncIterableIterator<Uint8Array> {
  yield chunk;
}
