# Groundops

pnpm monorepo for the Expo client and the Fastify server.

## Local infrastructure

PostgreSQL is the host service on port 5432. Create the application database once, as an OS user who can create databases:

```bash
createdb groundops
```

The server connects through the local socket as that OS user. Docker Compose runs NATS only.

```bash
docker compose up -d
cp .env.example .env
```

## Install and run

```bash
pnpm install
pnpm dev:server
pnpm dev:mobile
```

Server health: `http://localhost:3000/health`

The mobile app reads that endpoint using `EXPO_PUBLIC_API_URL` (default `http://localhost:3000`).

## Cloud

The API can run on AWS. GitHub Actions tests this repo and deploys `main`. Setup, secrets, and the health URL are in [docs/cloud.md](docs/cloud.md).
