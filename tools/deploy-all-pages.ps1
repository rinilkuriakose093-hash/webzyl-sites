# Deploy All Webzyl Pages - Complete Deployment Script
# This uploads all pages to KV and deploys the worker

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "Webzyl Complete Deployment" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

$errors = 0

# Step 1: Upload Homepage
Write-Host "Step 1/4: Uploading homepage..." -ForegroundColor Yellow
npx wrangler kv:key put --binding=RESORT_CONFIGS "template:brand-homepage" --path="webzyl-homepage/index.html"
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Homepage upload failed!" -ForegroundColor Red
    $errors++
} else {
    Write-Host "✅ Homepage uploaded" -ForegroundColor Green
}
Write-Host ""

# Step 2: Upload Admin Dashboard
Write-Host "Step 2/4: Uploading admin dashboard..." -ForegroundColor Yellow
npx wrangler kv:key put --binding=RESORT_CONFIGS "page:ceo-admin-dashboard" --path="webzyl-admin-dist/index.html"
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Admin dashboard upload failed!" -ForegroundColor Red
    $errors++
} else {
    Write-Host "✅ Admin dashboard uploaded" -ForegroundColor Green
}
Write-Host ""

# Step 3: Upload Operator Dashboard
Write-Host "Step 3/4: Uploading operator dashboard..." -ForegroundColor Yellow
npx wrangler kv:key put --binding=RESORT_CONFIGS "page:operator-dashboard" --path="_external/webzyl-operator/operator-dashboard.html"
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Operator dashboard upload failed!" -ForegroundColor Red
    $errors++
} else {
    Write-Host "✅ Operator dashboard uploaded" -ForegroundColor Green
}
Write-Host ""

# Step 4: Deploy Worker
Write-Host "Step 4/4: Deploying worker..." -ForegroundColor Yellow
npx wrangler deploy
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Worker deployment failed!" -ForegroundColor Red
    $errors++
} else {
    Write-Host "✅ Worker deployed" -ForegroundColor Green
}
Write-Host ""

# Summary
Write-Host "=========================================" -ForegroundColor Cyan
if ($errors -eq 0) {
    Write-Host "✅ Deployment Complete!" -ForegroundColor Green
    Write-Host "=========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "All Webzyl pages are now live:" -ForegroundColor Green
    Write-Host "  🏠 Homepage:           https://webzyl.com" -ForegroundColor Cyan
    Write-Host "  🎛️  Admin Dashboard:    https://webzyl.com/admin" -ForegroundColor Cyan
    Write-Host "  ⚙️  Operator Dashboard: https://webzyl.com/operator?slug=grand-royal" -ForegroundColor Cyan
    Write-Host ""
} else {
    Write-Host "❌ Deployment Failed with $errors error(s)" -ForegroundColor Red
    Write-Host "=========================================" -ForegroundColor Red
    exit 1
}
