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

Website and editor builds are deployed independently through manual GitHub
Actions workflows. The API runs in Docker Compose with host-managed SQLite,
backups, Data Protection keys, and a root-owned environment file.

Cloudflare Pages, Cloudflare R2, and Railway are not configured. Their documents
describe a possible future migration, not the active production system.

## Deploy the website or editor

Open the repository's **Actions** tab, choose **Deploy website** or **Deploy
editor**, select the `main` branch, and run the workflow. Production jobs use
the protected `production` GitHub Environment.

Each workflow:

1. builds and tests the selected surface without access to deployment secrets;
2. uploads the build output as a short-lived GitHub Actions artifact;
3. passes that artifact to the environment-protected deployment job;
4. uploads it through the restricted `viritura-deploy` SSH account;
5. invokes the allowlisted `viritura-static-manage` command;
6. atomically switches the surface's `current` symlink and runs an HTTP smoke
   test.

The public MNX Storybook is part of the website artifact even though its
producer lives in `apps/editor`. The live roots are:

```text
/var/www/viritura/website/current
/var/www/viritura/editor/current
```

Each surface retains its five most recent release directories.

The website build imports the public guides from `docs/` at build time.
Changing a guide or `docs/spec/keyboard-shortcuts.md` therefore requires a new
static deployment. The editor imports the same keyboard reference into its Help
dialog, so shortcut changes also require redeploying the editor bundle.

## Deploy the API

To validate the same repository-root image locally before deployment, run
`pnpm build:api-image`. The root command restores/builds
`apps/server-ui/dist` through Turbo, then `server/Dockerfile.prebuilt` consumes
that declared output in a clean ASP.NET publish stage. Production deployment
continues to use the self-contained `server/Dockerfile`, whose Node stage builds
the same output because the restricted remote builder starts from a clean
worktree rather than a prepared host artifact.

Open the repository's **Actions** tab, choose **Deploy API**, select `main`, and
run the workflow. The API deployment is documented beside its host
configuration in [`deploy/api/README.md`](../../deploy/api/README.md). The
workflow:

1. validates the .NET solution and packages the selected commit;
2. uploads the source artifact to the restricted deploy account;
3. invokes the allowlisted `viritura-api-manage deploy` action;
4. verifies `https://api.viritura.com/health`.

The deploy account has no general Docker, nginx, secret-file, or root-shell
access.

## GitHub deployment credentials

The `production` Environment contains `SSH_HOST`, `SSH_USER`,
`SSH_PRIVATE_KEY`, and `SSH_KNOWN_HOSTS`. `SSH_USER` is
`viritura-deploy`. The private key belongs to GitHub Actions and is never stored
on the server; only its restricted public key is installed in the deployment
account. `SSH_KNOWN_HOSTS` contains the independently verified host key rather
than a value collected during a workflow run.

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
The one-time [`deploy/static/bootstrap.sh`](../../deploy/static/bootstrap.sh)
installation validates and installs the website and editor configurations,
then reloads nginx. Later static deployments do not have permission to modify
nginx.

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

Static deployment retains the five latest releases for each surface. A host
administrator can atomically repoint `current` to one of those directories, or
the known-good source revision can be redeployed through its workflow.

API rollback and database restore procedures are in
[`deploy/api/README.md`](../../deploy/api/README.md). Stop the API before
restoring SQLite and preserve the failed database for investigation.
