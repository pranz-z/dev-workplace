# Idempotent class-token sweep: always starts from the clean pre-flight copy and
# writes app/page.tsx as UTF-8 WITHOUT a BOM so non-ASCII glyphs stay intact.
$src = Join-Path $env:TEMP 'page.preflight.tsx'
$dst = 'app/page.tsx'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$txt = [System.IO.File]::ReadAllText($src, $utf8)

$pairs = @(
  # --- surfaces -------------------------------------------------------------
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
  @('border-b border-white/10 pb-4', 'border-b border-[var(--edge-dark)] pb-4'),
  @('rounded-xl border border-dashed border-white/10 bg-slate-950 p-6', 'dark-inset border-dashed p-6'),
  @('border-white/10 bg-slate-950', 'dark-inset'),
  @('bg-slate-950/80', 'bg-[var(--scrim)]'),
  # --- chips ----------------------------------------------------------------
  @('rounded-lg border border-white/10 bg-slate-950 px-2 py-1 text-xs text-slate-200', 'dark-chip px-2 py-1 text-xs'),
  @('rounded-lg border border-white/10 bg-slate-900 px-2 py-1 text-xs text-slate-200', 'dark-chip px-2 py-1 text-xs'),
  @('rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm t-dark', 'dark-chip px-3 py-2 text-sm'),
  @('rounded-full bg-slate-800 px-2 py-1 text-[10px] text-slate-300', 'dark-chip px-2 py-1'),
  @('rounded-full bg-slate-800 px-2 py-1 text-[10px] text-slate-200', 'dark-chip px-2 py-1'),
  @('rounded-full bg-slate-700/80 px-2 py-1 text-xs text-slate-200', 'dark-chip px-2 py-1 text-xs'),
  @('rounded-full bg-slate-700/70 px-2 py-1 text-[10px] text-slate-200', 'dark-chip px-2 py-1'),
  @('rounded-full border border-white/10 bg-slate-900 px-2 py-1 text-[10px] text-slate-300', 'dark-chip px-2 py-1'),
  @('rounded-full bg-slate-800 px-2 py-1 text-[10px] uppercase t-dark-soft', 'dark-chip px-2 py-1'),
  @('rounded-full bg-slate-700/80 px-2 py-1 text-[10px] t-dark-soft', 'dark-chip px-2 py-1'),
  @('rounded-full bg-emerald-500/15 px-2 py-1 text-[10px] text-emerald-200', 'dark-chip px-2 py-1'),
  @('rounded-full bg-violet-500/15 px-2 py-1 text-[10px] text-violet-200', 'dark-chip px-2 py-1'),
  @('rounded-lg border border-white/10 p-1.5 t-dark-muted hover:text-rose-300', 'dark-chip p-1.5 hover:text-[var(--accent-coral)]'),
  @('rounded-lg border border-white/10 p-1.5 text-slate-400 hover:text-rose-300', 'dark-chip p-1.5 hover:text-[var(--accent-coral)]'),
  @('rounded-lg border border-white/10 p-1 text-slate-400 hover:text-rose-300', 'dark-chip p-1 hover:text-[var(--accent-coral)]'),
  @('rounded-lg border border-white/10 p-2 t-dark-muted hover:text-[var(--ink)]', 'dark-chip p-2 hover:text-[var(--ink)]'),
  @('rounded-lg border border-white/10 p-2 text-slate-400 hover:text-white', 'dark-chip p-2 hover:text-[var(--ink)]'),
  @('rounded-xl border border-white/10', 'dark-chip'),
  # --- badges, pills, tabs ---------------------------------------------------
  @('rounded-full px-2 py-1 text-[10px] ${statusColors', 'badge ${statusColors'),
  @('rounded-full px-2 py-1 text-[10px] ${priorityColors', '${priorityColors'),
  @('rounded-full px-3 py-1.5 text-xs font-medium', 'soft-pill px-3 py-1.5 text-xs'),
  @('bg-emerald-500 text-slate-950', 'is-selected'),
  @('bg-slate-900 text-slate-300', 't-dark-muted'),
  # --- buttons ---------------------------------------------------------------
  @('bg-emerald-500 px-3 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400', 'ink-button primary px-3 py-2 text-sm'),
  @('border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-200 hover:bg-emerald-500/20', 'ink-button px-3 py-2 text-sm'),
  @('rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5', 'dark-inset mood-peach p-5'),
  @('border-emerald-500/30 bg-emerald-500/10', 'mood-peach'),
  @('hover:border-emerald-500/30', 'hover:border-[var(--accent-peach)]'),
  # --- progress --------------------------------------------------------------
  @('mt-4 h-2.5 overflow-hidden rounded-full bg-slate-800', 'progress-track mt-4 h-2.5'),
  @('mt-4 h-2 overflow-hidden rounded-full bg-slate-800', 'progress-track mt-4 h-2'),
  @('h-full rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400', 'progress-fill'),
  # --- type ------------------------------------------------------------------
  @('text-xs uppercase tracking-[0.2em] text-emerald-300/80', 'eyebrow t-mood'),
  @('text-xs uppercase tracking-[0.18em] text-emerald-300/80', 'eyebrow t-mood'),
  @('text-xs uppercase tracking-[0.2em] text-emerald-200', 'eyebrow t-mood'),
  @('text-xs uppercase tracking-[0.2em] text-slate-400', 'eyebrow t-dark-soft'),
  @('text-xs uppercase tracking-[0.18em] text-slate-400', 'eyebrow t-dark-soft'),
  @('placeholder:text-slate-500', 'placeholder:text-[var(--text-light-soft)]'),
  @('text-emerald-300', 'text-[var(--ink-green)]'),
  @('hover:text-white', 'hover:text-[var(--ink)]'),
  @('text-white', 't-dark'),
  @('text-slate-100', 't-dark'),
  @('text-slate-200', 't-dark-soft'),
  @('text-slate-300', 't-dark-muted'),
  @('text-slate-400', 't-dark-muted'),
  @('"text-slate-500"', '"text-[var(--text-light-soft)]"'),
  # --- decorative inline styles ---------------------------------------------
  @('className="hero-paper p-5" style={{ transform: "rotate(-0.3deg)" }}', 'className="hero-paper tilt-left p-5"'),
  @('shadow-2xl shadow-slate-950/50', 'shadow-[var(--shadow-dark-lift)]'),
  @('shadow-2xl shadow-slate-950/60', 'shadow-[var(--shadow-dark-lift)]')
)

$total = 0
foreach ($p in $pairs) {
  $cnt = [regex]::Matches($txt, [regex]::Escape($p[0])).Count
  $total += $cnt
  $txt = $txt.Replace($p[0], $p[1])
  if ($cnt -gt 0) { Write-Output ($cnt.ToString().PadLeft(3) + '  ' + $p[0]) }
}
[System.IO.File]::WriteAllText((Join-Path (Get-Location) $dst), $txt, $utf8)
Write-Output ('total replacements: ' + $total)
