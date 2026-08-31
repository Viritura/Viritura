# Security Policy

## Supported versions

Viritura is currently a public-alpha project. Security fixes are applied to the
latest version on the `main` branch. Older commits and deployments are not
supported.

## Reporting a vulnerability

Do not report suspected vulnerabilities in a public issue, discussion, pull
request, or social-media post.

Use GitHub's **Report a vulnerability** form on this repository's Security page.
Include, when possible:

- the affected component and version or commit;
- steps to reproduce the issue;
- the security impact;
- a minimal proof of concept; and
- any suggested mitigation.

Reports will be acknowledged and investigated on a best-effort basis. Please
allow time to reproduce and fix the issue before public disclosure. Do not
access, modify, retain, or disclose data belonging to other users while testing.

## Scope

Reports about the Viritura application, API, authentication flows, collaboration
protocol, importers, renderers, and official deployment configuration are in
scope. Vulnerabilities that exist exclusively in an upstream dependency should
also be reported to that dependency's maintainers; include the Viritura impact
in a private report here when the dependency makes Viritura exploitable.

The following are generally out of scope unless they demonstrate concrete
security impact:

- denial-of-service tests against public infrastructure;
- automated scanner output without a reproducible vulnerability;
- social engineering or physical attacks;
- missing security headers without an exploit; and
- issues affecting unsupported browsers or modified deployments.

This policy does not authorize destructive testing or guarantee a bounty.
