# Cloudflare production setup

Cloudflare owns Viritura's public static edge. The ASP.NET API remains on the
current host until a separate backend migration:

- Cloudflare Pages: `viritura.com` and `app.viritura.com`;
- Cloudflare DNS, CDN, TLS, DDoS protection, and Free Managed WAF rules;
- Cloudflare R2: large static/application objects at `assets.viritura.com`;
- current host nginx/API container: `api.viritura.com`.

GitHub Pages can publish static files, but Cloudflare Pages is a better
production fit here because it provides deployment previews, instant rollback,
custom response headers, SPA routing, edge caching, and direct integration with
the rest of the Cloudflare security boundary.

## Pages projects

Create two Pages projects from the same Git repository. Use the v3 build image,
enable build caching, and set the production branch to `main`. Cloudflare's
GitHub App integration is the deployment identity; do not add a long-lived
Cloudflare API token to GitHub just to deploy Pages.

Production deployments are automatic from the configured production branch.
Monorepo build watch paths prevent unrelated server-only changes from building
the static projects.

Cloudflare Pages does not provide a per-pull-request manual approval button for
GitHub App previews. Automatic preview deployments are disabled with **Preview
branch control** set to **None**. Create ad hoc preview deployments from a
trusted workstation with Wrangler instead. Wrangler can upload a prebuilt
artifact to the existing Git-integrated project and attach it to a synthetic
preview branch:

VITE_VIRITURA_API_BASE_URL=https://api.viritura.com \
VITE_VIRITURA_ASSET_BASE_URL=https://assets.viritura.com \
bash scripts/build-cloudflare-pages.sh editor
npx wrangler pages deploy apps/editor/dist \
 --project-name viritura-app \
 --branch cf-preview-my-pr-or-topic \
 --commit-dirty=false

````

The resulting branch alias is
`https://cf-preview-my-pr-or-topic.viritura-app.pages.dev`. Use the same
pattern for the website:

