/** Decorative strokes occupy their own space and never intercept controls. */
export function SketchDoodle({ kind = "underline", className = "" }: { kind?: "underline" | "arrow" | "spark"; className?: string }) {
  const paths = {
    underline: "M3 18 Q35 9 69 16 T135 14 T197 12 M9 23 Q68 18 125 21 T190 18",
    arrow: "M8 8 C90 2 40 62 116 48 Q155 41 181 17 M161 15 L184 14 L178 37",
    spark: "M99 3 L105 20 L123 25 L106 32 L100 50 L94 33 L76 27 L94 21 Z M147 12 L150 20 M143 16 L155 16 M46 34 L49 44 M42 39 L54 39",
  };
  return <svg aria-hidden="true" focusable="false" viewBox="0 0 200 56" className={`sketch-doodle ${className}`} fill="none"><path d={paths[kind]} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
