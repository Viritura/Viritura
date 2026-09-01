# Production API container

The API runs as one container behind the host nginx instance. Its port is
published only on `127.0.0.1:5001`. SQLite, SQLite backups, and ASP.NET Data
Protection keys remain on the host under `/opt/viritura-api`.

This is the authoritative production API deployment. Configuration is loaded
from `/etc/viritura/api.env`, which must be owned by root with mode `0600`. The
deployment wrapper validates the file before building or restarting the API.
Use `api.env.example` as the key inventory, never as a real dotenv file.

Forwarded headers are accepted only from configured proxy addresses or CIDR
ranges. The active Compose template trusts Docker bridge addresses in
`172.16.0.0/12`; Kestrel remains published only on host loopback. If Docker is
configured with a narrower fixed subnet, replace that range with the exact
subnet. Never configure an unrestricted forwarded-header trust mode.

Railway remains an unconfigured future migration option. See
[../../docs/setup/production-secrets.md](../../docs/setup/production-secrets.md)
for the proposed provider-managed setup.

Routine application deployment uses the CI-only key stored in the protected
GitHub `production` Environment. The dedicated `viritura-deploy` account has no
general sudo or Docker access; it may run only the root-owned
`viritura-api-manage` wrapper through passwordless sudo. The manual **Deploy
API** GitHub Actions workflow uploads only the tested `dotnet publish` output,
then invokes
`sudo /usr/local/sbin/viritura-api-manage deploy`.

The wrapper takes root ownership of the archive before validating or extracting
it. The runtime Dockerfile, entrypoint, Compose definition, nginx
configuration, and environment file remain root-owned deployment
configuration; a release artifact cannot replace them. A host administrator
may use the local maintenance key for diagnostics, but not as an alternate
application deployment path. Install reviewed configuration changes separately
through an authenticated host-administration session:

```bash
sudo bash deploy/api/install-host-config.sh /path/to/reviewed/repository
```

This operator-only command installs the reviewed runtime files, API wrapper,
and API-specific sudoers fragment. It is not called by any deployment workflow.

Backups run from root's daily cron at 11:10 UTC. Retention matches Moomie:
seven daily backups, one weekly backup through day 35, and one monthly backup
through one year. The allowlisted wrapper also provides `status`, `logs`, and
`backup` actions; it does not grant general Docker, nginx, secret, or shell
access.

Restore only while the API container is stopped. Preserve the failed/current
database before replacing it with a validated backup, then restart the service
and verify `/health`.
