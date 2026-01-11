# Verify Operator Dashboard Deployment

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Operator Dashboard Verification" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$url = "https://webzyl.com/operator?slug=grand-royal"

Write-Host "Testing: $url" -ForegroundColor Yellow
Write-Host ""

try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $url
    $html = $response.Content

    Write-Host "✓ Status Code: $($response.StatusCode)" -ForegroundColor Green
    Write-Host "✓ Content Length: $($html.Length) characters" -ForegroundColor Green

    if ($html -match "Operator Dashboard") {
        Write-Host "✓ Contains 'Operator Dashboard' title" -ForegroundColor Green
    } else {
        Write-Host "✗ Missing 'Operator Dashboard' title" -ForegroundColor Red
    }

    if ($html -match "api/config") {
        Write-Host "✓ Fetches config from API" -ForegroundColor Green
    } else {
        Write-Host "✗ Does not fetch config from API" -ForegroundColor Red
    }

    if ($html -match "webzyl.com") {
        Write-Host "✓ References webzyl.com domain" -ForegroundColor Green
    } else {
        Write-Host "✗ Does not reference webzyl.com" -ForegroundColor Red
    }

    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "✓ Operator Dashboard is LIVE!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Access at: $url" -ForegroundColor Cyan

} catch {
    Write-Host "✗ Error: $_" -ForegroundColor Red
    exit 1
}
