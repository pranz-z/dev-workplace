"use client";

import { Button, Card, UnderlineHeading } from "@/components/ui/notebook";
import { SketchDoodle } from "@/components/ui/SketchDoodle";


export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="public-shell flex min-h-screen items-center justify-center px-5 py-12">
      <Card className="notebook-error-card w-full max-w-lg p-6 text-center"><SketchDoodle kind="spark" className="mx-auto mb-4" />
        <h1 className="text-2xl font-bold text-[var(--ink)]"><UnderlineHeading>This page couldn’t load</UnderlineHeading></h1>
        <p className="mt-3 text-sm text-[var(--muted)]">Something went wrong. Try again in a moment.</p>
        <Button variant="primary" onClick={reset} className="mt-5">Try again</Button>
      </Card>
    </main>
  );
}
