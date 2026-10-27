import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import ts from 'typescript';
import { buildFixture, root, sha256 } from './build-fixture.mjs';

const afterAnonymous=process.argv[3]==='--phase1-anonymous';
const addendum=process.argv[3]==='--addendum'||afterAnonymous;
const baselineActions=process.argv.includes('--phase4-baseline');
const actions=process.argv.includes('--phase3-actions')||baselineActions;
const daily=process.argv.includes('--phase4');
const integrations=process.argv.includes('--phase5a');
const ai=process.argv.includes('--phase5b');
const publicPhase=process.argv.includes('--phase6');
const baselinePage=resolve(process.argv[2],'../../phase-3/phase2-app_app_page.tsx');

await buildFixture(process.argv[2], undefined, { entry: 'tests/redesign/matrix-entry.tsx', plugins: [{ name: 'matrix-boundaries', setup(builder) {
  if(baselineActions){builder.onResolve({filter:/^@\/app\/app\/page$/},()=>({path:baselinePage,namespace:'phase4-baseline'}));builder.onLoad({filter:/.*/,namespace:'phase4-baseline'},async()=>({loader:'tsx',resolveDir:root,contents:await readFile(baselinePage,'utf8')}));}
  if(publicPhase){builder.onResolve({filter:/^@\/components\/auth\/auth-provider$/},()=>({path:resolve(root,'tests/redesign/phase6-auth.ts')}));builder.onResolve({filter:/^\.\/matrix-data$/},args=>args.importer.endsWith('matrix-entry.tsx')?{path:resolve(root,process.argv.includes('--phase6-avatar')?'tests/redesign/phase6-avatar-data.ts':'tests/redesign/phase6-data.ts')}:undefined);}
  if(integrations)builder.onResolve({filter:/^\.\/matrix-data$/},args=>args.importer.endsWith('matrix-entry.tsx')?{path:resolve(root,'tests/redesign/phase5a-data.ts')}:undefined);
  if(ai){builder.onResolve({filter:/^@\/(components\/auth\/auth-provider|data\/agentInboxService)$/},()=>({path:resolve(root,'tests/redesign/phase5b-fixtures.ts')}));builder.onResolve({filter:/^\.\/matrix-data$/},args=>args.importer.endsWith('matrix-entry.tsx')?{path:resolve(root,'tests/redesign/phase5b-data.ts')}:undefined);}
  if(publicPhase){builder.onResolve({filter:/^\.\/preview-clip$/},()=>({path:'phase6-local-clip',namespace:'phase6-media'}));builder.onLoad({filter:/.*/,namespace:'phase6-media'},async()=>({loader:'js',contents:`export const previewClip=${JSON.stringify('data:video/mp4;base64,'+(await readFile('C:/webprac/redesign-baseline/pre-phase-1-addendum/synthetic-preview.mp4')).toString('base64'))};`}));}
  if(addendum){
    builder.onResolve({filter:/^@\/components\/auth\/auth-provider$/},()=>({path:resolve(root,'tests/redesign/anonymous-auth.ts')}));
    builder.onResolve({filter:/^\.\/preview-clip$/},()=>({path:'embedded-synthetic-mp4',namespace:'local-media'}));
    builder.onLoad({filter:/.*/,namespace:'local-media'},async()=>({loader:'js',contents:`export const previewClip=${JSON.stringify('data:video/mp4;base64,'+(await readFile(resolve(process.argv[2],'../synthetic-preview.mp4'))).toString('base64'))};`}));
  }
  builder.onResolve({ filter: /^next\/(link|navigation)$/ }, args => ({ path: args.path, namespace: 'matrix-next' }));
  builder.onLoad({ filter: /.*/, namespace: 'matrix-next' }, args => ({ loader: 'js', resolveDir: root, contents: args.path === 'next/link'
    ? "import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children)}"
    : "export const useParams=()=>({slug:'synthetic-project'});export const useRouter=()=>({push(){throw new Error('Navigation outside fixture')},replace(){throw new Error('Navigation outside fixture')},refresh(){}});" }));
  builder.onResolve({ filter: /^@\/(data\/.*Service|data\/context|lib\/supabase\/env|lib\/google-drive\/client)$/ }, args => ['@/data/agentInboxService','@/data/accountabilityService'].includes(args.path) ? undefined : ({ path: args.path, namespace: 'matrix-service' }));
  builder.onLoad({ filter: /.*/, namespace: 'matrix-service' }, async args => {
    const path = resolve(root, args.path.slice(2) + '.ts');
    const text = await readFile(path, 'utf8');
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    const names = [];
    for (const statement of source.statements) {
      if (!statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
      if (ts.isFunctionDeclaration(statement) && statement.name) names.push(statement.name.text);
      if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) names.push(declaration.name.text);
    }
    return { loader: 'js', resolveDir: root, contents: `import {callService} from ${JSON.stringify(resolve(root,publicPhase?'tests/redesign/phase6-data.ts':integrations?'tests/redesign/phase5a-data.ts':daily?'tests/redesign/phase4-data.ts':actions?'tests/redesign/phase3-data.ts':'tests/redesign/matrix-data.ts'))};\n` + names.map(name => `export const ${name}=(...args)=>callService(${JSON.stringify(name)},args);`).join('\n') };
  });
} }] });
if(baselineActions){const file=resolve(process.argv[2],'build-manifest.json');const manifest=JSON.parse(await readFile(file,'utf8'));manifest.sources['app/app/page.tsx']=sha256(await readFile(baselinePage));manifest.applicationSourceSnapshot=baselinePage;await writeFile(file,JSON.stringify(manifest,null,2));}
if(addendum&&!afterAnonymous){
  // Preserve the exact accepted CSS for the same phase0b-v1 visual fixtures.
  await copyFile(resolve(process.argv[2],'../../phase-0b/assets/app.css'),resolve(process.argv[2],'app.css'));
  const file=resolve(process.argv[2],'build-manifest.json');const manifest=JSON.parse(await readFile(file,'utf8'));
  manifest.cssSha256=sha256(await readFile(resolve(process.argv[2],'app.css')));
  manifest.variant='phase0b-v1; anonymous auth; optional embedded synthetic clip';
  await writeFile(file,JSON.stringify(manifest,null,2));
}
console.log('Full-component matrix bundle prepared offline.');

if(publicPhase){const f=resolve(process.argv[2],'build-manifest.json'),m=JSON.parse(await readFile(f,'utf8'));for(const p of ['components/portfolio/PublicPortfolio.tsx','components/portfolio/PortfolioHero.tsx','components/portfolio/PortfolioHero.module.css','components/portfolio/ProfessionalSections.tsx','app/projects/[slug]/page.tsx','components/public-ai/public-ai-concierge.tsx'])m.sources[p]=sha256(await readFile(resolve(root,p)));await writeFile(f,JSON.stringify(m,null,2));}
