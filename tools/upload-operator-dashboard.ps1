# Upload operator dashboard HTML to KV
# This ensures webzyl.com/operator serves the same content as webzyl-operator.pages.dev

$sourceFile = "_external\webzyl-operator\operator-dashboard.html"
$kvKey = "page:operator-dashboard"

Write-Host "📤 Uploading operator dashboard to KV..." -ForegroundColor Cyan
Write-Host "Source: $sourceFile" -ForegroundColor Gray
Write-Host "KV Key: $kvKey" -ForegroundColor Gray
Write-Host ""

# Upload to KV using wrangler
npx wrangler kv:key put --binding=RESORT_CONFIGS "$kvKey" --path="$sourceFile"

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Upload successful!" -ForegroundColor Green
    Write-Host ""
    Write-Host "The operator dashboard is now accessible at:" -ForegroundColor Green
    Write-Host "  🔗 https://webzyl.com/operator?slug=grand-royal" -ForegroundColor Cyan
    Write-Host ""
} else {
    Write-Host "❌ Upload failed!" -ForegroundColor Red
    exit 1
}
