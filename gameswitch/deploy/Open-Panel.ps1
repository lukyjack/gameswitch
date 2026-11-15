#Requires -Version 5.1
<#
.SYNOPSIS
Opens the private GameSwitch panel through the existing SSH configuration.
.DESCRIPTION
Run this script in PowerShell on Windows. Keep the terminal open while using
the panel; Ctrl+C closes the tunnel. The gameswitch-netcup SSH alias and its
verified host key must already exist. No keys or credentials are stored here.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$sshCommand = Get-Command ssh.exe -CommandType Application -ErrorAction SilentlyContinue
if (-not $sshCommand) {
    throw 'Windows OpenSSH fehlt. Installiere den OpenSSH-Client und starte das Skript erneut.'
}

$panelUrl = 'http://127.0.0.1:3001'
$portProbe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 3001)
try {
    $portProbe.Start()
}
catch {
    throw 'Port 3001 ist lokal bereits belegt. Beende den lokalen Entwicklungsserver oder einen vorhandenen Panel-Tunnel und starte das Skript erneut.'
}
finally {
    $portProbe.Stop()
}

$startInfo = [System.Diagnostics.ProcessStartInfo]::new()
$startInfo.FileName = $sshCommand.Source
$startInfo.UseShellExecute = $false
$startInfo.CreateNoWindow = $true
# Arguments are fixed literals; no shell interpolation or credentials are used.
$startInfo.Arguments = '-N -T -L 127.0.0.1:3001:127.0.0.1:3001 -o BatchMode=yes -o StrictHostKeyChecking=yes -o ExitOnForwardFailure=yes -o IdentitiesOnly=yes -o ForwardAgent=no -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no -o ConnectTimeout=10 -o ServerAliveInterval=30 -o ServerAliveCountMax=3 gameswitch-netcup'

$tunnel = $null
try {
    Write-Host 'Verbinde das private GameSwitch-Panel ...'
    $tunnel = [System.Diagnostics.Process]::Start($startInfo)
    $ready = $false
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($tunnel.HasExited) {
            throw "SSH wurde mit Status $($tunnel.ExitCode) beendet. Pruefe den SSH-Alias gameswitch-netcup, den gespeicherten Hostschluessel und deinen Schluesselzugang."
        }
        try {
            $session = Invoke-RestMethod -Uri "$panelUrl/api/session" -Method Get -TimeoutSec 2
            if ($session.PSObject.Properties.Name -contains 'authenticated') {
                $ready = $true
                break
            }
        }
        catch {
            # The SSH connection or the remote panel may still be starting.
        }
        Start-Sleep -Milliseconds 300
    }
    if (-not $ready) {
        throw 'Der Tunnel steht, aber GameSwitch antwortet nicht auf dem entfernten Port 3001. Pruefe den GameSwitch-Dienst auf dem VPS.'
    }

    Write-Host "Panel: $panelUrl"
    Write-Host 'Dieses Terminal offen lassen. Strg+C beendet den SSH-Tunnel.'
    try {
        Start-Process -FilePath $panelUrl
    }
    catch {
        Write-Warning "Der Browser konnte nicht automatisch geoeffnet werden. Oeffne $panelUrl manuell."
    }
    while (-not $tunnel.HasExited) {
        Start-Sleep -Milliseconds 500
    }
    if ($tunnel.ExitCode -ne 0) {
        throw "Die SSH-Verbindung wurde unterbrochen (Status $($tunnel.ExitCode)). Starte das Skript erneut, um das Panel wieder zu verbinden."
    }
}
finally {
    if ($null -ne $tunnel) {
        if (-not $tunnel.HasExited) {
            $tunnel.Kill()
            $tunnel.WaitForExit()
        }
        $tunnel.Dispose()
    }
}
