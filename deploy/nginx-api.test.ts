import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("nginx forwards supported Git pushes and exposes oversized-push errors", () => {
  const directory = mkdtempSync(join(tmpdir(), "viritura-nginx-test-"));
  try {
    // Exercise the production locations over loopback HTTP without production TLS keys.
    const vhost = readFileSync(new URL("./nginx-api.viritura.com.conf", import.meta.url), "utf8")
      .replace(/listen (?:\[::\]:)?443 ssl http2;/g, "listen 8080;")
      .replace(/^\s*(?:ssl_certificate|ssl_certificate_key|ssl_dhparam|include \/etc\/letsencrypt\/)[^\n]*\n/gm, "")
      .replace(/^\s*listen 8080;\n(?=\s*listen 8080;)/m, "");
    writeFileSync(
      join(directory, "nginx.conf"),
      `events {}
http {
    access_log off;
    include /fixtures/vhost.conf;
    server {
        listen 5001;
        add_header Access-Control-Allow-Origin "https://app.viritura.com" always;
        add_header Access-Control-Allow-Credentials "true" always;
        return 204;
    }
}
`,
    );
    writeFileSync(join(directory, "vhost.conf"), vhost);
    mkdirSync(join(directory, "snippets"));
    writeFileSync(
      join(directory, "snippets", "viritura-security-headers.conf"),
      readFileSync(new URL("./nginx-snippets/viritura-security-headers.conf", import.meta.url)),
    );
    const cases = [
      {
        name: "above-old-limit",
        bytes: 16 * 1024 * 1024 + 1,
        path: "/github/git/github.com/owner/repo.git/git-receive-pack",
        status: 204,
      },
      {
        name: "at-limit",
        bytes: 25 * 1024 * 1024,
        path: "/github/git/github.com/owner/repo.git/git-receive-pack",
        status: 204,
      },
      {
        name: "above-limit",
        bytes: 25 * 1024 * 1024 + 1,
        path: "/github/git/github.com/owner/repo.git/git-receive-pack",
        status: 413,
      },
      { name: "other-route", bytes: 16 * 1024 * 1024 + 1, path: "/auth/register", status: 413 },
    ];
    const script = `set -eu
nginx -t -c /fixtures/nginx.conf
nginx -c /fixtures/nginx.conf
trap 'nginx -s quit -c /fixtures/nginx.conf' EXIT
${cases
  .map(
    ({ name, bytes, path }) => `
head -c ${bytes} /dev/zero > /tmp/body
printf '\\nCASE ${name}\\n'
curl --silent --show-error --max-time 20 --include \\
    -H 'Origin: https://app.viritura.com' \\
    -H 'Content-Type: application/x-git-receive-pack-request' \\
    --data-binary @/tmp/body http://127.0.0.1:8080${path}
`,
  )
  .join("")}`;
    const result = spawnSync(
      "docker",
      [
        "run",
        "--rm",
        "--network",
        "none",
        "-i",
        "--mount",
        `type=bind,source=${directory},target=/fixtures,readonly`,
        "nginx:alpine",
        "sh",
      ],
      { input: script, encoding: "utf8", timeout: 120_000 },
    );
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    for (const { name, status } of cases) {
      const response = result.stdout.split(`CASE ${name}\n`)[1]?.split("\nCASE ")[0];
      assert.ok(response, `Missing response for ${name}: ${result.stdout}`);
      assert.match(response, new RegExp(`HTTP/1\\.1 ${status}\\b`), name);
      if (name === "other-route") continue;
      assert.equal(
        response.match(/^Access-Control-Allow-Origin: https:\/\/app\.viritura\.com\r?$/gim)?.length,
        1,
        name,
      );
      assert.match(response, /^Access-Control-Allow-Credentials: true\r?$/im, name);
      if (status === 413) {
        assert.match(response, /^Content-Type: application\/json\r?$/im);
        assert.match(response, /^X-Content-Type-Options: nosniff\r?$/im);
        assert.match(response, /^Vary: Origin\r?$/im);
        assert.deepEqual(JSON.parse(response.split("\r\n\r\n")[1]), {
          error: "Git push payload exceeds the 25 MiB limit.",
        });
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
