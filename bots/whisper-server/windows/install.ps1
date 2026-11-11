icacls C:\wyx-whisper\certs\key.pem /inheritance:r /grant "Administrators:F" /grant "SYSTEM:F" | Out-Null
Get-NetFirewallRule -DisplayName 'wyx-whisper 8745' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName 'wyx-whisper 8745' -Direction Inbound -Protocol TCP -LocalPort 8745 -RemoteAddress 194.164.245.144 -Action Allow | Out-Null
$a = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument '/c C:\wyx-whisper\run.cmd'
$tr = New-ScheduledTaskTrigger -AtStartup
$st = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'wyx-whisper' -Action $a -Trigger $tr -Settings $st -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
Start-ScheduledTask -TaskName 'wyx-whisper'
"task: " + (Get-ScheduledTask -TaskName 'wyx-whisper').State
"firewall: " + ((Get-NetFirewallRule -DisplayName 'wyx-whisper 8745' | Get-NetFirewallAddressFilter).RemoteAddress -join ',')
