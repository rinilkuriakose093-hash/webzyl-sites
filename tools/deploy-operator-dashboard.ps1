# Deploy Operator Dashboard - Single Source of Truth
# This script uploads the operator dashboard to KV and deploys the worker

Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "Operator Dashboard Deployment" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""

$sourceFile = "_external\webzyl-operator\operator-dashboard.html"
$kvKey = "page:operator-dashboard"

# Step 1: Upload operator dashboard to KV
Write-Host "Step 1: Uploading operator dashboard to KV..." -ForegroundColor Yellow
Write-Host "Source: $sourceFile" -ForegroundColor Gray
Write-Host "KV Key: $kvKey" -ForegroundColor Gray
Write-Host ""

npx wrangler kv:key put --binding=RESORT_CONFIGS "$kvKey" --path="$sourceFile"

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ KV upload failed!" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Operator dashboard uploaded to KV" -ForegroundColor Green
Write-Host ""

# Step 2: Deploy worker
Write-Host "Step 2: Deploying worker..." -ForegroundColor Yellow
Write-Host ""

npx wrangler deploy

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Worker deployment failed!" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "=====================================" -ForegroundColor Green
Write-Host "✅ Deployment Complete!" -ForegroundColor Green
Write-Host "=====================================" -ForegroundColor Green
Write-Host ""
Write-Host "Operator Dashboard is now live at:" -ForegroundColor Green
Write-Host "  🔗 https://webzyl.com/operator?slug=grand-royal" -ForegroundColor Cyan
Write-Host ""
Write-Host "This is now the single source of truth for the operator dashboard." -ForegroundColor Gray
Write-Host ""
