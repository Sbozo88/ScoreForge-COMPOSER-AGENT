#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-scoreforge-8b660}"
REGION="${REGION:-us-central1}"
SERVICE_NAME="${SERVICE_NAME:-score-converter}"

if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcloud CLI is required." >&2
  exit 1
fi

SECRET_VALUE="${CONVERTER_SECRET:-}"
if [ -z "$SECRET_VALUE" ]; then
  SECRET_VALUE="$(openssl rand -hex 32)"
  echo "Generated CONVERTER_SECRET (store this exact value in Firebase Secret Manager):"
  echo "  $SECRET_VALUE"
fi

echo "Deploying $SERVICE_NAME to Cloud Run in project $PROJECT_ID ($REGION)..."
gcloud run deploy "$SERVICE_NAME" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --source "$(cd "$(dirname "$0")" && pwd)" \
  --memory 12Gi \
  --cpu 4 \
  --no-cpu-throttling \
  --min-instances 1 \
  --max-instances 1 \
  --timeout 3600 \
  --no-allow-unauthenticated \
  --set-env-vars "CONVERTER_SECRET=$SECRET_VALUE,OMR_TIMEOUT=14400"

WORKER_URL="$(gcloud run services describe "$SERVICE_NAME" --project "$PROJECT_ID" --region "$REGION" --format='value(status.url)')"
echo ""
echo "Worker deployed at: $WORKER_URL"
echo "Next steps for Firebase privateStudio proxy:"
echo "  1. Set app/functions/.env with OWNER_UID=<your-uid>, APP_ORIGIN=https://$PROJECT_ID.web.app, CONVERTER_URL=$WORKER_URL"
echo "  2. Run: npx firebase functions:secrets:set CONVERTER_SECRET --project $PROJECT_ID"
echo "  3. Run: npm --prefix app/functions install && npx firebase deploy --only functions,hosting --config app/firebase.json --project $PROJECT_ID"
