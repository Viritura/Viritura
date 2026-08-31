# Build context is the repository root (see railway.json / deploy/api/manage.sh).
#
# Stage 1 builds the server-UI bundle from the pnpm workspace. Its vite build
# owns apps/server-ui/dist. The publish stage consumes that declared output and
# lets MSBuild fold it into wwwroot without generating assets in API source.
FROM node:22-slim AS server-ui
WORKDIR /repo
ENV CI=1
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY apps/server-ui/ ./apps/server-ui/
COPY packages/ui/ ./packages/ui/
# --frozen-lockfile keeps the install reproducible from pnpm-lock.yaml. The
# filter restricts the install to @viritura/server-ui and its workspace
# dependencies (@viritura/ui). --ignore-scripts skips the repo's git-hook
# `prepare` step, which is unnecessary and unavailable inside the image.
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @viritura/server-ui...
RUN pnpm --filter @viritura/ui build
RUN pnpm --filter @viritura/server-ui build

# Stage 2 publishes the ASP.NET Core API.
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY server/ ./
COPY --from=server-ui /repo/apps/server-ui/dist/ ../apps/server-ui/dist/
RUN dotnet restore Viritura.Api/Viritura.Api.csproj \
    && dotnet publish Viritura.Api/Viritura.Api.csproj \
        --configuration Release \
        --output /app/publish \
        --no-restore \
        /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
RUN apt-get update \
    && apt-get install --yes --no-install-recommends curl gosu sqlite3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /app/publish .
COPY server/docker-entrypoint.sh /usr/local/bin/viritura-api-entrypoint
RUN chmod 0755 /usr/local/bin/viritura-api-entrypoint

ENV ASPNETCORE_URLS=http://0.0.0.0:8080 \
    DOTNET_EnableDiagnostics=0
EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/viritura-api-entrypoint"]
CMD ["dotnet", "Viritura.Api.dll"]
