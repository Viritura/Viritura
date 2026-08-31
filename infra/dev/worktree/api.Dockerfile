# syntax=docker/dockerfile:1
#
# Hot-reload API image for per-worktree development. Source is bind-mounted at
# runtime; restore output seeds the nested obj volumes declared in Compose.
FROM mcr.microsoft.com/dotnet/sdk:10.0

WORKDIR /workspace
COPY server/ ./server/
RUN dotnet restore server/Viritura.Api/Viritura.Api.csproj

ENV ASPNETCORE_URLS=http://0.0.0.0:8080 \
    DOTNET_USE_POLLING_FILE_WATCHER=1 \
    DOTNET_CLI_TELEMETRY_OPTOUT=1

EXPOSE 8080

CMD ["sh", "-c", "mkdir -p /var/lib/viritura/data /var/lib/viritura/data-protection-keys && exec dotnet watch --non-interactive --project server/Viritura.Api run --no-launch-profile"]
