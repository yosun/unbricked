#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Load .env ────────────────────────────────────────────────
ENV_FILE="$PROJECT_DIR/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌  .env not found at $ENV_FILE"
  echo "   Copy .env.example and fill in credentials."
  exit 1
fi

set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

# ── Validate required vars ───────────────────────────────────
for var in AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_DEFAULT_REGION S3_BUCKET CF_DISTRIBUTION_ID; do
  if [[ -z "${!var:-}" ]]; then
    echo "❌  Missing required env var: $var"
    exit 1
  fi
done

# ── Check prerequisites ─────────────────────────────────────
command -v aws >/dev/null 2>&1 || { echo "❌  aws CLI not found. Install: brew install awscli"; exit 1; }

# ── Build ────────────────────────────────────────────────────
echo "🔨  Building…"
cd "$PROJECT_DIR"
pnpm build

DIST_DIR="$PROJECT_DIR/dist"
if [[ ! -d "$DIST_DIR" ]]; then
  echo "❌  dist/ not found after build."
  exit 1
fi

# ── Deploy to S3 ─────────────────────────────────────────────
echo "🚀  Syncing dist/ → s3://$S3_BUCKET …"
aws s3 sync "$DIST_DIR" "s3://$S3_BUCKET" --delete

# ── Invalidate CloudFront ────────────────────────────────────
echo "🌐  Invalidating CloudFront distribution $CF_DISTRIBUTION_ID …"
INVALIDATION=$(aws cloudfront create-invalidation \
  --distribution-id "$CF_DISTRIBUTION_ID" \
  --paths "/*" \
  --query 'Invalidation.Id' \
  --output text)

echo ""
echo "✅  Deployed!"
echo "   Invalidation ID: $INVALIDATION"
echo "   Site: ${SITE_URL:-https://$CF_DOMAIN}"
echo "   CloudFront edge propagation takes 1-2 minutes."
