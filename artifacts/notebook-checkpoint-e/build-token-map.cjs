const fs = require('fs');
const cp = require('child_process');
const file = 'app/globals.css';
const css = fs.readFileSync(file, 'utf8').split(/\r?\n/);
const marker = css.findIndex(line => line.includes('Reference notebook tokens:'));
const tokens = new Map();
for (let i = 0; i < marker; i++) {
  const match = css[i].match(/^\s*(--[\w-]+)\s*:\s*([^;]+);/);
  if (!match) continue;
  const [, name, value] = match;
  if (/#[\da-f]{3,8}\b|rgba?\(|hsla?\(|color\(|linear-gradient|var\(--(?:color|accent|ink|surface|text|bg|edge|badge|progress|nav|sidebar|header|scrim|shadow)/i.test(value) || /^(?:--(?:color|accent|ink|surface|text|bg|edge|badge|progress|nav|sidebar|header|scrim|shadow))/.test(name)) {
    const entry = tokens.get(name) ?? { declarations: [] };
    entry.declarations.push(i + 1);
    tokens.set(name, entry);
  }
}
const files = cp.execFileSync('rg', ['--files','app','components','-g','*.css','-g','*.tsx','-g','*.ts'], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
const linesByFile = new Map(files.map(filename => [filename, fs.readFileSync(filename, 'utf8').split(/\r?\n/)]));
const out = ['# Legacy palette compatibility tokens and current consumers', '', `Extracted ${tokens.size} color/palette declarations before the notebook token section in app/globals.css. Uses link to source lines under app/ and components/. Direct variable uses and Tailwind @theme utility matches are included; declarations and notebook re-aliases are omitted. This is a static text-reference inventory, not a computed-style trace.`, ''];
for (const [name, entry] of tokens) {
  const uses = [];
  for (const [filename, src] of linesByFile) {
    for (let i = 0; i < src.length; i++) {
      const line = src[i];
      const direct = line.includes(`var(${name}`) && !(filename === file && i + 1 < marker && /^\s*--[\w-]+\s*:/.test(line));
      let utility = false;
      if (name.startsWith('--color-')) {
        const tokenName = name.slice('--color-'.length).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        utility = new RegExp(`\\b(?:bg|text|border|ring|outline|divide|from|via|to|fill|stroke|decoration|placeholder|accent)-${tokenName}\\b`).test(line);
      }
      if (direct || utility) uses.push(`${filename}:${i + 1}`);
    }
  }
  out.push(`- ${name} — declared ${entry.declarations.map(n => `globals.css:${n}`).join(', ')}; used at ${uses.length ? uses.map(value => { const normalized = value.replaceAll(String.fromCharCode(92), '/'); return `[${normalized}](../../${normalized})`; }).join(', ') : 'no direct source references found'}.`);
}
fs.writeFileSync('artifacts/notebook-checkpoint-e/legacy-palette-token-usage.md', out.join('\n') + '\n');
console.log(`Wrote ${tokens.size} tokens with repo-wide source references.`);
