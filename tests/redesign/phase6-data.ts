import { config, publicProps as originalProps, project, image, callService as originalService, memoryResponse as originalResponse } from './matrix-data';
import { emptyPortfolio } from '@/lib/portfolio/content';
import { previewClip } from './preview-clip';
export { config };
const content = emptyPortfolio();
const base = { enabled: true, sort_order: 0 };
content.hero = { name: 'Synthetic Developer', headline: 'Synthetic developer portfolio', description: 'Synthetic local portfolio background.', tagline: 'Synthetic published work.', avatar: '' };
content.about = { title: 'About my work', body: 'Synthetic portfolio content for local layout evidence.', secondary: 'Synthetic second paragraph with deliberately long content. '.repeat(8) };
content.experience = [{ ...base, id: 'fixture-experience', company: 'Synthetic organization', role: 'Synthetic developer', employmentType: 'Local fixture', start: '2026-01', end: '2026-04', current: false, location: 'Synthetic location', summary: 'Synthetic experience description.', bullets: ['Synthetic contribution; no real achievement claimed.'], technologies: ['TypeScript'] }];
content.education = [{ ...base, id: 'fixture-education', institution: 'Synthetic institution', degree: 'Synthetic degree with a long descriptive name', field: 'Synthetic subject', honors: '', start: '2022-01', graduation: '2026-09', location: '', coursework: ['Synthetic coursework'], activities: [], notes: 'Synthetic education only.' }];
content.toolkit = [{ ...base, id: 'fixture-toolkit', label: 'Languages', items: [{ ...base, id: 'fixture-skill', name: 'TypeScript' }] }, { ...base, id: 'fixture-toolkit2', label: 'Frameworks', items: [{ ...base, id: 'fixture-skill2', name: 'React' }] }];
content.contact = { ...content.contact, email: 'fixture@example.test', showEmail: true, cta: "Let's connect", note: 'Synthetic contact only.' };
content.focus = [{ ...base, id: 'fixture-focus', title: 'Synthetic engineering focus', description: 'Synthetic public engineering context.', icon: '' }];
const extra = { ...originalProps.initialProjects[0], slug: 'synthetic-no-cover', name: 'SyntheticUnbrokenProjectNameForWrapping'.repeat(3), featured: false, type: 'Web', publicSummary: 'Synthetic concise public context.' };
export const publicProps = config.variant === 'baseline' || config.variant === 'preview' ? originalProps : {
  ...originalProps, initialProjects: config.variant === 'empty' ? [] : [...originalProps.initialProjects, extra],
  initialProfessionalContent: content, initialError: config.variant === 'error',
};
export function callService(name: string, args: unknown[]) {
  if (name === 'getPublicProjectBySlug' && ['loading', 'error'].includes(config.variant ?? '')) {
    window.matrixFixture.calls.push({ name, args });
    return config.variant === 'loading' ? new Promise(() => {}) : Promise.reject(new Error('Synthetic public source failure'));
  }
  if (name === 'toProjectViewFromPublicProject') return { ...project, publicProblem: 'Synthetic published problem.', publicSolution: 'Synthetic published approach.', publicResult: 'Synthetic published current status.' };
  return originalService(name, args);
}
export async function memoryResponse(input: string, init: RequestInit = {}) {
  const url = new URL(input, location.origin);
  if (url.pathname === '/api/public-ai') {
    window.matrixFixture.calls.push({ name: `memory-http:${init.method ?? 'GET'}:${url.pathname}`, args: init.body ? [JSON.parse(String(init.body))] : [] });
    if (!init.method || init.method === 'GET') return Response.json({ available: config.variant !== 'baseline' && config.variant !== 'preview' });
    if (init.method === 'POST') return config.variant === 'ai-error' ? Response.json({ error: { message: 'Synthetic public assistant failure.' } }, { status: 503 }) : Response.json({ answer: 'Synthetic answer from public fixture context only.', relatedProjects: [] });
    throw new Error('Forbidden public fixture method');
  }
  if (url.pathname.endsWith('/preview-video') && config.variant === 'rich') {
    window.matrixFixture.calls.push({ name: `memory-http:GET:${url.pathname}`, args: [] });
    return Response.json({ url: previewClip, mimeType: 'video/mp4', expiresAt: Date.now() + 900000 });
  }
  return originalResponse(input, init);
}
