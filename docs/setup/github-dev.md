# GitHub Dev Setup

This page explains how to run the local Viritura GitHub integration without committing credentials. The normal editor, renderer, engine, and most tests do not require GitHub credentials. These steps are only needed for live OAuth, GitHub App install, and repository synchronization testing.

## What Each Contributor Needs

Each contributor who wants to test the live GitHub integration should create their own development GitHub App. Do not commit shared app secrets to the repository.

A maintainer can also distribute credentials for a shared development app out-of-band, but that should be treated like any other secret. For an open source repository, the safe default is: every contributor uses their own GitHub App and the machine-wide external API environment file.

## Create A Development GitHub App

Create a GitHub App under your personal account for local development.

Recommended local values:

```text
GitHub App name:       viritura-dev-<your-login>
Homepage URL:          http://editor.<any-worktree-slug>.viritura.localhost
Callback URL:          http://api.viritura.localhost/github/auth/callback
Setup URL:             http://api.viritura.localhost/github/auth/callback
Webhook:               Disabled for local development
Expire user tokens:    Enabled, if GitHub offers the option
```

The callback URL and setup URL intentionally point at the same local API route. OAuth returns include `code` and `state`; GitHub App installation returns include `installation_id` and `setup_action`. The API detects the installation setup callback and redirects back to the editor instead of treating it as a failed OAuth callback.

Configure these permissions:

```text
Repository permissions:
- Contents: Read and write
- Metadata: Read-only

Account permissions:
- Email addresses: Read-only, optional
```

GitHub App sign-in and installation are separate. Signing in authorizes Viritura
to act as the user. Repository synchronization also requires the app to be
installed for that repository. Viritura sends users to GitHub's native new
repository form and never needs `Administration: Read and write`.

After creating the app, note:

```text
App ID
Client ID
Client secret
App slug
Private key PEM
```

The private key is not used by the current OAuth/token broker yet, but it is needed for GitHub App JWT and installation-token work. Keep it local.

The editor does not hard-code the development app slug. It reads `/github/app` from the API, and the API builds the install URL from `Viritura:GitHub:AppSlug`. Local development can point at `viritura-dev`; production should use the production API's own GitHub App config when that app exists.

## Configure The Shared Dev-Stack API

The primary checkout owns one shared backend at
`http://api.viritura.localhost`. Every worktree editor uses that backend. Copy
the required entries from `infra/dev/.env.api.example` to the external path
printed by:

```powershell
pnpm dev:stack url
```

On Windows this is `%LOCALAPPDATA%\Viritura\dev\api.env`. Add:

```text
Viritura__GitHub__ClientId=<client-id>
Viritura__GitHub__ClientSecret=<client-secret>
Viritura__GitHub__AppSlug=<app-slug>
```

## Run The Local GitHub Flow

Start the shared API with hot reload from the primary checkout:

```powershell
pnpm dev:stack up backend
```

Start an editor from any worktree:

```powershell
pnpm dev:stack up
```

Use the Start Center GitHub panel or the bottom-left activity-bar account button to sign in. Install the local GitHub App on the account that will own test repositories, then refresh the account panel if needed. Before sign-in, the shared API should report:

```powershell
Invoke-RestMethod -Uri "http://api.viritura.localhost/github/app" | ConvertTo-Json -Compress
```

Expected shape:

```json
{"configured":true,"appSlug":"<app-slug>","clientId":"<client-id>","installUrl":"https://github.com/apps/<app-slug>/installations/new"}
{"connected":false,"viewer":null,"accessTokenExpiresAtUtc":null,"installation":null}
```

For production-like local testing of restart-safe GitHub connection cookies, configure a persistent Data Protection key directory:

```powershell
dotnet user-secrets set "DataProtection:KeysDirectory" "$PWD\.aspnet-data-protection-keys" --project server/Viritura.Api
```

The encrypted GitHub connection cookie lives in the browser as an HttpOnly cookie, but only the API can decrypt it. There is no server-side session table for this MVP. Persisting this key ring lets a restarted API read cookies it issued before the restart.

## Dev Containers

A dev container can automate most tool setup, dependency install, and non-secret defaults. It cannot safely automate everything:

- It cannot create a GitHub App for a contributor.
- It should not bake client secrets or private keys into the image or repository.
- It usually cannot trust an HTTPS certificate in the contributor's host OS without user approval.
- If the browser runs on the host while the API runs in the container, the host must still trust the certificate used by `https://localhost:5001`.

A future `.devcontainer` can still help by installing Node, pnpm, Rust, wasm-pack, and the .NET SDK; running `pnpm install`; initializing user-secrets; and printing the exact commands contributors must run for their own GitHub App credentials. The secret values should remain per-developer and local.

## Open Source Contributor Model

It is feasible for external contributors to work on Viritura without shared secrets:

- Frontend, engine, renderer, parser, and most tests run without GitHub credentials.
- GitHub UI tests mock the API and do not need live credentials.
- Live GitHub integration work requires either a personal development GitHub App or maintainer-provided dev credentials delivered out-of-band.
- Production app credentials should never be shared with contributors.

This keeps the repository open-source friendly while preserving the normal security boundary around OAuth client secrets and GitHub App private keys.
