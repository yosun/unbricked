# Deployment Guide

Unbricked v0 is a static SPA hosted on **AWS S3 + CloudFront**.

| Resource | Value |
|---|---|
| S3 bucket | `unbricked` |
| CloudFront distribution | `ERINU0TS4C07J` |
| CloudFront domain | `d30v5146yng2cg.cloudfront.net` |
| Custom domain | `beta.unbricked.xyz` |
| Region | `us-east-1` |

---

## Prerequisites

- **pnpm** — install via `brew install pnpm`
- **AWS CLI v2** — install via `brew install awscli`
- **`.env` file** at the project root with valid AWS credentials (see `.env` vars below)

### Required `.env` variables

```
AWS_ACCESS_KEY_ID=…
AWS_SECRET_ACCESS_KEY=…
AWS_DEFAULT_REGION=us-east-1
S3_BUCKET=unbricked
CF_DISTRIBUTION_ID=ERINU0TS4C07J
CF_DOMAIN=d30v5146yng2cg.cloudfront.net
SITE_URL=https://beta.unbricked.xyz
```

> **Never commit `.env`.** It is already listed in `.gitignore`.

---

## One-command deploy

```bash
./scripts/deploy.sh
```

This script:

1. Loads `.env`
2. Validates required environment variables
3. Runs `pnpm build` (TypeScript check + Vite production build)
4. Syncs `dist/` to the S3 bucket (`--delete` removes stale files)
5. Creates a CloudFront invalidation on `/*`

---

## Manual deploy (step-by-step)

```bash
# 1. Build
pnpm build

# 2. Upload to S3
aws s3 sync ./dist s3://unbricked --delete

# 3. Invalidate CDN cache
aws cloudfront create-invalidation \
  --distribution-id ERINU0TS4C07J \
  --paths "/*"
```

---

## Verification

- Open https://beta.unbricked.xyz and hard-refresh (`Cmd+Shift+R`).
- CloudFront edge propagation typically takes 1–2 minutes after invalidation.
- Check invalidation status:
  ```bash
  aws cloudfront get-invalidation \
    --distribution-id ERINU0TS4C07J \
    --id <INVALIDATION_ID>
  ```

## Rollback

There is no versioning beyond git. To rollback:

```bash
git checkout <previous-commit>
./scripts/deploy.sh
```
