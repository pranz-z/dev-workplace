import { Card, UnderlineHeading } from "@/components/ui/notebook";
import { SketchDoodle } from "@/components/ui/SketchDoodle";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="public-shell flex min-h-screen items-center justify-center px-5 py-12">
      <Card className="notebook-error-card w-full max-w-lg p-6 text-center"><SketchDoodle kind="spark" className="mx-auto mb-4" />
        <h1 className="text-2xl font-bold text-[var(--ink)]"><UnderlineHeading>Page not found</UnderlineHeading></h1>
        <p className="mt-3 text-sm text-[var(--muted)]">That page may have moved or is not publicly available.</p>
        <Link href="/" className="notebook-button notebook-button-primary mt-5">Back to portfolio</Link>
      </Card>
    </main>
  );
}
