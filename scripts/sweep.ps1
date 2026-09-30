$path = 'app/page.tsx'
$txt = Get-Content $path -Raw
$pairs = @(
  @('hover:text-white', 'hover:text-[var(--ink)]'),
  @('rounded-full px-2 py-1 text-[10px] ${statusColors', 'badge ${statusColors'),
  @('rounded-full px-2 py-1 text-[10px] ${priorityColors', '${priorityColors'),
  @('bg-emerald-500 px-3 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400', 'ink-button primary px-3 py-2 text-sm'),
  @('border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-200 hover:bg-emerald-500/20', 'ink-button px-3 py-2 text-sm'),
  @('rounded-3xl border border-white/10 bg-slate-950/70 p-4', 'dark-panel p-4'),
  @('rounded-2xl border border-white/10 bg-slate-950/70 p-5', 'dark-panel p-5'),
  @('rounded-2xl border border-white/10 bg-slate-950/70 p-4', 'dark-panel p-4'),
  @('rounded-2xl border border-white/10 bg-slate-950/70 p-3', 'dark-panel p-3'),
  @('rounded-2xl border border-white/10 bg-slate-950/70', 'dark-panel'),
  @('rounded-2xl border border-white/10 bg-slate-900 p-5', 'dark-panel p-5'),
  @('rounded-2xl border border-white/10 bg-slate-900 p-4', 'dark-panel p-4'),
  @('rounded-2xl border border-white/10 bg-slate-900 p-3', 'dark-panel p-3'),
  @('rounded-xl border border-white/10 bg-slate-900 p-3', 'dark-inset p-3'),
  @('rounded-xl border border-white/10 bg-slate-950 p-3', 'dark-inset p-3'),
  @('rounded-xl border border-white/10 bg-slate-950 p-4', 'dark-inset p-4'),
  @('rounded-xl border border-white/10 bg-slate-900 p-4', 'dark-inset p-4'),
  @('rounded-xl border border-white/10 bg-slate-900 p-2', 'dark-inset p-2'),
  @('rounded-lg border border-white/10 bg-slate-950 px-2 py-1 text-xs text-slate-200', 'dark-chip px-2 py-1 text-xs'),
  @('rounded-lg border border-white/10 bg-slate-900 px-2 py-1 text-xs text-slate-200', 'dark-chip px-2 py-1 text-xs'),
  @('rounded-full bg-slate-800 px-2 py-1 text-[10px] text-slate-300', 'dark-chip px-2 py-1'),
  @('rounded-full bg-slate-800 px-2 py-1 text-[10px] text-slate-200', 'dark-chip px-2 py-1'),
  @('rounded-full bg-slate-700/80 px-2 py-1 text-xs text-slate-200', 'dark-chip px-2 py-1 text-xs'),
  @('rounded-full bg-slate-700/70 px-2 py-1 text-[10px] text-slate-200', 'dark-chip px-2 py-1'),
  @('rounded-full border border-white/10 bg-slate-900 px-2 py-1 text-[10px] text-slate-300', 'dark-chip px-2 py-1'),
  @('rounded-full px-3 py-1.5 text-xs font-medium', 'soft-pill px-3 py-1.5 text-xs'),
  @('bg-emerald-500 text-slate-950', 'is-selected'),
  @('bg-slate-900 text-slate-300', 't-dark-muted'),
  @('text-xs uppercase tracking-[0.2em] text-emerald-300/80', 'eyebrow t-mood'),
  @('text-xs uppercase tracking-[0.18em] text-emerald-300/80', 'eyebrow t-mood'),
  @('text-xs uppercase tracking-[0.2em] text-slate-400', 'eyebrow t-dark-soft'),
  @('text-xs uppercase tracking-[0.18em] text-slate-400', 'eyebrow t-dark-soft'),
  @('text-xs uppercase tracking-[0.2em] text-slate-500', 'eyebrow t-dark-soft'),
  @('placeholder:text-slate-500', 'placeholder:text-[var(--text-light-soft)]'),
  @('text-emerald-300', 'text-[var(--ink-green)]'),
  @('text-white', 't-dark'),
  @('text-slate-100', 't-dark'),
  @('text-slate-200', 't-dark-soft'),
  @('text-slate-300', 't-dark-muted'),
  @('text-slate-400', 't-dark-muted')
)
foreach ($p in $pairs) {
  $cnt = [regex]::Matches($txt, [regex]::Escape($p[0])).Count
  $txt = $txt.Replace($p[0], $p[1])
  Write-Output ($cnt.ToString().PadLeft(3) + '  ' + $p[0] + '  ->  ' + $p[1])
}
Set-Content -Path $path -Value $txt -NoNewline -Encoding utf8
Write-Output 'written'
