import type { Project, Task, Plan, Milestone, TechnologyItem } from '@/types';
import { resumePortfolioSeed } from '@/lib/portfolio/resume-seed';
import { previewClip } from './preview-clip';

type MatrixConfig = { surface?: string; variant?: string; contextOptions?: Record<string, unknown> };
declare global { interface Window { matrixConfiguration: MatrixConfig; matrixFixture: { calls: Array<{ name: string; args: unknown[] }>; unexpected: string[] } } }
export const config = window.matrixConfiguration ?? {};
window.matrixFixture = { calls: [], unexpected: [] };
const id = (index: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`;
export const project: Project = { id: id(1), slug: 'synthetic-project', name: 'Synthetic project with a deliberately long descriptive title',
  description: 'Synthetic project for repeatable layout comparison. '.repeat(10), type: 'Personal', status: 'In Development', progress: 45,
  currentPhase: 'DEVELOPMENT', objective: 'Exercise real application presentation without live data.', role: 'Developer',
  startDate: '2026-10-01', targetDate: '2026-11-01', nextAction: 'Review the isolated fixture evidence.', technologies: ['TypeScript', 'React'],
  lastUpdated: '2026-10-26', githubConnected: false, visibility: 'Public', featured: true,
  health: { documentation: true, screenshots: true, github: false, testing: true, deployment: false }, links: {},
};
export const projects: Project[] = [project, { ...project, id: id(2), slug: 'synthetic-private', name: 'Synthetic private project', visibility: 'Private', description: 'Private fixture record.', featured: false }];
export const tasks: Task[] = (['Backlog','Planned','In Progress','Review','Testing','Blocked','Completed'] as const).map((status, index) => ({
  id: id(index + 10), projectId: project.id, title: `Synthetic ${status} task with a descriptive title`, description: 'Synthetic task only.',
  status, priority: index === 0 ? 'High' : 'Medium', dueDate: '2026-10-26', tags: ['fixture'], createdAt: '2026-10-20T00:00:00Z',
}));
const plans: Plan[] = [{ id: id(30), title: 'Synthetic planning checklist', goal: 'Review evidence before implementation.', deadline: '2026-11-01', status: 'Active', tasks: [{ label: 'Review local evidence', done: false }] }];
const milestone: Milestone = { id: id(40), projectId: project.id, title: 'Synthetic milestone', description: 'Fixture milestone.', status: 'pending', targetDate: '2026-11-01', order: 0 };
const technology: TechnologyItem = { id: id(70), name: 'TypeScript', category: 'Language', summary: 'Synthetic registry entry.', usedIn: [project.name], deployed: 0, clientProjects: 0 };
export const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><rect width="960" height="540" fill="#254e4a"/><text x="60" y="270" font-size="40" fill="white">SYNTHETIC LOCAL PROJECT MEDIA</text></svg>');
const screenshot = { id: id(50), projectId: project.id, projectSlug: project.slug, caption: '', signedUrl: image, storagePath: 'synthetic-only', createdAt: '2026-10-26T02:00:00Z', isPublic: true, sortOrder: 0 };
const seed = resumePortfolioSeed();
// Remove real biographical claims from the isolated synthetic content.
seed.hero.name = 'Synthetic Developer'; seed.hero.headline = 'Synthetic developer portfolio'; seed.bio = 'Synthetic portfolio content for local layout evidence.';
seed.experience = []; seed.education = []; seed.links = []; seed.focus = []; seed.toolkit = [];
export const publicProps = { initialProjects: [{ slug: project.slug, name: project.name, description: project.description, type: project.type, role: project.role,
  status: project.status, technologies: project.technologies, links: project.links, featured: true, visibility: 'Public' as const }], initialProfile: null, initialError: config.variant === 'error', initialProfessionalContent: null,
  introduction: { name: 'Synthetic Developer', headline: 'Synthetic developer portfolio', bio: 'Synthetic work and project evidence.' } };

export function callService(name: string, args: unknown[]) {
  window.matrixFixture.calls.push({ name, args: args.map(value => value instanceof AbortSignal ? 'AbortSignal' : value) });
  const empty = config.variant === 'empty';
  if (name === 'isSupabaseConfigured') return true;
  if (name === 'toProjectViewFromPublicProject') return structuredClone(project);
  if (name === 'isUuid') return typeof args[0] === 'string' && /^[a-f0-9-]{36}$/.test(args[0]);
  // The real Accountability view requests a snapshot on mount. Discard that
  // synthetic request here: no stored snapshot, service or endpoint is used.
  if (name === 'captureDailyAccountabilitySnapshots') return Promise.resolve();
  if (name === 'driveClientRequest') return memoryResponse(String(args[0]), args[1] as RequestInit).then(result => result.json());
  const reads: Record<string, unknown> = {
    loadWorkspaceData: { projects: empty ? [] : projects, tasks: empty ? [] : tasks, milestones: empty ? [] : [milestone], plans: empty ? [] : plans,
      notes: empty ? [] : [{ id: id(60), title: 'Synthetic note', content: 'Synthetic local note.', projectId: project.id, updatedAt: '2026-10-26' }], technologies: [technology] },
    getProfileTimeZone: 'Asia/Manila', listAccountabilityData: { goals: [], snapshots: [] },
    listTimeBlocks: { items: [], truncated: false }, getSchedulingPreferences: null,
    listProjects: projects, listTasks: tasks, listPlans: plans, listProjectMilestones: [milestone], listMilestones: [milestone], listNotes: [],
    listTechnologies: [technology], listProjectTechnologyNames: {}, hasLinkedGithubRepository: false, listLinkedGithubProjectIds: [],
    listProjectScreenshots: empty ? [] : [screenshot, { ...screenshot, id: id(51), caption: 'Synthetic caption with enough text to exercise wrapping.' }],
    listPublicProjectScreenshots: empty ? [] : [screenshot], getPublicProjectBySlug: config.variant === 'notfound' ? null : project,
    getProjectPreviewVideo: { video: null }, loadPortfolioDraft: { content: seed, revision: 1, enabled: true, aiEnabled: false },
    getProfile: null, getCurrentProfile: null, getProjectSettings: null,
  };
  if (name === 'loadWorkspaceData' && config.variant === 'loading') return new Promise(() => {});
  if (name === 'loadWorkspaceData' && config.variant === 'error') return Promise.reject(new Error('Synthetic workspace load error'));
  if (Object.hasOwn(reads, name)) return Promise.resolve(structuredClone(reads[name]));
  window.matrixFixture.unexpected.push(name);
  throw new Error(`Unimplemented/forbidden fixture service: ${name}`);
}

export async function memoryResponse(input: string, init: RequestInit = {}) {
  const url = new URL(input, location.origin);
  const method = init.method ?? 'GET';
  window.matrixFixture.calls.push({ name: `memory-http:${method}:${url.pathname}`, args: [] });
  if (url.origin !== location.origin || method !== 'GET') throw new Error('Only synthetic memory GET projections are supported');
  if (config.variant === 'integration-error' && ['/api/drive/status','/api/github/repositories'].includes(url.pathname)) throw new Error('Synthetic integration unavailable.');
  const payloads: Record<string, unknown> = {
    '/api/drive/status': { connected: config.variant !== 'disconnected' },
    '/api/drive/files': { files: config.variant === 'empty' ? [] : [
      { id: id(80), name: 'Synthetic project folder', mime_type: 'application/vnd.google-apps.folder', size_bytes: 0, modified_at: '2026-10-26T02:00:00Z', status: 'active', project_id: project.id, task_id: null, parent_id: null, is_project_folder: true, created_at: '2026-10-26T02:00:00Z', updated_at: '2026-10-26T02:00:00Z' },
      { id: id(81), name: 'Synthetic folder', mime_type: 'application/vnd.google-apps.folder', size_bytes: 0, modified_at: '2026-10-26T02:00:00Z', status: 'active', project_id: null, task_id: null, parent_id: null, is_project_folder: false, created_at: '2026-10-26T02:00:00Z', updated_at: '2026-10-26T02:00:00Z' },
      { id: id(82), name: 'Synthetic layout reference.pdf', mime_type: 'application/pdf', size_bytes: 2048, modified_at: '2026-10-26T02:00:00Z', status: 'active', project_id: project.id, task_id: null, parent_id: null, is_project_folder: false, created_at: '2026-10-26T02:00:00Z', updated_at: '2026-10-26T02:00:00Z' },
    ], count: config.variant === 'empty' ? 0 : 3, nextOffset: 0 },
    '/api/github/link': { connected: false, repository: null, installation: null }, '/api/github/repositories': { repositories: [], installations: [], connected: false },
    '/api/ai': { configured: false, model: null }, '/api/public-ai': { enabled: false, configured: false },
    '/api/ai/agent/activity': { items: [], nextCursor: null },
  };
  if (url.pathname.endsWith('/preview-video')) return config.variant === 'preview' && previewClip
    ? Response.json({url:previewClip,mimeType:'video/mp4',expiresAt:Date.now()+900000})
    : new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
  if (Object.hasOwn(payloads, url.pathname)) return Response.json(payloads[url.pathname]);
  window.matrixFixture.unexpected.push(`GET ${url.pathname}`);
  throw new Error(`Unimplemented fixture projection: ${url.pathname}`);
}
