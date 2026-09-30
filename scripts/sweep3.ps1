$path = 'app/page.tsx'
$txt = Get-Content $path -Raw
$pairs = @(
  @('rounded-full bg-violet-500/15 px-2 py-1 text-[10px] text-violet-200', 'dark-chip px-2 py-1'),
  @('dark-panel p-4 shadow-2xl shadow-slate-950/50', 'dark-panel p-4 shadow-[var(--shadow-dark-lift)]'),
  @('dark-panel p-5 shadow-2xl shadow-slate-950/60', 'dark-panel p-5 shadow-[var(--shadow-dark-lift)]'),
  @('hover:border-emerald-500/30', 'hover:border-[var(--accent-peach)]')
)
foreach ($p in $pairs) {
  $cnt = [regex]::Matches($txt, [regex]::Escape($p[0])).Count
  $txt = $txt.Replace($p[0], $p[1])
  Write-Output ($cnt.ToString().PadLeft(3) + '  ' + $p[0] + '   ->   ' + $p[1])
}
Set-Content -Path $path -Value $txt -NoNewline -Encoding utf8
Write-Output 'written'
