# Cloud

Source control stays on GitHub (`Wounded-Knee/GroundOps`). CI configuration lives in [`.github/workflows`](../.github/workflows). AWS runs one environment for the API: a load balancer, Fargate, Postgres, and the container registry. There is no CodeCommit repository, CodePipeline, CodeBuild project, or buildspec in AWS.

The default region is `us-east-1`. The load balancer serves HTTP on port 80. TLS needs a domain you control and an ACM certificate; that is not part of this setup.

Steady cost is about $50 per month. Most of that is the load balancer, plus a small Fargate task, a `db.t4g.micro` database, and a public IPv4 address. There is no NAT gateway.

## Runtime

Terraform in [`infra/`](../infra) creates:

- A VPC with two public subnets and two private subnets. Tasks run in the public subnets with public IPs so they can pull images and call Google APIs. Postgres stays in the private subnets and is not reachable from the internet.
- Security groups: the load balancer accepts port 80 from the internet, tasks accept port 3000 only from the load balancer, and Postgres accepts port 5432 only from the tasks.
- An ECR repository named `groundops-api`. The lifecycle policy keeps the ten newest images.
- An ECS cluster named `groundops` and a Fargate service named `groundops-api`. The task is 0.5 vCPU and 1 GB, split evenly between the API and NATS. The API listens on port 3000. NATS listens on `127.0.0.1:4222` inside that task. The service desired count is 1.
- An internet-facing application load balancer named `groundops`. Its idle timeout is 3600 seconds so websocket connections are not cut off at 60 seconds. The target group checks `GET /health` and expects HTTP 200. Tasks get 60 seconds before those checks count, so startup migrations can finish.
- RDS for PostgreSQL 16, class `db.t4g.micro`, 20 GB, encrypted, single-AZ, deletion protection on, backups kept for 7 days. The app database and user are both named `groundops`.
- Secrets Manager entries. `groundops/DATABASE_URL` is the Postgres URL with `sslmode=require`. The Google entries start as `replace-me` and are listed under [Secrets](#secrets). `NATS_URL` and `PORT` are ordinary task environment variables.

`GET /health` reports both Postgres and NATS. The task is healthy only when the response is HTTP 200.

NATS is a sidecar for that one task. Do not raise the desired count until NATS is a separate shared service. A second task would have its own NATS and would not see the other task's realtime messages.

Logs for both containers go to the CloudWatch log group `/ecs/groundops`.

The API image is the root [`Dockerfile`](../Dockerfile). It installs `@groundops/server` and `@groundops/contracts` with pnpm. On startup it waits until NATS accepts connections on `127.0.0.1:4222`, then runs `node --import tsx src/index.ts`. Schema migrations run on startup from `apps/server/drizzle`. The Expo app is not in the image.

## One-time bootstrap

Apply [`infra/bootstrap`](../infra/bootstrap) once from your machine, with credentials that can create IAM, S3, and DynamoDB. This stack uses local state. It creates the Terraform state bucket, the lock table, the GitHub OIDC provider, and the deploy role. That role is the trust GitHub Actions uses. It is not a pipeline.

```bash
cd infra/bootstrap
terraform init
terraform apply
```

For a region other than `us-east-1`:

```bash
terraform apply -var aws_region=us-west-2
```

Use that same region for the `AWS_REGION` repository variable. The state bucket is `groundops-tfstate-<account id>` in the bootstrap region. The lock table is `groundops-terraform-locks`.

If this account already has a GitHub OIDC provider, import it before apply:

```bash
terraform import aws_iam_openid_connect_provider.github \
  arn:aws:iam::<account-id>:oidc-provider/token.actions.githubusercontent.com
```

The role ARN to give GitHub:

```bash
terraform output -raw deploy_role_arn
```

The role can change this account's network, containers, load balancer, database, registry, logs, and secrets, and it can pass the `groundops-ecs-*` task roles to ECS. It can read and write the state bucket. It does not have full administrator access.

## GitHub repository variables

The deploy workflow reads these repository variables. It does not use long-lived AWS keys.

```bash
gh variable set AWS_ROLE_ARN --body "<deploy role arn>"
gh variable set AWS_REGION --body "us-east-1"
```

`AWS_REGION` defaults to `us-east-1` when it is unset. Set it when bootstrap used another region.

The role trusts only `repo:Wounded-Knee/GroundOps:ref:refs/heads/main`.

## CI

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on pull requests and on pushes:

- Node 22 and pnpm 11.21.0
- `pnpm install --frozen-lockfile`
- `cp .env.example .env`, because the server test script requires that file
- `pnpm typecheck`
- `pnpm --filter @groundops/server test`

Those tests do not open Postgres or NATS.

## Deploy

[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) runs after CI succeeds on `main`. It checks out that commit, assumes `AWS_ROLE_ARN`, and then:

1. Initializes Terraform against the bootstrap state bucket.
2. Applies the ECR repository so the registry exists.
3. Builds the root Dockerfile and pushes it to `groundops-api`, tagged with the full git SHA.
4. Applies the rest of [`infra/`](../infra) with that image tag.
5. Waits until the ECS service is stable.

`workflow_run` only starts once this workflow file is on the default branch. Merging it to `main` is what arms the first deploy. Later pushes to `main` deploy after CI passes. Pushes to other branches run CI only.

Deploys take the lock one at a time. A cold account spends most of the first run creating the database.

To apply the same stack by hand after bootstrap:

```bash
cd infra
account_id="$(aws sts get-caller-identity --query Account --output text)"
terraform init \
  -backend-config="bucket=groundops-tfstate-${account_id}" \
  -backend-config="region=us-east-1" \
  -backend-config="dynamodb_table=groundops-terraform-locks" \
  -backend-config="encrypt=true"
```

Push an image tagged with a git SHA before a full apply, then pass `-var image_tag=<sha>` and `-var aws_region=<region>`. The database password and URL live in Terraform state in the encrypted state bucket.

## Secrets

After the first apply, set the Google values. Later applies do not overwrite them. `groundops/DATABASE_URL` is generated from the database password and address. Leave that secret alone.

```bash
aws secretsmanager put-secret-value \
  --secret-id groundops/GOOGLE_WEB_CLIENT_ID \
  --secret-string "<web client id>"

aws secretsmanager put-secret-value \
  --secret-id groundops/GOOGLE_WEB_CLIENT_SECRET \
  --secret-string "<web client secret>"

aws secretsmanager put-secret-value \
  --secret-id groundops/GOOGLE_ANDROID_CLIENT_ID \
  --secret-string "<android client id>"

aws secretsmanager put-secret-value \
  --secret-id groundops/GOOGLE_IOS_CLIENT_ID \
  --secret-string "<ios client id>"

aws secretsmanager put-secret-value \
  --secret-id groundops/GOOGLE_MAPS_API_KEY \
  --secret-string "<server maps key>"
```

Tasks read secrets at start. Restart the service after changing them:

```bash
aws ecs update-service \
  --cluster groundops \
  --service groundops-api \
  --force-new-deployment
```

Until those values are set, the placeholders are `replace-me`. The process still starts. Sign-in and routing fail until the real values are in place.

## Health and the mobile app

The health URL is `http://<load-balancer-dns>/health`. After a deploy, from `infra/` with Terraform initialized:

```bash
terraform output -raw health_url
```

A healthy response is:

```json
{"ok":true,"postgres":"up","nats":"up"}
```

Point `EXPO_PUBLIC_API_URL` at `http://<load-balancer-dns>` when a device should use this API. Native clients do not need the local-only CORS rules in `apps/server/src/cors.ts`.
