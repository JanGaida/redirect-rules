trap { exit 1 }

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
chcp 65001 | Out-Null

Start-Job { Start-Sleep -Seconds 2; Start-Process "https://127.0.0.1:5173/" } | Out-Null

$exitCode = 0
$reason = "canceled / terminated by user"
try {
    npm run dev
    $exitCode = if ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } else { 0 }
    $reason = "exit code " + $exitCode
} catch {
    $exitCode = 1
    $reason = $_.Exception.Message
} finally {
    Write-Host ""
    Write-Host ("Dev server stopped (reason: " + $reason + ").") -ForegroundColor Red
    Write-Host ""
    exit $exitCode
}
