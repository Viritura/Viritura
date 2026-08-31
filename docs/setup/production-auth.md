# Production authentication setup

This page lists the production switches and external setup required for the
public alpha. Configuration is server-authoritative: hiding a button in the UI
is not the security boundary.

## Early-access switches

Use the API runtime variables described in
[production-secrets.md](production-secrets.md). Add the invitation list and
feature switches to the root-owned `/etc/viritura/api.env` file:

```text
Features__Authentication__GoogleLoginEnabled=false
Features__Authentication__EmailRegistrationMode=AllowList
Features__Authentication__EmailRegistrationAllowList__0=first@example.com
Features__Authentication__EmailRegistrationAllowList__1=second@example.com
```

`EmailRegistrationMode` accepts:

- `Open`: any valid email can create an email/password account;
- `AllowList`: only listed addresses can create a new account; or
- `Disabled`: no new email/password accounts are created.

The allow-list is trimmed and compared case-insensitively. It is enforced only
when creating a new account and is never returned by the public capabilities
endpoint. Existing accounts can still sign in, reset a password, verify an
address, and use the mailbox-controlled password-linking flow.

Google OAuth is enabled only when `GoogleLoginEnabled=true` **and** both Google
client credentials are configured. It is disabled by default.

> The email allow-list does not restrict new accounts created through GitHub.
> If the alpha must be invitation-only across every provider, add a shared
> account-provisioning policy to the GitHub callback before opening the GitHub
> App publicly. Otherwise, treat the list as an email-signup throttle rather
> than a complete access gate.

## GitHub App

Create the production GitHub App under the Viritura organization with:

```text
Homepage URL: https://app.viritura.com
Callback URL: https://api.viritura.com/github/auth/callback
Setup URL:    https://api.viritura.com/github/auth/callback
Expire user authorization tokens: enabled
```

Current one-click repository creation requires:

```text
Repository permissions:
- Administration: read and write
- Contents: read and write
- Metadata: read-only

Account permissions:
- Email addresses: read-only (optional)
```

Configure these API-runtime secrets and settings in
`/etc/viritura/api.env`. The file is root-owned with mode `0600`:

```text
Viritura__GitHub__ClientId=
Viritura__GitHub__ClientSecret=
Viritura__GitHub__AppSlug=
Viritura__GitHub__RedirectUri=https://api.viritura.com/github/auth/callback
Viritura__GitHub__FrontendBaseUrl=https://app.viritura.com
Viritura__GitHub__AllowedFrontendOrigins__0=https://app.viritura.com
Viritura__GitHub__AllowedFrontendOrigins__1=https://viritura.com
```

The current server does not use the GitHub App private key or App ID. Keep the
private key in a secret manager if generated, but do not add unused values to
the deployment until installation-token support needs them. Leave webhooks
disabled unless `Viritura__GitHub__WebhookSecret` is configured and the webhook
endpoint is intentionally exposed.

Before launch, test sign-in, explicit account linking, installation, repository
creation, token refresh, disconnect, and API restart with persisted Data
Protection keys.

## Transactional email

Production uses the Resend HTTPS transport for Identity and Viritura security
messages. Outside Development, startup fails when `Email:Provider` is omitted
or set to `Console`; the console transport is development-only.

Configure the API runtime in `/etc/viritura/api.env`:

```text
Email__Provider=Resend
Email__Resend__ApiKey=re_...
Email__Resend__From=Viritura <accounts@mail.viritura.com>
Email__Resend__ReplyTo=support@viritura.com
```

`ReplyTo` is optional. `From` must use a domain verified in the same Resend
account as the API key. The API fails startup if the provider is `Resend` but
the key or sender is absent.

For Resend:

1. Verify a dedicated sending subdomain such as `mail.viritura.com`.
2. Publish the exact DKIM and SPF records Resend supplies.
3. Publish a DMARC record and monitor reports before tightening its policy.
4. Create a least-privilege production API key and store it only on the API
   host.
5. Choose and verify the From address and a monitored Reply-To address.
6. Test verification, password reset, 2FA recovery, email change, and security
   notification messages against real mailboxes at multiple providers.
7. Monitor bounces and complaints. Add webhook processing or an operational
   suppression procedure before volume grows.

Do not log message bodies, tokens, API keys, or full password-reset and
verification URLs in production.

## Abuse limits

The API applies IP-based endpoint limits plus storage- or recipient-level caps
that remain effective against distributed sources. Defaults are conservative
for the public alpha and can be overridden through environment variables:

| Variable                                         | Default | Purpose                                                 |
| ------------------------------------------------ | ------: | ------------------------------------------------------- |
| `RateLimits__PasswordResetEmailsPerEmailPerHour` |       3 | Bounds reset mail sent to one recipient                 |
| `RateLimits__VerificationEmailsPerEmailPerHour`  |       3 | Bounds verification mail across registration and resend |
| `Mcp__MaxDynamicClients`                         |   10000 | Bounds persistent OAuth dynamic-client rows             |

When the MCP client ceiling is reached, new registrations receive HTTP 503.
Raise it only with a corresponding retention or cleanup policy for unused
OpenIddict applications.
