$path = 'app/page.tsx'
$txt = Get-Content $path -Raw
$pairs = @(
  @('border-b border-white/10 pb-4', 'border-b border-[var(--edge-dark)] pb-4'),
  @('rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm t-dark', 'dark-chip px-3 py-2 text-sm'),
  @('rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5', 'dark-inset mood-peach p-5'),
  @('text-xs uppercase tracking-[0.2em] text-emerald-200', 'eyebrow t-mood'),
  @('mt-4 h-2.5 overflow-hidden rounded-full bg-slate-800', 'progress-track mt-4 h-2.5'),
  @('mt-4 h-2 overflow-hidden rounded-full bg-slate-800', 'progress-track mt-4 h-2'),
  @('border-emerald-500/30 bg-emerald-500/10', 'mood-peach'),
  @('border-white/10 bg-slate-950', 'dark-inset'),
  @('rounded-lg border border-white/10 p-1.5 t-dark-muted hover:text-rose-300', 'dark-chip p-1.5 hover:text-[var(--accent-coral)]'),
  @('rounded-lg border border-white/10 p-2 t-dark-muted hover:text-[var(--ink)]', 'dark-chip p-2 hover:text-[var(--ink)]'),
  @('rounded-full bg-emerald-500/15 px-2 py-1 text-[10px] text-emerald-200', 'dark-chip px-2 py-1'),
  @('rounded-full bg-slate-800 px-2 py-1 text-[10px] uppercase t-dark-soft', 'dark-chip px-2 py-1'),
  @('rounded-full bg-slate-700/80 px-2 py-1 text-[10px] t-dark-soft', 'dark-chip px-2 py-1'),
  @('"text-slate-500"', '"text-[var(--text-light-soft)]"'),
  @('rounded-xl border border-dashed border-white/10 bg-slate-950 p-6', 'dark-inset border-dashed p-6'),
  @('bg-slate-950/80', 'bg-[var(--scrim)]'),
  @('bg-slate-900 p-4 shadow-2xl shadow-slate-950/50', 'dark-panel p-4 shadow-2xl'),
  @('bg-slate-900 p-5 shadow-2xl shadow-slate-950/60', 'dark-panel p-5 shadow-2xl'),
  @('rounded-xl border border-white/10', 'dark-chip')
)
foreach ($p in $pairs) {
  $cnt = [regex]::Matches($txt, [regex]::Escape($p[0])).Count
  $txt = $txt.Replace($p[0], $p[1])
  Write-Output ($cnt.ToString().PadLeft(3) + '  ' + $p[0] + '   ->   ' + $p[1])
}
Set-Content -Path $path -Value $txt -NoNewline -Encoding utf8
Write-Output 'written'
