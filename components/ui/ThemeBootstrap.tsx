/** Runs while parsing the head, before themed content can paint. */
export function ThemeBootstrap() {
  return <script dangerouslySetInnerHTML={{ __html: `(()=>{let t;try{t=localStorage.getItem('developer-workspace-theme')}catch{}document.documentElement.dataset.theme=t==='light'||t==='dark'?t:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'})()` }} />;
}
