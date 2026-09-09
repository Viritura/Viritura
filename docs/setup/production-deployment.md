# Production deployment

This is the authoritative runbook for the production topology currently serving
Viritura.

## Current topology

Cloudflare is authoritative for DNS, serves the website and editor from
Cloudflare Pages, and owns the public static asset bucket. The API remains on
the standalone host:

```text
viritura.com        -> Cloudflare DNS -> Cloudflare Pages -> static website
www.viritura.com    -> Cloudflare DNS -> Cloudflare Pages -> static website
app.viritura.com    -> Cloudflare DNS -> Cloudflare Pages -> static editor
api.viritura.com    -> Cloudflare DNS -> host nginx -> API container on 127.0.0.1:5001
assets.viritura.com -> Cloudflare R2  -> public SoundFont and future large assets
```

Cloudflare Pages projects are configured for GitHub App based builds from
`main`; those builds are the website and editor production deployment path. The
API runs in Docker Compose with host-managed SQLite, backups, Data Protection
keys, and a root-owned environment file.

Cloudflare static setup is documented in [cloudflare.md](cloudflare.md).
Railway remains a possible future API migration, not the active API production
system. A hosting migration must not reintroduce local production deployment
commands.

## Deploy the website or editor

Pushes to `main` deploy the website and editor through the two Cloudflare Pages
projects:

- `viritura-website` publishes `viritura.com` and `www.viritura.com`.
- `viritura-app` publishes `app.viritura.com`.

The public MNX Storybook is part of the website Pages artifact even though its
producer lives in `apps/editor`.

The website build imports the public guides from `docs/` at build time.
Changing a guide or `docs/spec/keyboard-shortcuts.md` therefore requires a new
static deployment. The editor imports the same keyboard reference into its Help
dialog, so shortcut changes also require redeploying the editor bundle.

If a manual production promotion gate becomes necessary, use a protected Pages
production branch such as `production` or `release` rather than reintroducing
long-lived Cloudflare API tokens in GitHub Actions.

## Deploy the API

`pnpm build:api-image` remains the local source-build image check. Production
uses a narrower boundary: GitHub Actions builds the server UI, runs the .NET
tests, and uploads only the output of `dotnet publish`. The host packages those
binaries with a separately installed, root-owned runtime Dockerfile and
entrypoint.

Open the repository's **Actions** tab, choose **Deploy API**, select `main`, and
run the workflow. The API deployment is documented beside its host
configuration in [`deploy/api/README.md`](../../deploy/api/README.md). The
workflow:

1. validates the .NET solution and produces the API publish directory;
2. uploads only that compiled publish artifact to the restricted deploy
   account;
3. invokes the allowlisted `viritura-api-manage deploy` action;
4. verifies `https://api.viritura.com/health`.

The deploy account has no general Docker, nginx, secret-file, or root-shell
access. The root-owned API wrapper validates the archive before extraction and
injects the separately installed entrypoint into the image build context.
Workflow artifacts cannot replace the root-owned Dockerfile, entrypoint,
Compose definition, nginx configuration, or runtime environment file.
Changes to those files require a separate authenticated operator run of
`deploy/api/install-host-config.sh`; no GitHub deployment workflow invokes it.

## GitHub API deployment credentials

The `production` Environment contains `SSH_HOST`, `SSH_USER`,
`SSH_PRIVATE_KEY`, and `SSH_KNOWN_HOSTS`. `SSH_USER` is
`viritura-deploy`. The private key belongs to GitHub Actions and is never stored
on the server; only its restricted public key is installed in the deployment
account. `SSH_KNOWN_HOSTS` contains the independently verified host key rather
than a value collected during a workflow run.

The Environment's deployment branch policy allows only the exact `main` branch,
with administrator bypass disabled. The API workflow also checks
`github.ref == 'refs/heads/main'` on both its build and secret-bearing deploy
jobs. Keep both layers: the workflow guard fails closed before doing work, while
the Environment policy prevents a modified non-`main` workflow from receiving
production secrets.

## Host configuration changes

Application deployment workflows never install host configuration. Changes to
nginx, Dockerfiles, Compose policy, container entrypoints, deployment wrappers,
sudoers, backup jobs, or runtime secrets require an authenticated
host-administration session and independent review.

API deployment permissions live in `/etc/sudoers.d/viritura-api-deploy`. Legacy
static deployment wrappers may remain on an older host for rollback until an
operator removes them during host cleanup, but repository GitHub Actions no
longer use them.

Stage a reviewed repository checkout or configuration bundle on the host. For
API runtime and deployment-wrapper changes, run on the host:

```bash
sudo bash deploy/api/install-host-config.sh /path/to/reviewed/repository
```

For nginx changes, install the reviewed API vhost or shared snippet, validate
the complete configuration, and reload only after validation succeeds:

```bash
sudo install -o root -g root -m 0644 \
   deploy/nginx-snippets/viritura-security-headers.conf \
   /etc/nginx/snippets/
sudo install -o root -g root -m 0644 \
   deploy/nginx-api.viritura.com.conf \
   /etc/nginx/sites-available/api.viritura.com
sudo nginx -t
sudo systemctl reload nginx
```

Do not use an application deployment workflow to distribute or activate host
configuration changes.

## Production runtime configuration

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

## Nginx API configuration

The active checked-in host vhost is
[`deploy/nginx-api.viritura.com.conf`](../../deploy/nginx-api.viritura.com.conf).

Shared non-CSP security headers live in
[`deploy/nginx-snippets/viritura-security-headers.conf`](../../deploy/nginx-snippets/viritura-security-headers.conf).

## Post-deploy checks

After a static deployment:

1. confirm `https://viritura.com/docs` serves the Getting Started page;
2. open `https://app.viritura.com`, press `F1`, and confirm Help opens;
3. verify the Help dialog's **Read the full documentation** link;
4. switch the homepage feature tabs and confirm their content changes;
5. confirm the MNX Playground and MusicXML converter controls appear;
6. check response headers and the fingerprinted JS asset names;
7. smoke-test opening a sample score and rendering notation.

After an API deployment:

1. run the allowlisted status action;
2. request `/health`;
3. inspect the restricted API logs if health does not pass;
4. test one browser-authenticated API request from the editor.

## Rollback

Cloudflare Pages keeps deployment history for each static project. Roll back
the website or editor from the Cloudflare dashboard by selecting a previous
successful deployment for `viritura-website` or `viritura-app`.

API rollback and database restore procedures are in
[`deploy/api/README.md`](../../deploy/api/README.md). Stop the API before
restoring SQLite and preserve the failed database for investigation.
