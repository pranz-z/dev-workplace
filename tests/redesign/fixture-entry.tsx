import React from 'react';
import { createRoot } from 'react-dom/client';
import { WorkspaceAiChat } from '@/components/ai/WorkspaceAiChat';
import { fixture } from './fixtures';

// Uses the real parent's conditional mounting and the real Inbox. The only
// replacements are test-bundle aliases for auth and service boundaries.
declare global { interface Window { redesignFixture: typeof fixture } }
window.redesignFixture = fixture;
createRoot(document.getElementById('root')!).render(<div className="app-shell notebook-workspace min-h-screen">
  <p style={{ padding: 12 }}>SYNTHETIC FIXTURE — Phase 0a — no live data or transport</p>
  <WorkspaceAiChat projects={[]} tasks={[]} plans={[]} milestones={[]} open onOpenChange={() => {}} timeZone="Asia/Manila" />
</div>);
