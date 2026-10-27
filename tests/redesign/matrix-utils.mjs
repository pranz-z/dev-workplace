export const projectName = 'Synthetic project with a deliberately long descriptive title';
export async function navigate(page, key, label) {
  const button = page.locator(`.workspace-rail [data-section="${key}"]`);
  if (await button.isVisible()) await button.click();
  else {
    await page.getByRole('button', { name: 'Open workspace navigation', exact: true }).click();
    await page.locator('dialog[open]').getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).click();
  }
  await page.locator('.workspace-header h1').filter({ hasText: new RegExp(`^${label}$`, 'i') }).waitFor();
}
export async function ready(page, variant) {
  if (variant === 'error') return page.getByText("Couldn't load your synced workspace. Refresh to try again.", { exact: true }).waitFor();
  if (variant === 'loading') return;
  await page.getByText('Your current project rhythm', { exact: true }).waitFor();
}
export async function fontMetadata(page) {
  return page.evaluate(() => ({ body: getComputedStyle(document.body).fontFamily,
    heading: document.querySelector('h1,h2') ? getComputedStyle(document.querySelector('h1,h2')).fontFamily : null,
    loaded: [...document.fonts].filter(font => font.status === 'loaded').map(font => `${font.family}:${font.weight}`) }));
}
export async function settle(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
export async function controlTargets(page) {
  return page.evaluate(()=>[...document.querySelectorAll('.notebook-workspace button,.notebook-workspace a,.notebook-workspace input,.notebook-workspace select,.notebook-workspace textarea,.notebook-workspace summary,.notebook-workspace [role="separator"]')].filter(e=>e.getClientRects().length).map(e=>{const r=e.getBoundingClientRect();return {label:e.getAttribute('aria-label')||e.textContent.trim().slice(0,80),selector:`${e.tagName.toLowerCase()}.${[...e.classList].join('.')}`,component:e.closest('.workspace-rail')?'Rail':e.closest('.workspace-bottom-nav')?'Bottom navigation':e.closest('.workspace-context')?'Context sidebar':e.closest('.workspace-header')?'Toolbar':e.closest('.workspace-ai-panel')?'AI shell':'Workspace content',width:r.width,height:r.height,exception:e.matches('input[type=file].sr-only')?'Approved hidden file input; visible equivalent Files > New > File upload':null};}));
}
export async function selectSurface(page, surface) {
  const names = { projects: 'Projects', tasks: 'Tasks', files: 'Files', settings: 'Settings', calendar: 'Calendar', plans: 'Plans', notes: 'Notes', accountability: 'Accountability', tech: 'Tech Stack', portfolio: 'Portfolio', github: 'GitHub', today: 'Today' };
  if (surface === 'dashboard' || surface === 'public' || surface === 'case-study') return;
  if (surface === 'public-projects') { await page.locator('#projects').scrollIntoViewIfNeeded(); return; }
  if (surface.startsWith('ai')) {
    await page.getByRole('button', { name: 'Open Workspace AI chat', exact: true }).click();
    if (surface === 'ai-settings') await page.getByRole('button', { name: 'Settings', exact: true }).last().click();
    return;
  }
  if (surface === 'project-detail' || surface === 'project-screenshots') {
    await navigate(page, 'projects', 'Projects');
    if(!await page.locator('#workspace-content h2').filter({hasText:projectName}).count())await page.locator('#workspace-content').getByRole('button').filter({hasText:projectName}).first().click();
    if (surface === 'project-screenshots') await page.getByRole('button', { name: 'Screenshots', exact: true }).click();
    return;
  }
  if (surface === 'tasks-list') {
    await navigate(page, 'tasks', 'Tasks');
    await page.locator('#workspace-content').getByRole('button', { name: /^list$/i }).click(); return;
  }
  if (!names[surface]) throw new Error(`Unknown surface ${surface}`);
  await navigate(page, surface, names[surface]);
}
