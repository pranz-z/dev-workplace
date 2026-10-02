import {
  buildPublicDeveloperContext,
  getPublicAiDailyLimit,
  getPublicAiRateLimitSalt,
  hashPublicVisitor,
  isProfessionalPortfolioQuestion,
  parsePublicAiRequest,
  PublicAiError,
  PUBLIC_AI_SCOPE_REDIRECT,
  validatePublicAiAnswer,
  type PublicAiAnswer,
  type PublicAiRequest,
} from "@/lib/public-ai/service";
import type { PublicAiProfileRow, PublicProjectCardRow } from "@/data/database.types";
import { getGeminiConfiguration } from "@/lib/ai/config";

export interface PublicAiDependencies {
  configured(): boolean;
  rateLimitSalt(): string;
  dailyLimit(): number;
  readProfile(): Promise<PublicAiProfileRow | null>;
  readProjects(): Promise<PublicProjectCardRow[]>;
  acquireLease(visitorHash: string): Promise<boolean>;
  releaseLease(visitorHash: string): Promise<void>;
  consumeRateLimit(visitorHash: string, dailyLimit: number): Promise<boolean>;
  generate(question: string, context: ReturnType<typeof buildPublicDeveloperContext>): Promise<PublicAiAnswer>;
  ipFromRequest(request: Request): string | null;
  hmac: Parameters<typeof hashPublicVisitor>[2];
}

type JsonPayload = Record<string, unknown>;

function json(status: number, payload: JsonPayload): Response {
  return Response.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

async function readBoundedRequestText(request: Request, maxBytes: number): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new PublicAiError("INVALID_INPUT");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function publicError(error: unknown): Response {
  if (error instanceof PublicAiError && error.code === "INVALID_INPUT") return json(400, { error: { message: "Enter a short question about the developer or public portfolio." } });
  if (error instanceof PublicAiError && error.code === "RATE_LIMITED") return json(429, { error: { message: "The portfolio assistant has reached its current usage limit. Please try again later." } });
  if (error instanceof PublicAiError && error.code === "MALFORMED_OUTPUT") return json(502, { error: { message: "The portfolio assistant could not safely answer that. Please try again." } });
  return json(503, { error: { message: "The portfolio assistant is temporarily unavailable." } });
}

export function createPublicAiHandlers(dependencies: PublicAiDependencies) {
  const inFlight = new Set<string>();

  return {
    async get(): Promise<Response> {
      try {
        if (!dependencies.configured()) return json(200, { available: false });
        return json(200, { available: Boolean(await dependencies.readProfile()) });
      } catch {
        return json(200, { available: false });
      }
    },

    async post(request: Request): Promise<Response> {
      let body: PublicAiRequest;
      try {
        const contentLength = Number(request.headers.get("content-length") ?? 0);
        if (contentLength > 4_000) throw new PublicAiError("INVALID_INPUT");
        const text = await readBoundedRequestText(request, 4_000);
        body = parsePublicAiRequest(JSON.parse(text) as unknown);
      } catch (error) {
        return publicError(error instanceof PublicAiError ? error : new PublicAiError("INVALID_INPUT"));
      }

      let visitorHash = "";
      let lockAcquired = false;
      let leaseAcquired = false;
      try {
        if (!dependencies.configured()) throw new PublicAiError("UNAVAILABLE");
        const dailyLimit = dependencies.dailyLimit();
        const salt = dependencies.rateLimitSalt();
        const profile = await dependencies.readProfile();
        if (!profile) return json(404, { error: { message: "The portfolio assistant is not available." } });

        visitorHash = hashPublicVisitor(dependencies.ipFromRequest(request), salt, dependencies.hmac);
        if (inFlight.has(visitorHash)) throw new PublicAiError("RATE_LIMITED");
        inFlight.add(visitorHash);
        lockAcquired = true;

        if (!await dependencies.acquireLease(visitorHash)) throw new PublicAiError("RATE_LIMITED");
        leaseAcquired = true;
        if (!await dependencies.consumeRateLimit(visitorHash, dailyLimit)) throw new PublicAiError("RATE_LIMITED");
        const projects = await dependencies.readProjects();
        const context = buildPublicDeveloperContext(profile, projects);
        if (!isProfessionalPortfolioQuestion(body.question)) {
          return json(200, { answer: PUBLIC_AI_SCOPE_REDIRECT, relatedProjects: [] });
        }
        const answer = validatePublicAiAnswer(await dependencies.generate(body.question, context), context);
        const projectBySlug = new Map(context.publicProjects.map((project) => [project.slug, project]));
        const relatedProjects = answer.relatedProjectSlugs.flatMap((slug) => {
          const project = projectBySlug.get(slug);
          return project ? [{ slug: project.slug, title: project.title }] : [];
        });
        return json(200, { answer: answer.answer, relatedProjects });
      } catch (error) {
        return publicError(error);
      } finally {
        if (lockAcquired) inFlight.delete(visitorHash);
        if (leaseAcquired) {
          try { await dependencies.releaseLease(visitorHash); } catch { /* The five-minute lease expires if release is unavailable. */ }
        }
      }
    },
  };
}

export function publicAiEnvironmentDependencies() {
  return {
    configured: () => {
      try {
        return getGeminiConfiguration().configured
          && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim())
          && Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim())
          && Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim())
          && Boolean(getPublicAiRateLimitSalt())
          && getPublicAiDailyLimit() > 0;
      } catch {
        return false;
      }
    },
    rateLimitSalt: () => getPublicAiRateLimitSalt(),
    dailyLimit: () => getPublicAiDailyLimit(),
  };
}
