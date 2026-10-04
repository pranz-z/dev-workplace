import { emptyPortfolio, type PortfolioContent } from "./content";

/** One-time owner-reviewed import from Franz_Resume.pdf. Never a public fallback. */
export function resumePortfolioSeed(): PortfolioContent {
  const doc = emptyPortfolio();
  const base = (sort_order: number) => ({ id: crypto.randomUUID(), enabled: true, sort_order });
  doc.hero = {
    name: "Franz Michael L. Cayanan", headline: "Full-Stack & AI Application Developer",
    description: "Next.js · Supabase · Flutter · Laravel · LLM Integration",
    tagline: "BMWare internship · System architecture · Web, mobile & applied AI", avatar: "",
  };
  doc.bio = "Magna Cum Laude Computer Science graduate and full-stack developer experienced in Next.js, TypeScript, Supabase, Flutter, and Laravel, with hands-on LLM integration (Gemini, Ollama) and AI-assisted development using OpenAI Codex, GitHub Copilot in VS Code, and Google Antigravity, with OmniRoute for routing across multiple AI providers. Built Developer Workplace, a Supabase-backed developer workspace with separate private and public Gemini assistants. Interned at BMWare as a system architect, designing a real-time emergency-response platform and a PayPal-integrated insurance app. Led a thesis project running YOLOv11 on-device with Unity Sentis.";
  doc.about = {
    title: "Connecting software, systems & AI",
    body: "I built Developer Workplace, a full-stack developer workspace in Next.js, React, and TypeScript, using Supabase Auth and PostgreSQL Row Level Security. It includes persistent Kanban boards, a drag-to-reschedule calendar, a read-only GitHub App integration, and separate private and public Gemini assistants.",
    secondary: "At BMWare, I built Flutter applications with Laravel backends and designed database schemas and system architecture for emergency response and insurance applications. As thesis project lead and system architect, I implemented on-device YOLOv11 inference through Unity Sentis.",
  };
  doc.stack = ["Next.js", "TypeScript", "Supabase", "Flutter", "Laravel", "Gemini", "Ollama"].map((name, index) => ({ ...base(index), name }));
  doc.experience = [{
    ...base(0), company: "BMWare", role: "Technical Intern & System Architect", employmentType: "Internship",
    start: "2026-02", end: "2026-04", current: false, location: "", summary: "", technologies: ["Flutter", "Laravel", "PHP", "REST APIs", "PayPal SDK"],
    bullets: [
      "Built modular, cross-platform mobile apps in Flutter across multiple production projects, integrating with a Laravel (PHP) backend through RESTful APIs.",
      "Designed the database schema (ERDs) and microservices for Adsumus Dispatch, a real-time emergency response platform with fallback state synchronization, encrypted messaging, and geolocation tracking.",
      "Architected InsureMe, a production digital insurance app, integrating the PayPal SDK behind a decoupled abstraction layer to isolate payment state from app logic and avoid handling payment data locally.",
    ],
  }];
  doc.education = [{ ...base(0), institution: "Pampanga State University", degree: "Bachelor of Science in Computer Science", field: "Computer Science", honors: "Magna Cum Laude", start: "", graduation: "2026-09", location: "", coursework: ["Software Engineering", "Database Management", "Artificial Intelligence", "Mobile Development"], activities: ["AI Lead", "Technical Research and Development"], notes: "" }];
  doc.toolkit = [
    ["Languages", ["Dart", "TypeScript", "JavaScript", "C#", "PHP", "Java", "C++", "SQL", "HTML5/CSS3"]],
    ["Frameworks & Platforms", ["Next.js", "React", "Flutter", "Laravel", ".NET", "Node.js", "Unity", "A-Frame (WebXR)"]],
    ["AI & Automation", ["Google Gemini API", "Ollama (local LLMs)", "OpenAI/Anthropic APIs", "LLM integration", "Prompt engineering", "n8n", "Agentic workflows", "YOLOv11", "Unity Sentis"]],
    ["AI-Assisted Dev Tools", ["OpenAI Codex", "GitHub Copilot (VS Code)", "Google Antigravity", "OmniRoute (gateway to other AI providers)"]],
    ["Databases & Backend", ["PostgreSQL (Row Level Security)", "Supabase (Auth, Storage)", "MySQL", "MS SQL Server", "Firestore", "RESTful APIs", "GitHub App/OAuth"]],
    ["Tools & Practices", ["Git", "Docker", "Vercel", "CI/CD", "JIRA", "Agile/Scrum", "System design (ERD, DFD)", "UI/UX design", "3D simulation"]],
  ].map(([label, items], index) => ({ ...base(index), label: label as string, items: (items as string[]).map((name, index) => ({ ...base(index), name })) }));
  doc.focus = [
    ["Full-Stack Application Development", "Next.js, React, TypeScript, and Supabase in Developer Workplace."],
    ["AI / LLM Integration", "Gemini assistants and Ollama-powered chatbot web applications."],
    ["Mobile Application Development", "Cross-platform Flutter applications integrated with Laravel REST APIs."],
    ["System Architecture", "Architecture for Adsumus Dispatch, InsureMe, and the maintenance simulator thesis."],
    ["Backend / Database Design", "Database schemas, ERDs, microservices, and PostgreSQL Row Level Security."],
    ["Applied Computer Vision", "On-device YOLOv11 inference in C# through Unity Sentis."],
  ].map(([title, description], index) => ({ ...base(index), title, description, icon: "" }));
  doc.contact = { email: "franzcayanan0407@gmail.com", showEmail: true, phone: "+63 991 975 3445", showPhone: true, location: "Guagua, Pampanga, Philippines", showLocation: true, cta: "Let's connect", note: "" };
  doc.links = [
    { ...base(0), type: "portfolio", label: "Portfolio", url: "https://frami-devplace.vercel.app" },
    { ...base(1), type: "linkedin", label: "LinkedIn", url: "https://linkedin.com/in/franz-michael-cayanan-5975a5403" },
  ];
  return doc;
}
