import { emptyPortfolio, type PortfolioContent } from "./content";

/** One-time owner-reviewed import from Franz_Michael_Cayanan_Resume4.pdf. Never a public fallback. */
export function resumePortfolioSeed(): PortfolioContent {
  const doc = emptyPortfolio();
  const base = (sort_order: number) => ({ id: crypto.randomUUID(), enabled: true, sort_order });
  doc.hero = {
    name: "Franz Michael L. Cayanan", headline: "Full-Stack & AI Application Developer",
    description: "Next.js · PostgreSQL · Supabase · Flutter · Laravel · LLM, RAG & MCP Integration",
    tagline: "Freelance full-stack developer · Former BMWare system architect intern · Applied AI", avatar: "",
  };
  doc.bio = "Magna Cum Laude Computer Science graduate and full-stack developer (Next.js, TypeScript, PostgreSQL, Supabase, Flutter, Laravel). Leading MedStock, a freelance multi-company inventory and invoicing system with an append-only stock ledger and Row Level Security. Experienced in LLM and MCP integration and AI-assisted development with Claude Code, a DeepSeek-based coding harness, Copilot, Cursor, and Cline, working in a spec-driven, plan-execute-verify loop. Built a multilingual RAG system that lifted Recall@4 from 79% to 91.5%, and interned at BMWare as a system architect.";
  doc.about = {
    title: "Connecting software, systems & AI",
    body: "I build full-stack products end to end. Developer Workplace is a Next.js, React, and TypeScript workspace on Supabase Auth and PostgreSQL Row Level Security, with Kanban boards, a calendar, a read-only GitHub App integration, and separate private and public Gemini assistants.",
    secondary: "I am leading MedStock, a freelance multi-company inventory and invoicing system built on an append-only stock ledger, and I built a multilingual RAG system that raised Recall@4 from 79.3% to 91.5%. At BMWare I worked as a technical intern and system architect on Flutter and Laravel projects.",
  };
  doc.stack = ["Next.js", "TypeScript", "PostgreSQL", "Supabase", "Drizzle ORM", "Flutter", "Laravel", "Qdrant", "MCP"].map((name, index) => ({ ...base(index), name }));
  doc.experience = [{
    ...base(0), company: "MedStock (client project)", role: "Freelance Full-Stack Developer", employmentType: "Freelance",
    start: "2026-10", end: "", current: true, location: "", summary: "", technologies: ["Next.js", "TypeScript", "PostgreSQL 16 (RLS)", "Drizzle ORM", "Better Auth", "Vitest", "GitHub Actions", "Tailscale"],
    bullets: [
      "Building an inventory, sales, and invoicing system for a medical supplies importer running several companies on one shared stock pool; scoped requirements with the owner and accountant and handled change requests.",
      "Designed a 42-table PostgreSQL schema with forced Row Level Security on 23 tables, composite foreign keys that bind child rows to their company, and a restricted app role that cannot write stock or audit tables directly.",
      "Enforced an append-only stock ledger: SECURITY DEFINER posting functions update the ledger and balances in one locked transaction, with signed-quantity checks and a consistency check that rebuilds every balance from the ledger.",
      "Built gap-free per-company invoice numbering, including linked non-sales extension invoices issued with consecutive numbers under concurrent sessions, and kept revenue reports on a sales-only view guarded by a scan test.",
      "Directed AI coding agents (Claude Code and a DeepSeek-based harness) with a written spec, AGENTS.md rules, and a project skill; gated each milestone with plan approval and exit tests, backed by 170 automated tests.",
    ],
  }, {
    ...base(1), company: "BMWare", role: "Technical Intern & System Architect", employmentType: "Internship",
    start: "2026-02", end: "2026-04", current: false, location: "", summary: "", technologies: ["Flutter", "Laravel", "PHP", "REST APIs", "PayPal SDK"],
    bullets: [
      "Delivered modular, cross-platform Flutter apps across multiple production projects, connected to a Laravel (PHP) backend through RESTful APIs.",
      "Architected the data layer (ERDs) and microservices for Adsumus Dispatch, a real-time emergency response platform with fallback state synchronization, encrypted messaging, and geolocation tracking.",
      "Kept payment data off the device in InsureMe, a production digital insurance app, by isolating the PayPal SDK behind a decoupled abstraction layer that separates payment state from app logic.",
    ],
  }];
  doc.education = [{ ...base(0), institution: "Pampanga State University", degree: "Bachelor of Science in Computer Science", field: "Computer Science", honors: "Magna Cum Laude", start: "", graduation: "2026-09", location: "", coursework: ["Software Engineering", "Database Management", "Artificial Intelligence", "Mobile Development"], activities: ["AI Lead", "Technical Research and Development"], notes: "" }];
  doc.toolkit = [
    ["Languages", ["TypeScript", "JavaScript", "Dart", "C#", "PHP", "Java", "C++", "SQL"]],
    ["Frameworks & Platforms", ["Next.js", "React", "Flutter", "Laravel", ".NET", "Node.js", "Unity"]],
    ["AI & Automation", ["RAG", "Vector databases (Qdrant)", "Embeddings", "Cross-encoder reranking", "Retrieval evaluation (Recall@k, MRR)", "Google Gemini API", "Ollama (local LLMs)", "OpenAI/Anthropic APIs", "MCP servers", "Prompt engineering", "n8n", "Agentic workflows", "YOLOv11", "Unity Sentis"]],
    ["AI Dev Workflow", ["Spec-driven planner + coding-agent workflow", "Claude Code", "DeepSeek-based harness", "Codex", "Copilot", "Cursor", "Cline", "AGENTS.md/CLAUDE.md rules", "Project skills", "Milestone plan-approval gates"]],
    ["Databases & Backend", ["PostgreSQL (RLS, triggers, PL/pgSQL)", "Drizzle ORM", "Supabase", "Better Auth", "Qdrant", "MySQL", "MS SQL Server", "Firestore", "REST APIs"]],
    ["Tools & Practices", ["Git", "GitHub Actions", "Vitest", "Docker", "Vercel", "JIRA", "Agile/Scrum", "System design (ERD, DFD)", "UI/UX"]],
  ].map(([label, items], index) => ({ ...base(index), label: label as string, items: (items as string[]).map((name, index) => ({ ...base(index), name })) }));
  doc.focus = [
    ["Full-Stack Application Development", "Next.js, React, TypeScript, and Supabase in Developer Workplace; PostgreSQL schemas with Row Level Security in MedStock."],
    ["AI / LLM Integration & RAG", "Multilingual RAG with cross-encoder reranking, Gemini assistants, and MCP integrations for Blender, Roblox, and a custom server."],
    ["Database & Ledger Design", "Append-only stock ledger, company-scoped composite keys, and forced Row Level Security."],
    ["Mobile Application Development", "Cross-platform Flutter applications integrated with Laravel REST APIs."],
    ["System Architecture", "Architecture for Adsumus Dispatch, InsureMe, and the maintenance simulator thesis."],
    ["AI-Assisted Engineering Workflow", "Spec-driven plan-execute-verify loop with Claude Code, AGENTS.md rules, and milestone approval gates."],
    ["Applied Computer Vision", "On-device YOLOv11 inference in C# through Unity Sentis."],
  ].map(([title, description], index) => ({ ...base(index), title, description, icon: "" }));
  doc.contact = { email: "franzcayanan0407@gmail.com", showEmail: true, phone: "+63 991 975 3445", showPhone: true, location: "Guagua, Pampanga, Philippines", showLocation: true, cta: "Let's connect", note: "" };
  doc.links = [
    { ...base(0), type: "portfolio", label: "Portfolio", url: "https://frami-devplace.vercel.app" },
    { ...base(1), type: "linkedin", label: "LinkedIn", url: "https://linkedin.com/in/franz-michael-cayanan-5975a5403" },
  ];
  return doc;
}
