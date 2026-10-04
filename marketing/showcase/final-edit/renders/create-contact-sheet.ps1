$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$ffmpeg = [IO.Path]::GetFullPath((Join-Path $projectRoot '..\.tools\ffmpeg\bin\ffmpeg.exe'))
$master = Join-Path $PSScriptRoot 'developer-workplace-reference-style-handdrawn.mp4'
$frameDirectory = Join-Path $PSScriptRoot 'contact-sheet-frames'
$contactSheet = Join-Path $PSScriptRoot 'final-contact-sheet.jpg'

if (-not (Test-Path -LiteralPath $master)) {
  throw "Rendered master not found: $master"
}

New-Item -ItemType Directory -Force -Path $frameDirectory | Out-Null
$sampleFrames = @(0, 90, 180, 270, 360, 450, 540, 630, 720, 810, 897)
for ($index = 0; $index -lt $sampleFrames.Count; $index++) {
  $frame = $sampleFrames[$index]
  $label = '{0:D3}' -f $index
  $destination = Join-Path $frameDirectory "$label.jpg"
  $seconds = ($frame / 30).ToString('0.000', [Globalization.CultureInfo]::InvariantCulture)
  & $ffmpeg -hide_banner -loglevel error -y -ss $seconds -i $master -frames:v 1 -q:v 3 -update 1 $destination
  if ($LASTEXITCODE -ne 0) {
    throw "Could not extract contact-sheet frame $frame"
  }
}

$sequence = Join-Path $frameDirectory '%03d.jpg'
& $ffmpeg -hide_banner -loglevel error -y -framerate 1 -start_number 0 -i $sequence `
  -vf 'scale=480:270,tile=4x3:padding=16:margin=16:color=#f4ede3' `
  -frames:v 1 -q:v 2 -update 1 $contactSheet
if ($LASTEXITCODE -ne 0) {
  throw 'Could not assemble final-contact-sheet.jpg'
}

Write-Output $contactSheet
