# GitHub Dev Setup

This page explains how to run the local Viritura GitHub integration without committing credentials. The normal editor, renderer, engine, and most tests do not require GitHub credentials. These steps are only needed for live OAuth, GitHub App install, and repository creation testing.

## What Each Contributor Needs

Each contributor who wants to test the live GitHub integration should create their own development GitHub App. Do not commit shared app secrets to the repository.

A maintainer can also distribute credentials for a shared development app out-of-band, but that should be treated like any other secret. For an open source repository, the safe default is: every contributor uses their own GitHub App and local user-secrets.

## Create A Development GitHub App

Create a GitHub App under your personal account for local development.

Recommended local values:

```text
GitHub App name:       viritura-dev-<your-login>
Homepage URL:          http://localhost:5173
Callback URL:          https://localhost:5001/github/auth/callback
Setup URL:             https://localhost:5001/github/auth/callback
Webhook:               Disabled for local development
Expire user tokens:    Enabled, if GitHub offers the option
```

The callback URL and setup URL intentionally point at the same local API route. OAuth returns include `code` and `state`; GitHub App installation returns include `installation_id` and `setup_action`. The API detects the installation setup callback and redirects back to the editor instead of treating it as a failed OAuth callback.

For the current admin repository creation flow, configure these permissions:

```text
Repository permissions:
- Administration: Read and write
- Contents: Read and write
- Metadata: Read-only

Account permissions:
- Email addresses: Read-only, optional
```

The lower-permission future flow should avoid `Administration: Read and write` and require users to create/install repositories themselves. The current dev flow intentionally exercises the broader one-click repository creation path.

GitHub App sign-in and installation are separate. Signing in authorizes Viritura to act as the user, but repository creation also requires the app to be installed on the target account with the `Administration: Read and write` permission. After OAuth, the API checks `GET /user/installations` and reports whether the app is installed on the signed-in personal account with repository administration access. If GitHub returns `Resource not available by integration`, install the app on that account, then refresh the account popover or sign out and sign in again so the user token reflects the current app permissions.

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

## Store The Private Key Locally

From the repository root:

```powershell
New-Item -ItemType Directory -Force -Path ".secrets\github" | Out-Null
Copy-Item -LiteralPath "C:\Path\To\your-dev-app.private-key.pem" -Destination ".secrets\github\viritura-dev.private-key.pem"
git check-ignore -v ".secrets/github/viritura-dev.private-key.pem"
```

The repository ignores `.secrets/` and `*.private-key.pem`. `git check-ignore` should report a matching `.gitignore` rule.

## Configure .NET User-Secrets

Initialize user-secrets once for the API project. If the project already has a `UserSecretsId`, this step can be skipped.

```powershell
dotnet user-secrets init --project server/Viritura.Api
```

Then set your local GitHub App values:

```powershell
dotnet user-secrets set "Viritura:GitHub:ClientId" "<client-id>" --project server/Viritura.Api
dotnet user-secrets set "Viritura:GitHub:ClientSecret" "<client-secret>" --project server/Viritura.Api
dotnet user-secrets set "Viritura:GitHub:RedirectUri" "https://localhost:5001/github/auth/callback" --project server/Viritura.Api
dotnet user-secrets set "Viritura:GitHub:FrontendBaseUrl" "http://localhost:5173" --project server/Viritura.Api
dotnet user-secrets set "Viritura:GitHub:AppSlug" "<app-slug>" --project server/Viritura.Api
dotnet user-secrets set "Viritura:GitHub:AppId" "<app-id>" --project server/Viritura.Api
dotnet user-secrets set "Viritura:GitHub:PrivateKeyPath" ".secrets/github/viritura-dev.private-key.pem" --project server/Viritura.Api
```

Check that the keys exist without printing the client secret value:

```powershell
dotnet user-secrets list --project server/Viritura.Api |
  ForEach-Object { ($_ -split '\s*=\s*', 2)[0].Trim() } |
  Sort-Object
```

Expected keys:

```text
Viritura:GitHub:AppId
Viritura:GitHub:AppSlug
Viritura:GitHub:ClientId
Viritura:GitHub:ClientSecret
Viritura:GitHub:FrontendBaseUrl
Viritura:GitHub:PrivateKeyPath
Viritura:GitHub:RedirectUri
```

## Trust The Local HTTPS Certificate

The local API runs on HTTPS so secure auth cookies work during OAuth. Trust the ASP.NET Core development certificate once per machine:

```powershell
dotnet dev-certs https --trust
dotnet dev-certs https --check --trust
```

On Windows and macOS, the first command may open an OS trust prompt. Approve it. Browser-based OAuth testing may fail until the host OS trusts the certificate.

### Lifetime & renewal

ASP.NET Core dev certificates are valid for **1 year** from generation (this is fixed by the SDK and not configurable). There is **no auto-renewal** — when the cert expires (or after `dotnet dev-certs https --clean`, an SDK reinstall, or a profile change), you regenerate and re-trust it manually:

```powershell
dotnet dev-certs https --clean   # remove the old/expired cert
dotnet dev-certs https --trust   # regenerate + trust (approve the OS prompt)
```

After re-trusting, **fully restart the browser** (not just the tab — Chrome caches cert-trust per session) and restart the **Viritura: API** task so Kestrel re-binds with the new cert.

### Troubleshooting: `ERR_CERT_AUTHORITY_INVALID`

If the editor console shows `net::ERR_CERT_AUTHORITY_INVALID` on `https://localhost:5001` calls (`/auth/me`, `/github/app`, `/github/session`, …), the dev cert exists but the host OS no longer trusts it (commonly after a cert regeneration). Diagnose and fix:

```powershell
dotnet dev-certs https --check --trust   # exit 0 = trusted; non-zero (e.g. 7) = exists but untrusted
dotnet dev-certs https --trust           # re-trust the existing cert (approve the OS prompt)
```

Then hard-restart the browser. If it persists, run the full clean/regenerate above.

## Run The Local GitHub Flow

Start the API with hot reload. The `Viritura.Api` launch profile sets `Development` and binds HTTPS to `localhost:5001`:

```powershell
dotnet watch --project server/Viritura.Api run --launch-profile Viritura.Api
```

In VS Code, use **Run and Debug → Viritura: API (hot reload)**, or choose `api` in **Viritura: Dev (pick services)**.

Start the editor:

```powershell
pnpm --filter @viritura/editor dev -- --host 127.0.0.1 --port 5173
```

Open:

```text
http://localhost:5173
```

Use the Start Center GitHub panel or the bottom-left activity-bar account button to sign in. Install the local GitHub App on the account that will own test repositories, then refresh the account panel if needed. Before sign-in, the API should report:

```powershell
Invoke-RestMethod -SkipCertificateCheck -Uri "https://localhost:5001/github/app" | ConvertTo-Json -Compress
Invoke-RestMethod -SkipCertificateCheck -Uri "https://localhost:5001/github/session" | ConvertTo-Json -Compress
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
