import React from 'react';
import { createRoot } from 'react-dom/client';
import Workspace from '@/app/app/page';
import PublicPortfolio from '@/components/portfolio/PublicPortfolio';
import CaseStudy from '@/app/projects/[slug]/page';
import { fixture } from './fixtures';
import { config, publicProps, memoryResponse } from './matrix-data';
window.redesignFixture = fixture;
window.fetch = (input, init) => memoryResponse(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
  input instanceof Request ? { method: input.method, ...init } : init);
const surface = config.surface ?? 'dashboard';
createRoot(document.getElementById('root')!).render(surface === 'public' ? <PublicPortfolio {...publicProps} /> : surface === 'case-study' ? <CaseStudy /> : <Workspace />);
