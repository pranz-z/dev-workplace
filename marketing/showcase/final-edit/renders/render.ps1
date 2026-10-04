$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$ffmpeg = [IO.Path]::GetFullPath((Join-Path $projectRoot '..\.tools\ffmpeg\bin\ffmpeg.exe'))
$ffprobe = [IO.Path]::GetFullPath((Join-Path $projectRoot '..\.tools\ffmpeg\bin\ffprobe.exe'))
$master = Join-Path $PSScriptRoot 'developer-workplace-reference-style-handdrawn.mp4'
$temporary = Join-Path $PSScriptRoot 'developer-workplace-reference-style-handdrawn-limited-range.tmp.mp4'

Push-Location $projectRoot
try {
  npm run render:composition
  if ($LASTEXITCODE -ne 0) {
    throw "Remotion render failed with exit code $LASTEXITCODE"
  }

  & $ffmpeg -hide_banner -loglevel error -y -i $master -map 0:v:0 `
    -vf 'scale=in_range=full:out_range=limited' -c:v libx264 -preset medium -crf 18 `
    -r 30 -pix_fmt yuv420p -color_range tv -an -movflags +faststart $temporary
  if ($LASTEXITCODE -ne 0) {
    throw "H.264 yuv420p encoding failed with exit code $LASTEXITCODE"
  }

  $probeOutput = & $ffprobe -v error `
    -show_entries 'stream=codec_type,codec_name,width,height,r_frame_rate,pix_fmt,color_range,nb_frames' `
    -show_entries 'format=duration' -of json $temporary
  if ($LASTEXITCODE -ne 0) {
    throw "ffprobe failed with exit code $LASTEXITCODE"
  }
  $probe = $probeOutput | ConvertFrom-Json
  $videoStreams = @($probe.streams | Where-Object codec_type -eq 'video')
  $audioStreams = @($probe.streams | Where-Object codec_type -eq 'audio')
  $duration = [double]::Parse([string]$probe.format.duration, [Globalization.CultureInfo]::InvariantCulture)

  if ($videoStreams.Count -ne 1 -or $videoStreams[0].codec_name -ne 'h264' -or
      $videoStreams[0].width -ne 1920 -or $videoStreams[0].height -ne 1080 -or
      $videoStreams[0].r_frame_rate -ne '30/1' -or $videoStreams[0].pix_fmt -ne 'yuv420p' -or
      $duration -lt 28 -or $duration -gt 32 -or $audioStreams.Count -ne 0) {
    throw 'Encoded master did not meet the H.264, 1920x1080, 30 fps, yuv420p, silent, 28–32 second profile.'
  }

  & $ffmpeg -hide_banner -loglevel error -i $temporary -f null NUL
  if ($LASTEXITCODE -ne 0) {
    throw "Full video decode failed with exit code $LASTEXITCODE"
  }

  Move-Item -LiteralPath $temporary -Destination $master -Force
  Write-Output $master
}
finally {
  Pop-Location
}
