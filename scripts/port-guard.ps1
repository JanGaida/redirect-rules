trap { exit 0 }

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
chcp 65001 | Out-Null

$port = 5173

function Get-PortOccupants {
    try {
        $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    } catch {
        return @()
    }
    if ($null -eq $connections) { return @() }

    $ownerIds = $connections |
        Select-Object -ExpandProperty OwningProcess -Unique

    $processes = foreach ($ownerId in $ownerIds) {
        try { Get-Process -Id $ownerId -ErrorAction Stop } catch { $null }
    }
    return @($processes | Where-Object { $null -ne $_ })
}

$occupants = Get-PortOccupants

if ($occupants.Count -eq 0) {
    Write-Host "Port $port is free. Proceeding." -ForegroundColor Green
    exit 0
}

Write-Host "Port $port is already in use:" -ForegroundColor Yellow
foreach ($process in $occupants) {
    Write-Host ("  PID {0} - {1}" -f $process.Id, $process.ProcessName) -ForegroundColor Yellow
}
Write-Host ""
Write-Host "Choose action:" -ForegroundColor Cyan
Write-Host "  a) ignore  (continue; dev server will likely fail if port stays busy)"
Write-Host "  b) kill    (terminate occupying process(es), then continue)"
Write-Host "  c) exit    (cancel; do not start dev server)"

while ($true) {
    $selection = (Read-Host "Selection (a/b/c)").Trim().ToLower()
    switch ($selection) {
        "a" { exit 0 }
        "b" {
            foreach ($process in $occupants) {
                try {
                    Stop-Process -Id $process.Id -Force -ErrorAction Stop
                    Write-Host ("Killed PID {0} ({1})" -f $process.Id, $process.ProcessName) -ForegroundColor Green
                } catch {
                    Write-Host ("Failed to kill PID {0}: {1}" -f $process.Id, $_.Exception.Message) -ForegroundColor Red
                }
            }
            Start-Sleep -Milliseconds 500
            exit 0
        }
        "c" {
            Write-Host "Canceled by user. Dev server not started." -ForegroundColor Red
            exit 1
        }
        default {
            Write-Host "Invalid choice. Please enter a, b, or c." -ForegroundColor Red
        }
    }
}