```bash
VITE_VIRITURA_API_BASE_URL=https://api.viritura.com \
VITE_VIRITURA_ASSET_BASE_URL=https://assets.viritura.com \
bash scripts/build-cloudflare-pages.sh website
npx wrangler pages deploy dist \
  --project-name viritura-website \
  --branch cf-preview-my-pr-or-topic \
  --commit-dirty=false
````

This keeps routine PRs from consuming Pages build queue time. The tradeoff is
that Wrangler previews are manual artifacts: they do not automatically update
when the PR changes and they do not post the normal Cloudflare Pages GitHub
check/comment. Keep the path filters below even when automatic preview branch
deployments are disabled so production builds remain monorepo-aware.

If production needs a manual promotion gate later, prefer changing the Pages
production branch to a protected `production` or `release` branch instead of
storing Cloudflare deployment credentials in GitHub Actions.

### `viritura-website`

- Root directory: repository root
- Build command: `bash scripts/build-cloudflare-pages.sh website`
- Build output: `dist`
- Custom domains: `viritura.com`, `www.viritura.com`
- Build watch paths: `apps/website/*`, `apps/editor/*`, `packages/*`,
  `engine/*`, `scripts/*`, `docs/*`, `assets/*`, `build-site.ts`, and root
  package/build configuration files

The website build publishes the MNX project hub at `/mnx`, the playground at
`/mnx/playground`, and the public MNX Storybook at `/mnx/examples`. If the
canonical hostname should be apex-only, add a Cloudflare Redirect Rule from
`www.viritura.com` to `viritura.com`.

### `viritura-app`

- Root directory: repository root
- Build command: `bash scripts/build-cloudflare-pages.sh editor`
- Build output: `apps/editor/dist`
- Custom domain: `app.viritura.com`
- Build watch paths: `apps/editor/*`, `packages/*`, `engine/*`,
  `scripts/*`, `docs/spec/keyboard-shortcuts.md`, `assets/*`, and root
  package/build configuration files

Both projects require these production build variables:

```text
NODE_VERSION=22.16.0
PNPM_VERSION=9.15.4
VITE_VIRITURA_API_BASE_URL=https://api.viritura.com
VITE_VIRITURA_ASSET_BASE_URL=https://assets.viritura.com
```

Cloudflare's build image does not include Rust or `wasm-pack`. The repository
build script installs the pinned Rust toolchain from `engine/rust-toolchain.toml`
and `wasm-pack` 0.14.0 before rebuilding WASM. Pages builds time out after 20
minutes, so verify the first uncached build before switching DNS.

Configure preview builds with a staging API URL or leave authentication disabled
in previews. Do not point arbitrary preview origins at production auth: the API
uses an explicit CORS allow-list and production OAuth callbacks use canonical
origins.

The `_headers` and `_redirects` files under each application's `public`
directory provide security headers, immutable caching for fingerprinted assets,
HTML revalidation, cross-origin isolation for the editor, and SPA fallback
routing. The website Pages HTTP CSP intentionally contains only
`frame-ancestors 'self'` because Astro and the MNX Storybook emit their own CSP
meta policies with generated script/style hashes. The website post-build step
removes `wasm-unsafe-eval` from every page except `/mnx/`,
`/mnx/playground/`, and `/mnx/mxl-converter/`, the three routes that instantiate
the engraving engine. It also limits Monaco's
`style-src-elem 'unsafe-inline'` allowance to the playground and converter. Keep
`apps/website/scripts/scope-content-security-policy.ts` aligned with routes that
add either runtime.

The editor uses build-generated AJV standalone validators, so its script policy
does not require exact `unsafe-eval`. The narrower `wasm-unsafe-eval` remains on
the editor, public MNX Storybook, and the two website engraving routes.
Chromium, Firefox, and Safari support that CSP source expression; CSP hashes and
nonces authorize scripts but do not authorize WebAssembly compilation. See the
[CSP Level 3 WebAssembly algorithms](https://www.w3.org/TR/CSP3/#wasm-integration)
and [MDN's `script-src` reference](https://developer.mozilla.org/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src#unsafe_webassembly_execution).

## R2 assets

Cloudflare Pages limits each static asset to 25 MiB. The editor's production
SoundFont is approximately 119 MiB, so it cannot be included in a Pages deploy.
The Cloudflare build removes that one file and the playback package loads it
from the configured asset origin.

Current public asset configuration:

1. R2 Standard bucket `viritura-assets`.
2. SoundFont object `sounds/Shan-SGM-Pro-15.sf2`.
3. Custom domain `assets.viritura.com`.
4. Public `r2.dev` development URL disabled.
5. CORS allows `GET` and `HEAD`, the `Range` request header, and exposes
   `Accept-Ranges`, `Content-Length`, `Content-Range`, and `ETag`.
6. The SoundFont is uploaded with
   `Cache-Control: public, max-age=31536000, immutable`.
7. A cache rule applies to `assets.viritura.com/sounds/*`. The filename must
   change when its bytes change so immutable caching is safe.
8. Use a bucket-scoped write token only for future asset deployment automation.
   The running editor needs no R2 credential because the SoundFont is a public
   read.

R2 Standard currently includes 10 GB-month storage, one million Class A
operations, ten million Class B operations, and Internet egress at no charge
per month. Additional Standard storage is $0.015/GB-month. R2 is also the future
home for score attachments and generated exports, but do not move ordinary
fingerprinted Vite assets there; Pages serves those directly without request or
storage charges.

Database backups should use a separate private bucket and credentials from
public application assets.

## DNS

The authoritative `viritura.com` zone is in Cloudflare. Current production DNS:

- `viritura.com` CNAME `viritura-website.pages.dev`, proxied.
- `www.viritura.com` CNAME `viritura-website.pages.dev`, proxied.
- `app.viritura.com` CNAME `viritura-app.pages.dev`, proxied.
- `assets.viritura.com` R2 custom domain for `viritura-assets`, proxied.
- `api.viritura.com` A `104.236.162.149`, DNS-only.

Keep `api.viritura.com` pointed at the existing host unless and until the API
moves. Enable DNSSEC after the static cutover has been stable long enough for a
separate DNS maintenance window.

## API edge

If the API later moves to Railway, add the exact `CNAME` and verification `TXT`
records Railway supplies for `api.viritura.com`. Allow Railway to finish
certificate validation before changing proxy behavior.

Proxy `api.viritura.com` through Cloudflare when Railway's custom domain is
healthy:

- use SSL/TLS mode **Full (strict)**;
- do not cache `/auth/*`, `/account/*`, `/github/*`, `/live/*`, `/health`, or
  other API responses;
- preserve WebSocket support for `/live/signal`;
- enable the Free Managed WAF ruleset and review sampled Security Events; and
- use the one available Free-plan rate-limit rule only for a carefully selected
  high-abuse endpoint, retaining ASP.NET rate limiting as the authoritative
  application control.

Cloudflare is defense in depth, not the API's authentication or authorization
boundary.

## Optional Cloudflare services

### Turnstile

Turnstile Free supports up to 20 widgets and unlimited challenges. Add it only
when unrestricted registration or abuse demonstrates a need. Validate every
response server-side in the Railway API; hiding a submit button is not a
security boundary. Email verification and API rate limits remain required.

### Web Analytics

Cloudflare Web Analytics is free and does not use cookies, local storage, or
fingerprinting for its displayed analytics. The editor CSP allows Cloudflare's
auto-injected beacon script and RUM endpoint; if analytics is disabled in the
dashboard, those allowances can be removed in a later hardening pass. Keep the
privacy notice aligned with the production analytics processor state.

### Workers, Durable Objects, Queues, KV, and D1

Do not add these initially:

- Workers are useful later for small edge endpoints or signed R2 upload flows,
  not for replacing the current ASP.NET API.
- Durable Objects are a plausible future room coordinator if collaboration
  becomes server-authoritative, but the current P2P design does not need them.
- Queues are useful for asynchronous exports or email jobs only after those
  workloads exist.
- KV is suited to read-heavy edge configuration, not account records.
- D1 would duplicate the existing EF Core persistence architecture and require
  a backend rewrite.

Adopt a Cloudflare product when it removes a measured bottleneck or enables a
specific feature, not merely because it shares the provider.
