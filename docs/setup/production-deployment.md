# Production deployment

This is the authoritative runbook for the production topology currently serving
Viritura.

## Current topology

The public origins run on the standalone `schemes.me` host:

```text
viritura.com      -> host nginx -> static website
app.viritura.com  -> host nginx -> static editor
api.viritura.com  -> host nginx -> API container on 127.0.0.1:5001
```

Static builds are uploaded over SSH and atomically swapped into place. The API
runs in Docker Compose with host-managed SQLite, backups, Data Protection keys,
and a root-owned environment file.

Cloudflare Pages, Cloudflare R2, and Railway are not configured. Their documents
describe a possible future migration, not the active production system.

## Deploy the website and editor

Run from a clean checkout of the revision you intend to publish:

```powershell
pnpm site:deploy
```

The command runs [deploy.ts](../../deploy.ts):

1. invoke `pnpm build:site`, which refreshes WASM once and restores/builds the
   website, editor, and public MNX Storybook producer outputs;
2. assemble those outputs in `dist/`;
3. stream a compressed archive to `peter@schemes.me`;
4. extract into a staging directory;
5. atomically swap the staged directory into `/var/www/peter/viritura`.

The website build imports the public guides from `docs/` at build time.
Changing a guide or `docs/spec/keyboard-shortcuts.md` therefore requires a new
static deployment. The editor imports the same keyboard reference into its Help
dialog, so shortcut changes also require redeploying the editor bundle.

### Faster variants

| Command                 | Use                                                       |
| ----------------------- | --------------------------------------------------------- |
| `pnpm site:deploy`      | Normal production build and upload                        |
| `pnpm site:deploy:fast` | Reuse the current WASM output, rebuild the site, upload   |
| `pnpm site:upload`      | Upload an already validated root `dist/` without building |

Use `site:upload` only when the exact `dist/` tree has already passed
validation. It deliberately does not prove that the bundle matches the current
source.

## Deploy the API

To validate the same repository-root image locally before deployment, run
`pnpm build:api-image`. The root command restores/builds
`apps/server-ui/dist` through Turbo, then `server/Dockerfile.prebuilt` consumes
that declared output in a clean ASP.NET publish stage. Production deployment
continues to use the self-contained `server/Dockerfile`, whose Node stage builds
the same output because the restricted remote builder starts from a clean
worktree rather than a prepared host artifact.

The API deployment is documented beside its host configuration in
[`deploy/api/README.md`](../../deploy/api/README.md). Routine releases:

1. upload a complete repository worktree to the restricted deploy account;
2. invoke the allowlisted `viritura-api-manage deploy` action;
3. verify container status and `https://api.viritura.com/health`.

The deploy account has no general Docker, nginx, secret-file, or root-shell
access.

## Production configuration

Runtime configuration lives in `/etc/viritura/api.env`, owned by root with mode
`0600`. Persistent API data lives under `/opt/viritura-api`.

Never copy the production environment file into a checkout. Use
[`deploy/api/api.env.example`](../../deploy/api/api.env.example) only as the
configuration-key inventory.

The API trusts forwarded scheme and client-address headers only from
`ForwardedHeaders__KnownProxies__*` and
`ForwardedHeaders__KnownNetworks__*`. The active Compose template supplies the
Docker bridge range and exposes Kestrel only on host loopback. Keep the trusted
range limited to the actual reverse-proxy hop.

## Nginx configuration

The checked-in vhosts are:

- [`deploy/nginx-viritura.com.conf`](../../deploy/nginx-viritura.com.conf);
- [`deploy/nginx-app.viritura.com.conf`](../../deploy/nginx-app.viritura.com.conf);
- [`deploy/nginx-api.viritura.com.conf`](../../deploy/nginx-api.viritura.com.conf).

Shared security headers live in
[`deploy/nginx-snippets/viritura-security-headers.conf`](../../deploy/nginx-snippets/viritura-security-headers.conf).
Treat these files as source-controlled reference configurations; installing or
reloading nginx remains an explicit host-administration step.

## Post-deploy checks

After a static deployment:

1. open `https://viritura.com/docs` and confirm the expected guide appears;
2. open `https://app.viritura.com`, press `F1`, and confirm Help opens;
3. verify the Help dialog's **Read the full documentation** link;
4. check response headers and the fingerprinted JS asset names;
5. smoke-test opening a sample score and rendering notation.

After an API deployment:

1. run the allowlisted status action;
2. request `/health`;
3. inspect the restricted API logs if health does not pass;
4. test one browser-authenticated API request from the editor.

## Rollback

The static uploader retains the previous live tree only during the atomic swap;
to roll back later, check out the known-good revision and deploy it again.

API rollback and database restore procedures are in
[`deploy/api/README.md`](../../deploy/api/README.md). Stop the API before
restoring SQLite and preserve the failed database for investigation.
