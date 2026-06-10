// The workspace shell (GPT concept): a top bar, four bottom tabs
// (Home · Library · Search · Graph), and Home's two tap-tiles that open the
// existing Add / Import panels. One React root so tab switching keeps state and
// never reloads. Auth + theme live here.

import { useEffect, useState } from 'react';
import { bootstrapAuth, signOut } from '../lib/authClient';
import AddSource from './AddSource';
import ImportSite from './ImportSite';
import LibraryGraph from './LibraryGraph';
import LibraryList from './LibraryList';
import SynthesisApp from './SynthesisApp';

type Tab = 'home' | 'library' | 'search' | 'graph';
type Theme = 'light' | 'dark';

export default function AppShell() {
  const [tab, setTab] = useState<Tab>('home');
  const [tool, setTool] = useState<'add' | 'import'>('add');
  const [theme, setTheme] = useState<Theme>(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('theme-dark') ? 'dark' : 'light');

  useEffect(() => {
    bootstrapAuth().then((signedIn) => { if (!signedIn) window.location.replace('/'); }).catch(() => {});
  }, []);

  function toggleTheme() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.classList.remove('theme-light', 'theme-dark');
    document.documentElement.classList.add(`theme-${next}`);
    try { localStorage.setItem('sift-theme', next); } catch {}
    setTheme(next);
  }

  return (
    <div className="min-h-dvh">
      {/* top bar */}
      <header className="sticky top-0 z-40 flex items-center justify-between px-4 py-3"
        style={{ background: 'rgb(var(--glass) / 0.30)', backdropFilter: 'blur(20px) saturate(1.6)', WebkitBackdropFilter: 'blur(20px) saturate(1.6)', borderBottom: '1px solid var(--glass-hairline)' }}>
        <Wordmark />
        <div className="flex items-center gap-2">
          <button onClick={toggleTheme} className="btn btn-ghost" style={{ padding: '8px 11px' }} aria-label="Toggle theme">
            {theme === 'dark' ? '☾' : '☀'}
          </button>
          <button onClick={() => { signOut().finally(() => window.location.replace('/')); }} className="btn btn-ghost" style={{ padding: '8px 14px', fontSize: '0.82rem' }}>
            Log out
          </button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-6" style={{ paddingBottom: 'calc(96px + env(safe-area-inset-bottom))' }}>
        {tab === 'home' && (
          <div className="flex flex-col gap-6">
            <div className="rise px-1 pt-2">
              <h1 style={{ fontSize: 'var(--t-display)', fontWeight: 600, letterSpacing: '-0.035em', lineHeight: 1.04, margin: 0, maxWidth: '15ch' }}>
                Your kitchen, distilled.
              </h1>
              <p className="muted" style={{ margin: '12px 0 0', fontSize: '1.05rem', lineHeight: 1.5, maxWidth: '42ch' }}>
                Save a recipe or a whole blog. Sift keeps only what matters — then answers from it.
              </p>
            </div>

            <div className="rise" style={{ animationDelay: '.05s' }}>
              <div className="eyebrow" style={{ marginBottom: 10 }}>Add to your library</div>
              <div className="flex gap-3">
                <button className={'tile' + (tool === 'add' ? ' on' : '')} onClick={() => setTool('add')}>
                  <span className="tile-ic"><IconPlus /></span>
                  <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>Add a recipe</span>
                  <span className="faint" style={{ fontSize: '0.78rem' }}>Link or paste text</span>
                </button>
                <button className={'tile' + (tool === 'import' ? ' on' : '')} onClick={() => setTool('import')}>
                  <span className="tile-ic"><IconGlobe /></span>
                  <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>Import a site</span>
                  <span className="faint" style={{ fontSize: '0.78rem' }}>Bulk recipe import</span>
                </button>
              </div>
            </div>

            <div className="rise" style={{ animationDelay: '.1s' }}>
              {tool === 'add' ? <AddSource /> : <ImportSite />}
            </div>
          </div>
        )}

        {tab === 'library' && (
          <div className="rise">
            <SectionHead title="Your library" sub="Everything you’ve saved." />
            <LibraryList />
          </div>
        )}

        {tab === 'search' && (
          <div className="rise">
            <SectionHead title="Ask your kitchen" sub="A question, or a fistful of ingredients." />
            <SynthesisApp />
          </div>
        )}

        {tab === 'graph' && (
          <div className="rise">
            <SectionHead title="Your knowledge map" sub="Sources cluster their nodes; shared ingredients weave them together." />
            <LibraryGraph embedded />
          </div>
        )}
      </main>

      {/* bottom tabs */}
      <nav className="tabbar">
        <TabBtn label="Home" on={tab === 'home'} onClick={() => setTab('home')}><IconHome /></TabBtn>
        <TabBtn label="Library" on={tab === 'library'} onClick={() => setTab('library')}><IconList /></TabBtn>
        <TabBtn label="Ask" on={tab === 'search'} onClick={() => setTab('search')}><IconSearch /></TabBtn>
        <TabBtn label="Graph" on={tab === 'graph'} onClick={() => setTab('graph')}><IconGraph /></TabBtn>
      </nav>
    </div>
  );
}

function SectionHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="px-1 mb-4">
      <h1 style={{ fontSize: 'var(--t-h1)', fontWeight: 600, letterSpacing: '-0.03em', margin: 0 }}>{title}</h1>
      <p className="muted" style={{ margin: '6px 0 0', fontSize: '0.95rem' }}>{sub}</p>
    </div>
  );
}

function Wordmark() {
  return (
    <a href="/" className="flex items-center gap-2 select-none" style={{ textDecoration: 'none', color: 'var(--color-ink)' }}>
      <span style={{ position: 'relative', width: 10, height: 10 }}>
        <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'var(--ember)', boxShadow: '0 0 12px var(--ember)' }} />
      </span>
      <span style={{ fontWeight: 600, fontSize: '1.2rem', letterSpacing: '-0.03em' }}>Sift</span>
    </a>
  );
}

function TabBtn({ on, onClick, label, children }: { on: boolean; onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button className={'tab' + (on ? ' on' : '')} onClick={onClick} aria-label={label} aria-current={on}>
      {children}
      <span>{label}</span>
    </button>
  );
}

/* icons (stroke = currentColor) */
const sv = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
function IconHome() { return <svg viewBox="0 0 24 24" {...sv}><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /></svg>; }
function IconList() { return <svg viewBox="0 0 24 24" {...sv}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>; }
function IconSearch() { return <svg viewBox="0 0 24 24" {...sv}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>; }
function IconGraph() { return <svg viewBox="0 0 24 24" {...sv}><circle cx="6" cy="7" r="2.4" /><circle cx="18" cy="6" r="2.4" /><circle cx="13" cy="17" r="2.4" /><path d="M8 8l4 7M16 8l-3 8" /></svg>; }
function IconPlus() { return <svg viewBox="0 0 24 24" width="18" height="18" {...sv}><path d="M12 5v14M5 12h14" /></svg>; }
function IconGlobe() { return <svg viewBox="0 0 24 24" width="18" height="18" {...sv}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" /></svg>; }
