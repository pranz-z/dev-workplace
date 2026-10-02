import "server-only";

/**
 * Owner-approved professional copy transcribed from the October 2026 resume.
 * No contact details, local PDF paths, private entities, or frontend project records.
 * Existing public profile/project fields remain the CMS; this small editorial module
 * covers professional information for which the profile has no structured fields.
 */
export const RESUME_PROFILE_COPY = {
  displayName: "Franz Michael L. Cayanan",
  headline: "Full-Stack & AI Application Developer",
  bio: "Computer Science graduate building full-stack, mobile, and AI-powered applications with Next.js, Supabase, Flutter, Laravel, Gemini, and local LLMs.",
};

const professionalContent = {
  ...RESUME_PROFILE_COPY,
  heroContext: "BMWare internship · System architecture · Web, mobile & applied AI",
  heroStack: ["Next.js", "TypeScript", "Supabase", "Flutter", "Laravel", "Gemini / Ollama"],
  about: [
    "I build applications across web, mobile, and AI, connecting interfaces to APIs, databases, and authorization boundaries. My work includes Developer Workplace, a Supabase-backed productivity workspace with separate private and public Gemini assistants.",
    "At BMWare, I worked on Flutter applications and Laravel integrations, alongside database and system architecture for emergency response and insurance. As thesis project lead and system architect, I worked on on-device automobile-part recognition using YOLOv11 and Unity Sentis.",
  ],
  experience: {
    employer: "BMWare",
    role: "Technical Intern & System Architect",
    start: "2026-02",
    end: "2026-04",
    startLabel: "Feb 2026",
    endLabel: "Apr 2026",
    period: "Feb 2026 – Apr 2026",
    summary: "Built modular, cross-platform Flutter applications connected to Laravel/PHP backends through REST APIs.",
    systems: [
      { name: "Adsumus Dispatch", work: "Designed database schemas, ERDs, and microservice architecture for a real-time emergency-response platform, including fallback state synchronization, encrypted messaging, and geolocation tracking." },
      { name: "InsureMe", work: "Architected a digital insurance application with PayPal SDK integration behind a decoupled payment abstraction, separating payment state from application logic and avoiding local handling of payment data." },
    ],
  },
  education: {
    degree: "Bachelor of Science in Computer Science",
    institution: "Pampanga State University",
    honor: "Magna Cum Laude",
    graduated: "2026-09",
    graduationLabel: "Graduated September 2026",
    coursework: ["Software Engineering", "Database Management", "Artificial Intelligence", "Mobile Development"],
    leadership: "AI Lead, Technical Research and Development",
  },
  coreStack: ["Next.js", "React", "TypeScript", "Supabase", "PostgreSQL", "Flutter", "Laravel", "Gemini", "LLM Integration", "GitHub", "REST APIs"],
  skillGroups: [
    { label: "Languages", items: ["Dart", "TypeScript", "JavaScript", "C#", "PHP", "Java", "C++", "SQL", "HTML5 / CSS3"] },
    { label: "Frameworks & platforms", items: ["Next.js", "React", "Flutter", "Laravel", ".NET", "Node.js", "Unity", "A-Frame / WebXR"] },
    { label: "AI & automation", items: ["Google Gemini API", "Ollama", "OpenAI / Anthropic APIs", "LLM integration", "Prompt engineering", "n8n", "Agentic workflows", "GitHub Copilot", "Cursor", "Cline", "YOLOv11", "Unity Sentis"] },
    { label: "Databases & backend", items: ["PostgreSQL / RLS", "Supabase Auth & Storage", "MySQL", "MS SQL Server", "Firestore", "REST APIs", "GitHub App / OAuth"] },
    { label: "Tools & practices", items: ["Git", "Docker", "Vercel", "CI/CD", "JIRA", "Agile / Scrum", "ERDs / DFDs / context diagrams", "UI / UX", "3D simulation"] },
  ],
  focusAreas: [
    { title: "AI & intelligent applications", description: "Gemini API integration in Developer Workplace and local LLMs through Ollama in chatbot web apps. Developer Workplace separates public/private AI context with bounded inputs, validated file attachments, and persistent rate limiting. The maintenance thesis uses on-device YOLOv11 inference through Unity Sentis." },
    { title: "Full-stack & mobile engineering", description: "Next.js and React interfaces, Supabase/PostgreSQL with Auth, Storage, and Row Level Security, plus Flutter applications integrated with Laravel REST APIs. Supporting work includes LLM chatbot web apps and a multi-user WebXR classroom." },
    { title: "System design & architecture", description: "Database schemas, ERDs, DFDs, and service boundaries: from Adsumus Dispatch's synchronization architecture to InsureMe's decoupled payments and the maintenance simulator's Firestore data flow." },
  ],
};

export type PublicProfessionalContent = typeof professionalContent;

/** Null means public profile sharing is off/unavailable. Never invent an owner. */
export function getPublicProfessionalContent(profile: { displayName?: string | null } | null | undefined): PublicProfessionalContent | null {
  if (!profile) return null;
  const name = profile.displayName?.trim().replace(/\s+/g, " ").toLowerCase();
  return name === "franz michael cayanan" || name === "franz michael l. cayanan"
    ? professionalContent : null;
}

export function publicProfessionalIntroduction(profile: { displayName: string; headline?: string | null; bio?: string | null } | null | undefined) {
  const content = getPublicProfessionalContent(profile);
  return {
    name: profile?.displayName.trim() || "",
    headline: profile?.headline?.trim() || content?.headline || "",
    bio: profile?.bio?.trim() || content?.bio || "",
  };
}
