import Image from "next/image";

interface LogoProps {
  variant: "icon" | "full";
  size: number;
}

export function Logo({ variant, size }: LogoProps) {
  if (variant === "icon") {
    return <Image src="/brand/frami-icon.svg" alt="Frami" width={size} height={size} priority />;
  }

  return (
    <span
      role="img"
      aria-label="Frami"
      className="inline-flex shrink-0 items-center rounded-xl bg-[var(--nb-bg)] text-[var(--nb-ink)]"
      style={{ gap: size * 0.16, padding: `${size * 0.12}px ${size * 0.24}px` }}
    >
      <Image src="/brand/frami-icon.svg" alt="" width={size} height={size} priority />
      <span className="flex flex-col leading-none">
        <span className="font-[family-name:var(--font-caveat)]" style={{ fontSize: size * 1.14 }}>Frami</span>
        <span className="mt-0.5 whitespace-nowrap font-sans font-semibold" style={{ fontSize: size * 0.27 }}>Developer Workplace</span>
      </span>
    </span>
  );
}
