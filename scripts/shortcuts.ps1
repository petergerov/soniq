# Verknuepfungen "SONIQ Start" und "SONIQ Stop" im Programmordner und auf dem Desktop anlegen.
# Entfernt dabei die alten Verknuepfungen "Music Generator ON/OFF" (vor der Umbenennung der Skripte),
# die nach einem Update ins Leere zeigen. Aufruf vom Installer und von der App beim Start.
. (Join-Path $PSScriptRoot "common.ps1")

$shell = New-Object -ComObject WScript.Shell
foreach ($dir in @($ROOT, [Environment]::GetFolderPath("Desktop"))) {
    foreach ($alt in @("Music Generator ON.lnk", "Music Generator OFF.lnk")) {
        Remove-Item (Join-Path $dir $alt) -Force -ErrorAction SilentlyContinue
    }
    foreach ($e in @(@("SONIQ Start", "start.ps1", "icon-on.ico"), @("SONIQ Stop", "stop.ps1", "icon-off.ico"))) {
        $lnk = $shell.CreateShortcut((Join-Path $dir "$($e[0]).lnk"))
        $lnk.TargetPath = "powershell.exe"
        $lnk.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $ROOT $e[1])`""
        $lnk.WorkingDirectory = $ROOT
        $lnk.IconLocation = (Join-Path $ROOT "assets\$($e[2])")
        $lnk.Save()
    }
}
