import "server-only";

import { getPublicProfessionalContent, RESUME_PROFILE_COPY } from "@/lib/portfolio/resume-content";

/** This is transcribed from the owner-approved public resume, never workspace data. */
const PUBLIC_RESUME = {
  location: "Guagua, Pampanga, Philippines",
  phone: "+63 991 975 3445",
  email: "franzcayanan0407@gmail.com",
  portfolio: "https://frami-devplace.vercel.app",
  linkedin: "https://linkedin.com/in/franz-michael-cayanan-5975a5403",
  summary: "Magna Cum Laude Computer Science graduate and full-stack developer experienced in Next.js, TypeScript, Supabase, Flutter, and Laravel, with hands-on LLM integration using Gemini and Ollama, AI-assisted development, system architecture, and on-device computer vision.",
  projects: [
    {
      name: "Developer Workplace",
      role: "Sole Developer",
      summary: "Designed and built a full-stack developer workspace using Next.js, React, TypeScript, Supabase Auth, and PostgreSQL Row Level Security. The resume describes persistent Kanban boards, a drag-to-reschedule calendar, a read-only GitHub App integration, and separate private and public Gemini assistants.",
      technologies: ["Next.js", "React", "TypeScript", "Supabase", "PostgreSQL", "Google Gemini API", "GitHub App", "dnd-kit"],
    },
    {
      name: "AI-Powered Maintenance Simulator",
      role: "Project Lead & System Architect",
      summary: "Thesis project (2025–2026): led the project and designed its end-to-end architecture for a real-time car-part recognition app. Implemented on-device YOLOv11 inference in C# with Unity Sentis and built a Unity mobile interface with a Firebase Firestore synchronization and storage pipeline.",
      technologies: ["Unity", "C#", "YOLOv11", "Unity Sentis", "Firebase Firestore"],
    },
    {
      name: "LLM-Powered Chatbot Web Apps (AutoCare & Furniture)",
      role: "Developer",
      summary: "Built two web apps with LLM chatbots integrated through Ollama, using AI-assisted development workflows and deployed live on Vercel.",
      technologies: ["Ollama", "LLM integration", "Vercel", "GitHub Copilot", "Cursor", "Cline"],
    },
    {
      name: "Web-Based VR Classroom (WebXR)",
      role: "Full-Stack Developer",
      summary: "Architected a multi-user virtual classroom using A-Frame and Node.js, with user authentication and real-time synchronization; optimized assets for mobile responsiveness and accessibility.",
      technologies: ["A-Frame", "Node.js", "WebXR"],
    },
  ],
} as const;

function publicEmail(value: string | null | undefined): string {
  const email = value?.trim();
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : PUBLIC_RESUME.email;
}

function publicUrl(value: string | null | undefined, fallback: string): string {
  if (!value?.trim()) return fallback;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : fallback;
  } catch { return fallback; }
}

export interface PublicResumeContext {
  identity: { name: string; title: string; location: string };
  contact: { email: string; phone: string; portfolio: string; linkedin: string };
  summary: string;
  projects: typeof PUBLIC_RESUME.projects;
}

/**
 * Resume facts are included only for the matching public owner. Current public
 * profile fields take precedence when configured; PDF facts fill the gaps.
 */
export function buildPublicResumeContext(profile: {
  display_name?: string | null;
  headline?: string | null;
  bio?: string | null;
  public_contact_email?: string | null;
  linkedin_url?: string | null;
  website_url?: string | null;
}): PublicResumeContext | undefined {
  const professional = getPublicProfessionalContent({ displayName: profile.display_name ?? "" });
  if (!professional) return undefined;
  return {
    identity: {
      name: profile.display_name?.trim() || RESUME_PROFILE_COPY.displayName,
      title: profile.headline?.trim() || RESUME_PROFILE_COPY.headline,
      location: PUBLIC_RESUME.location,
    },
    contact: {
      email: publicEmail(profile.public_contact_email),
      phone: PUBLIC_RESUME.phone,
      portfolio: publicUrl(profile.website_url, PUBLIC_RESUME.portfolio),
      linkedin: publicUrl(profile.linkedin_url, PUBLIC_RESUME.linkedin),
    },
    summary: profile.bio?.trim() || PUBLIC_RESUME.summary,
    projects: PUBLIC_RESUME.projects,
  };
}
