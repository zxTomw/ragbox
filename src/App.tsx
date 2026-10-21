import { memo, useEffect, useId, useRef, useState } from 'react';
import type { ComponentType, ReactNode, RefObject } from 'react';
import { useStore } from 'zustand';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import {
  ArrowDownToLine, ArrowRight, ArrowUp, ArrowUpRight, BookOpen, Check, ChevronDown,
  ChevronRight, CircleHelp, Copy, Cpu, Database, ExternalLink, FileText, FlaskConical,
  Globe2, HardDrive, Layers3, Menu, MessageSquare, Plus, RefreshCw, Search,
  Settings2, ShieldCheck, Sparkles, Square, Trash2, X,
} from 'lucide-react';
import type { LucideProps } from 'lucide-react';
import type { AppRuntime } from './app-runtime.ts';
import { currentConversation, currentDraft, savedConversations } from './conversations.ts';
import { collectionReady } from './resource-state.ts';
import type { ResourceState } from './resource-state.ts';
import type { ChatTurn, Corpus, SearchResult } from './types.ts';
import { MAX_QUESTION_LENGTH } from './chat-controller.ts';
import { EXAMPLE_POOL } from './example-queries.ts';
import { formatBytes } from './format.ts';

gsap.registerPlugin(useGSAP);

const COLLECTIONS: Record<Corpus, {
  name: string; label: string; description: string; count: string; size: string;
  icon: ComponentType<LucideProps>; examples: readonly string[];
}> = {
  nfcorpus: {
    name: 'NFCorpus', label: 'SCIENCE & HEALTH',
    description: 'Explore nutrition, health, and medical research.',
    count: '3,633 documents', size: 'Small download', icon: FlaskConical,
    examples: EXAMPLE_POOL.nfcorpus.slice(0, 3),
  },
  msmarco: {
    name: 'MS MARCO', label: 'A WORLD OF KNOWLEDGE',
    description: 'Find answers across millions of web passages.',
    count: '8.8M passages', size: '3.35 GB index', icon: Globe2,
    examples: EXAMPLE_POOL.msmarco.slice(0, 3),
  },
};
type SetupTab = 'collections' | 'model' | 'storage';
type SourceSelection = { conversationId: string; turnId: string; document: SearchResult };

function BrandMark({ small = false }: { small?: boolean }) {
  return <span className={`brand-mark ${small ? 'brand-mark-small' : ''}`} aria-hidden="true">
    <svg viewBox="0 0 32 32" fill="none"><path d="m16 3 11 6.5v13L16 29 5 22.5v-13L16 3Zm0 0v13m11-6.5L16 16 5 9.5M16 16v13" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
  </span>;
}
function StatusDot({ ready = false, busy = false }: { ready?: boolean; busy?: boolean }) {
  return <span aria-hidden="true" className={`status-dot ${ready ? 'is-ready' : ''} ${busy ? 'is-busy' : ''}`} />;
}
function stateLabel(state: ResourceState) {
  const labels: Partial<Record<ResourceState['phase'], string>> = {
    ready: 'Ready to explore', saved: 'Saved on device', checking: 'Checking collection',
    preparing: 'Preparing index', downloading: 'Downloading index', opening: 'Opening index',
    error: 'Needs attention', unsupported: 'Browser not supported',
  };
  return labels[state.phase] ?? 'Not downloaded';
}
function isResourceBusy(state: ResourceState) {
  return ['checking', 'opening', 'preparing', 'downloading', 'loading'].includes(state.phase);
}

export function App({ runtime }: { runtime: AppRuntime }) {
  const shell = useRef<HTMLDivElement>(null);
  const navigation = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const snapshot = useStore(runtime.conversations.state);
  const resources = useStore(runtime.states.state);
  const conversation = currentConversation(snapshot);
  const [view, setView] = useState<'chat' | 'collections'>('chat');
  const [setupTab, setSetupTab] = useState<SetupTab | null>(null);
  const [source, setSource] = useState<SourceSelection | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const recent = savedConversations(snapshot);
  const selected = snapshot.selected;
  const hasTurns = conversation.turns.length > 0;

  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add('(min-width: 651px) and (prefers-reduced-motion: no-preference)', () => {
      gsap.from('.sidebar-brand, .sidebar-primary, .sidebar-section, .sidebar-footer', {
        autoAlpha: 0, x: -10, duration: 0.55, stagger: 0.07, ease: 'power2.out',
      });
    }, shell);
    media.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.from('.workspace-header', { autoAlpha: 0, y: -6, duration: 0.5 });
    }, shell);
    return () => media.revert();
  }, { scope: shell });

  useEffect(() => {
    document.title = `${view === 'collections' ? 'Collections' : hasTurns ? conversation.title : 'Your knowledge, connected'} · RAGbox`;
  }, [view, hasTurns, conversation.title]);
  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 650px)');
    const changed = () => { if (!media?.matches) setSidebarOpen(false); };
    media?.addEventListener('change', changed);
    return () => media?.removeEventListener('change', changed);
  }, []);
  useEffect(() => {
    if (!sidebarOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    navigation.current?.querySelector<HTMLButtonElement>('.mobile-nav-close')?.focus();
    return () => { document.body.style.overflow = previousOverflow; menuButton.current?.focus(); };
  }, [sidebarOpen]);
  function choose(corpus: Corpus) { runtime.chat.select(corpus); setSource(null); }
  function newChat() {
    runtime.chat.newChat(); setView('chat'); setSidebarOpen(false);
    requestAnimationFrame(() => messageRef.current?.focus());
  }
  function openChat(id: string) {
    runtime.chat.open(id); setView('chat'); setSidebarOpen(false); setSource(null);
  }
  function example(question: string) {
    runtime.conversations.setDraft(question); messageRef.current?.focus();
    if (runtime.chat.canSend()) void runtime.chat.send(question);
  }

  return <div ref={shell} className="app-shell">
    <a className="skip-link" href="#main-content">Skip to workspace</a>
    {sidebarOpen && <button className="sidebar-scrim" aria-hidden="true" tabIndex={-1} onClick={() => setSidebarOpen(false)} />}
    <aside ref={navigation} className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`} aria-label="Workspace navigation" role={sidebarOpen ? 'dialog' : undefined} aria-modal={sidebarOpen || undefined} onKeyDown={event => {
      if (!sidebarOpen) return;
      if (event.key === 'Escape') { event.preventDefault(); setSidebarOpen(false); }
      if (event.key === 'Tab') {
        const controls = Array.from(navigation.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]') ?? []).filter(element => getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden');
        const first = controls[0]; const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <button className="icon-button mobile-nav-close" aria-label="Close navigation" onClick={() => setSidebarOpen(false)}><X size={18} /></button>
      <button className="sidebar-brand" onClick={newChat} aria-label="RAGbox home"><BrandMark /><span>ragbox<span className="brand-period">.</span></span><span className="beta-label">BETA</span></button>
      <div className="sidebar-primary"><button className="new-chat-button" aria-label="New conversation" onClick={newChat}><Plus size={17} />New conversation<span className="key-hint" aria-hidden="true"><ArrowUpRight size={14} /></span></button>
        <nav className="primary-nav" aria-label="Main">
          <button className={view === 'chat' ? 'nav-active' : ''} onClick={() => { setView('chat'); setSidebarOpen(false); }} aria-current={view === 'chat' ? 'page' : undefined}><MessageSquare size={17} />Chat<span className="nav-active-dot" /></button>
          <button aria-label="Collections" className={view === 'collections' ? 'nav-active' : ''} onClick={() => { setView('collections'); setSidebarOpen(false); }} aria-current={view === 'collections' ? 'page' : undefined}><Layers3 size={17} />Collections<span className="nav-count" aria-hidden="true">02</span></button>
        </nav>
      </div>
      <section className="sidebar-section">
        <div className="sidebar-section-label">RECENT CONVERSATIONS<span>{recent.length ? recent.length.toString().padStart(2, '0') : '—'}</span></div>
        {recent.length ? <div className="recent-list">{recent.map(item => <button key={item.id} aria-label={item.title} className={`recent-chat ${item.id === conversation.id && view === 'chat' ? 'recent-active' : ''}`} title={item.title} onClick={() => openChat(item.id)}>
          <MessageSquare size={14} /><span>{item.title}</span><span className="recent-corpus">{item.corpus === 'nfcorpus' ? 'NF' : 'MS'}</span>
        </button>)}</div> : <div className="history-empty"><span className="history-line" /><span className="history-line short" /><p>A little curiosity goes a long way.<br />Your conversations will live here.</p></div>}
      </section>
      <div className="sidebar-footer">
        <div className="local-note"><span className="local-note-icon"><ShieldCheck size={19} /></span><div><strong>Yours. And only yours.</strong><p>No uploads. No API keys.</p></div></div>
        <button className="sidebar-settings" onClick={() => setSetupTab('collections')}><Settings2 size={16} />Workspace setup<ArrowUpRight size={14} /></button>
        <div className="sidebar-bottom"><span><StatusDot ready />Running on your device</span><a href="https://github.com/zxTomw/ragbox" target="_blank" rel="noreferrer" aria-label="View RAGbox on GitHub"><ExternalLink size={13} /></a></div>
      </div>
    </aside>
    <main id="main-content" className="workspace" tabIndex={-1} inert={sidebarOpen}>
      <header className="workspace-header">
        <div className="header-breadcrumb"><button ref={menuButton} className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button><span className="breadcrumb-root">Workspace</span><ChevronRight size={13} /><span>{view === 'collections' ? 'Collections' : 'Chat'}</span></div>
        <div className="header-actions"><span className="local-badge"><span className="tiny-orbit" /><span>LOCAL FIRST</span></span><span className="header-divider" /><button className="icon-button" onClick={() => setSetupTab('model')} aria-label="About local answers" title="Local answer model"><Cpu size={17} /></button></div>
      </header>
      {view === 'collections' ? <Library runtime={runtime} selected={selected} onSelect={corpus => { choose(corpus); setView('chat'); }} onModel={() => setSetupTab('model')} /> : <div className={`chat-workspace ${hasTurns ? 'has-conversation' : ''}`}>
        {hasTurns ? <>
          <div className="conversation-heading"><div><span className="eyebrow">YOUR CONVERSATION</span><h1>{conversation.title}</h1></div><button className="collection-pill" onClick={() => setSetupTab('collections')}><Database size={13} />{COLLECTIONS[selected].name}<ChevronDown size={13} /></button></div>
          <Transcript key={conversation.id} conversationId={conversation.id} turns={conversation.turns} runtime={runtime} onSource={value => setSource({ conversationId: conversation.id, turnId: value.turnId, document: value.document })} onModel={() => setSetupTab('model')} />
        </> : <Welcome key={selected} selected={selected} resources={resources.resources} onSelect={choose} />}
        <div className={`composer-area ${hasTurns ? 'composer-docked' : ''}`}>
          <Composer runtime={runtime} messageRef={messageRef} onSetup={() => setSetupTab('collections')} onModel={() => setSetupTab('model')} />
          {!hasTurns && <>
            {!collectionReady(resources, selected) && <CollectionNudge runtime={runtime} corpus={selected} />}
            <div className="starter-section"><span className="starter-label">A LITTLE INSPIRATION</span><div className="starter-questions">{COLLECTIONS[selected].examples.map(question => <button key={question} onClick={() => example(question)}>{question}<ArrowUpRight size={14} /></button>)}</div></div>
          </>}
          <p className="composer-footnote"><ShieldCheck size={12} />Private by design. Powered by your browser.<span className="footnote-separator">·</span><span>Always check the sources.</span></p>
          {snapshot.unsaved && <p className="inline-warning" role="status">{snapshot.unsaved}</p>}
        </div>
      </div>}
      <footer className="workspace-footer"><span>LESS GUESSWORK. MORE GROUNDING.</span><span>Built with DuckDB & a little curiosity<ArrowUpRight size={11} /></span></footer>
    </main>
    {setupTab && <SetupPanel runtime={runtime} tab={setupTab} onTab={setSetupTab} onChoose={corpus => { choose(corpus); setView('chat'); setSidebarOpen(false); }} onClose={() => setSetupTab(null)} />}
    {source && <SourcePanel selection={source} onClose={() => setSource(null)} />}
  </div>;
}

function Welcome({ selected, resources, onSelect }: { selected: Corpus; resources: Record<string, ResourceState>; onSelect(corpus: Corpus): void }) {
  const container = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.timeline({ defaults: { duration: 0.55, ease: 'power3.out' } })
        .from('.welcome-eyebrow, .welcome-title, .welcome-description', { y: 15, autoAlpha: 0, stagger: 0.075 })
        .from('.collection-card', { y: 14, autoAlpha: 0, stagger: 0.07 }, '-=0.3');
    }, container);
    return () => media.revert();
  }, { scope: container });
  return <div ref={container} className="welcome">
    <div className="welcome-eyebrow"><span className="eyebrow-line" />YOUR KNOWLEDGE, CONNECTED<span className="eyebrow-line" /></div>
    <h1 className="welcome-title">Good questions.<br /><span>Grounded answers.</span></h1>
    <p className="welcome-description">A quieter space to explore, connect, and understand.<br className="desktop-break" /> Pick a collection. Follow your curiosity.</p>
    <div className="collection-picker" aria-label="Choose your collection">{(['nfcorpus', 'msmarco'] as const).map((corpus, index) => {
      const item = COLLECTIONS[corpus]; const Icon = item.icon; const state = resources[corpus];
      return <button key={corpus} className={`collection-card ${selected === corpus ? 'collection-selected' : ''}`} onClick={() => onSelect(corpus)} aria-label={`Use ${item.name}`} aria-pressed={selected === corpus}>
        <div className="collection-card-top"><span className="collection-category"><span>0{index + 1}</span>{item.label}</span><span className="selection-indicator">{selected === corpus && <Check size={10} strokeWidth={3} />}</span></div>
        <div className="collection-card-name"><Icon size={21} strokeWidth={1.4} /><h2>{item.name}</h2></div><p>{item.description}</p>
        <div className="collection-card-bottom"><span>{item.count}</span><span className={state.phase === 'ready' ? 'collection-is-ready' : ''}><StatusDot ready={state.phase === 'ready'} busy={isResourceBusy(state)} />{state.phase === 'ready' ? 'Ready' : state.phase === 'saved' ? 'Saved' : 'Local index'}</span></div>
      </button>;
    })}</div>
  </div>;
}

function Composer({ runtime, messageRef, onSetup, onModel }: { runtime: AppRuntime; messageRef: RefObject<HTMLTextAreaElement | null>; onSetup(): void; onModel(): void }) {
  const snapshot = useStore(runtime.conversations.state);
  const resources = useStore(runtime.states.state);
  const draft = currentDraft(snapshot);
  const ready = collectionReady(resources, snapshot.selected);
  const running = runtime.chat.running;
  const tooLong = draft.trim().length > MAX_QUESTION_LENGTH;
  const canSend = runtime.chat.canSend() && !!draft.trim() && !tooLong;
  const id = useId();
  useEffect(() => {
    if (!messageRef.current) return;
    messageRef.current.style.height = 'auto';
    messageRef.current.style.height = `${Math.min(Math.max(messageRef.current.scrollHeight, 52), 160)}px`;
  }, [draft, messageRef]);
  function submit() { if (canSend) void runtime.chat.send(draft); }
  return <form className={`composer ${running ? 'composer-working' : ''}`} onSubmit={event => { event.preventDefault(); if (running) runtime.chat.stop(); else submit(); }}>
    <label htmlFor={id} className="sr-only">Message</label>
    <textarea id={id} ref={messageRef} value={draft} rows={2} placeholder={snapshot.activeOperation ? 'Keep your next question in mind…' : `What would you like to know${currentConversation(snapshot).turns.length ? ' next' : ''}?`} onChange={event => runtime.conversations.setDraft(event.target.value)}
      onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); } }} aria-invalid={tooLong} aria-describedby={`${id}-help`} />
    <div className="composer-toolbar"><div className="composer-tools"><button type="button" className="composer-collection" onClick={onSetup}><Database size={13} />{COLLECTIONS[snapshot.selected].name}<ChevronDown size={12} /></button><span className="toolbar-divider" /><button type="button" className={`model-mode ${runtime.model.ready ? 'model-enabled' : ''}`} onClick={onModel}><Sparkles size={13} />{runtime.model.ready ? 'AI answers on' : 'Search only'}<ChevronDown size={12} /></button></div>
      <div className="send-controls"><span id={`${id}-help`} className={`composer-hint ${tooLong ? 'length-error' : ''}`}>{tooLong ? `${draft.trim().length}/${MAX_QUESTION_LENGTH} characters` : ready ? 'Enter to send' : 'Set up to begin'}</span><button type="submit" className="send-button" aria-label={running ? 'Stop response' : 'Send message'} disabled={!running && !canSend}>{running ? <Square size={15} fill="currentColor" /> : <ArrowUp size={20} />}</button></div>
    </div>
  </form>;
}

function CollectionNudge({ runtime, corpus }: { runtime: AppRuntime; corpus: Corpus }) {
  const resources = useStore(runtime.states.state);
  const state = resources.resources[corpus]; const busy = isResourceBusy(state);
  return <div className={`collection-nudge ${['error', 'unsupported'].includes(state.phase) ? 'nudge-error' : ''}`}>
    <span className="nudge-icon">{busy ? <RefreshCw size={15} className="spin" /> : <ArrowDownToLine size={16} />}</span>
    <div><strong>{busy ? stateLabel(state) : state.phase === 'unsupported' ? 'A browser with local storage is needed' : state.phase === 'error' ? 'Let’s get your collection ready' : state.phase === 'saved' ? 'Your index is saved on this device' : 'A little setup. A lot to discover.'}</strong>
      <p>{busy || ['error', 'unsupported'].includes(state.phase) ? state.message : corpus === 'nfcorpus' ? 'Prepare NFCorpus once, then explore 3,633 research documents.' : 'Download the 3.35 GB MS MARCO index to search on your device.'}</p>
      {state.progress !== undefined && busy && <progress aria-label="Index download progress" value={state.progress} max={100} />}
    </div><CollectionAction runtime={runtime} corpus={corpus} compact />
  </div>;
}

function CollectionAction({ runtime, corpus, compact = false }: { runtime: AppRuntime; corpus: Corpus; compact?: boolean }) {
  const resources = useStore(runtime.states.state); const state = resources.resources[corpus];
  if (state.phase === 'ready') return <span className="ready-label"><Check size={13} />Ready on device</span>;
  if (state.phase === 'downloading') return <button className="text-button" onClick={() => runtime.cancelDownload()}>Cancel download</button>;
  const busy = isResourceBusy(state);
  const label = busy ? 'Please wait' : corpus === 'nfcorpus' ? 'Prepare NFCorpus' : state.savedAvailable || state.phase === 'saved' ? 'Open saved index' : 'Download MS MARCO';
  return <button type="button" className={compact ? 'nudge-action' : 'primary-button'} disabled={busy || state.phase === 'unsupported' || resources.busy || resources.shuttingDown} onClick={() => {
    if (corpus === 'nfcorpus') void runtime.prepareNFCorpus();
    else if (state.savedAvailable || state.phase === 'saved') void runtime.openMSMarco();
    else void runtime.downloadMSMarco();
  }}>{busy ? <RefreshCw size={14} className="spin" /> : compact ? null : <ArrowDownToLine size={15} />}{label}{compact && !busy && <ArrowRight size={14} />}</button>;
}

function Transcript({ conversationId, turns, runtime, onSource, onModel }: {
  conversationId: string; turns: ChatTurn[]; runtime: AppRuntime; onSource(source: { turnId: string; document: SearchResult }): void; onModel(): void;
}) {
  const lastRow = useRef<HTMLDivElement>(null); const lastTurn = turns.at(-1)?.id;
  useEffect(() => { lastRow.current?.scrollIntoView?.({ block: 'start', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); }, [lastTurn]);
  return <div className="transcript" aria-label="Conversation">{turns.map((turn, index) => <div key={turn.id} ref={index === turns.length - 1 ? lastRow : undefined}><Turn turn={turn} latest={index === turns.length - 1} conversationId={conversationId} runtime={runtime} onSource={onSource} onModel={onModel} /></div>)}</div>;
}

const Turn = memo(function Turn({ turn, latest, conversationId, runtime, onSource, onModel }: {
  turn: ChatTurn; latest: boolean; conversationId: string; runtime: AppRuntime; onSource(source: { turnId: string; document: SearchResult }): void; onModel(): void;
}) {
  const row = useRef<HTMLElement>(null); const [sourcesOpen, setSourcesOpen] = useState(false); const [copied, setCopied] = useState('');
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const busy = useStore(runtime.states.state, state => state.busy || state.shuttingDown);
  const active = useStore(runtime.conversations.state, state => !!state.activeOperation);
  const sourceListId = useId(); const working = ['resolving', 'retrieving', 'waiting', 'generating'].includes(turn.phase);
  useEffect(() => () => clearTimeout(timeout.current), []);
  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)', () => { gsap.from(row.current, { autoAlpha: 0, y: 12, duration: 0.4, ease: 'power2.out' }); });
    return () => media.revert();
  }, { scope: row });
  async function copy() {
    try { await navigator.clipboard.writeText(turn.answer); setCopied('Copied'); } catch { setCopied('Select text to copy'); }
    clearTimeout(timeout.current); timeout.current = setTimeout(() => setCopied(''), 2000);
  }
  return <article className="chat-turn" ref={row} aria-label="Question and reply" data-phase={turn.phase} data-conversation={conversationId}>
    <div className="user-message"><span className="speaker-label">YOU</span><p>{turn.question}</p></div>
    <div className="assistant-message"><div className="assistant-avatar"><BrandMark small /></div><div className="assistant-body"><div className="assistant-label">ragbox<span>GROUNDED IN YOUR COLLECTION</span></div>
      {turn.thinking && <details className="thinking"><summary><Sparkles size={13} />{working && !turn.answer ? 'Thinking…' : 'Reasoning'}<ChevronDown size={13} /></summary><p>{turn.thinking}</p></details>}
      {turn.answer && <div className="answer-text"><AnswerText text={turn.answer} documents={turn.results} includedIds={turn.includedIds} onSource={document => onSource({ turnId: turn.id, document })} /></div>}
      {!turn.answer && turn.phase === 'blocked' && <div className="search-summary"><h3>{turn.results.length ? 'Here’s what your collection has to say.' : 'No matching documents found.'}</h3><p>{turn.results.length ? `Found ${turn.results.length} relevant ${turn.results.length === 1 ? 'source' : 'sources'}. Explore ${turn.results.length === 1 ? 'it' : 'them'} below, or enable the local model for a cited answer.` : 'Try a more specific question or a few different keywords.'}</p></div>}
      {(working || turn.phase === 'error' || turn.phase === 'stopped') && <div className={`turn-status ${turn.phase === 'error' ? 'inline-warning' : ''}`} role="status">{working && <span className="working-indicator"><i /><i /><i /></span>}{turn.message}</div>}
      {turn.contextLimited && <p className="context-note">Using recent conversation context within the model’s limit.</p>}
      {turn.results.length > 0 && <div className="sources-block"><button className="sources-toggle" aria-label={`${turn.results.length} ${turn.results.length === 1 ? 'source' : 'sources'}`} aria-expanded={sourcesOpen} aria-controls={sourceListId} onClick={() => setSourcesOpen(value => !value)}><span className="source-icons"><FileText size={12} /><FileText size={12} /><FileText size={12} /></span>{turn.results.length} {turn.results.length === 1 ? 'source' : 'sources'}{turn.elapsedMs !== undefined && <span className="source-time">{turn.elapsedMs.toFixed(0)} ms</span>}<ChevronDown size={14} className={sourcesOpen ? 'chevron-open' : ''} /></button>
        {sourcesOpen && <SourceList id={sourceListId} turn={turn} onSource={document => onSource({ turnId: turn.id, document })} />}
      </div>}
      <div className="answer-actions">{turn.answer && <button className="text-button" onClick={() => void copy()} aria-label="Copy answer">{copied === 'Copied' ? <Check size={13} /> : <Copy size={13} />}{copied || 'Copy'}</button>}
        {latest && ['error', 'stopped', 'blocked'].includes(turn.phase) && <button className="text-button" disabled={active || busy || !runtime.chat.canSend()} onClick={() => void runtime.chat.retry()}><RefreshCw size={13} />Retry</button>}
        {turn.phase === 'blocked' && !runtime.model.ready && <button className="text-button answer-model-action" onClick={onModel}><Sparkles size={13} />Enable AI answers<ArrowUpRight size={12} /></button>}
        {turn.keywordOnly && <span className="keyword-label">Keyword search</span>}
      </div>
    </div></div>
  </article>;
});

function AnswerText({ text, documents, includedIds, onSource }: { text: string; documents: SearchResult[]; includedIds: string[]; onSource(document: SearchResult): void }) {
  const nodes: ReactNode[] = []; let position = 0; const included = new Set(includedIds);
  for (const match of text.matchAll(/\[([A-Za-z0-9_.:-]+)\]/g)) {
    if (match.index > position) nodes.push(text.slice(position, match.index));
    const document = documents.find(document => document.id === match[1] && included.has(document.id));
    nodes.push(document ? <button key={`${match.index}-${document.id}`} className="citation" onClick={() => onSource(document)} aria-label={`View source ${document.id}`}>{documents.indexOf(document) + 1}</button> : match[0]);
    position = match.index + match[0].length;
  }
  if (position < text.length) nodes.push(text.slice(position));
  return <>{nodes}</>;
}

function SourceList({ id, turn, onSource }: { id: string; turn: ChatTurn; onSource(document: SearchResult): void }) {
  const root = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)', () => { gsap.from('.source-card', { autoAlpha: 0, y: 6, stagger: 0.035, duration: 0.25 }); }, root);
    return () => media.revert();
  }, { scope: root });
  return <div className="source-list" id={id} ref={root}><p className="source-query"><Search size={12} />{turn.searchQuery ?? turn.question}</p>{turn.results.map((document, index) => <button className="source-card" key={document.id} onClick={() => onSource(document)}><span className="source-number">{index + 1}</span><span><strong>{document.title}</strong><span className="source-excerpt">{document.text.slice(0, 165)}{document.text.length > 165 ? '…' : ''}</span><span className="source-metadata">{document.id} <span>·</span> BM25 {document.score.toFixed(3)}</span></span><ArrowUpRight size={14} /></button>)}</div>;
}

function Library({ runtime, selected, onSelect, onModel }: { runtime: AppRuntime; selected: Corpus; onSelect(corpus: Corpus): void; onModel(): void }) {
  const resources = useStore(runtime.states.state);
  const root = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)', () => { gsap.from('.library-heading, .library-card, .library-model', { autoAlpha: 0, y: 12, stagger: 0.07, duration: 0.45 }); }, root);
    return () => media.revert();
  }, { scope: root });
  return <div className="library" ref={root}><div className="library-heading"><span className="eyebrow">A PLACE FOR YOUR CURIOSITY</span><h1>Your knowledge library<span>.</span></h1><p>Two collections. Millions of connections.<br />Download once and explore right here, on your device.</p></div>
    <div className="library-grid">{(['nfcorpus', 'msmarco'] as const).map((corpus, index) => {
      const data = COLLECTIONS[corpus]; const Icon = data.icon; const state = resources.resources[corpus];
      return <article className="library-card" key={corpus}><button className="library-card-art" aria-label={`Use ${data.name}`} onClick={() => onSelect(corpus)}><Icon size={56} strokeWidth={0.8} /><span className="art-cross art-cross-one">+</span><span className="art-cross art-cross-two">+</span><span className="art-index">COLLECTION / 0{index + 1}<ArrowUpRight size={11} /></span></button><div className="library-card-content"><span className="eyebrow">{data.label}</span><h2>{data.name}</h2><p>{data.description}</p><div className="library-stats"><span><FileText size={13} />{data.count}</span><span><HardDrive size={13} />{data.size}</span></div><div className="library-state"><StatusDot ready={state.phase === 'ready'} busy={isResourceBusy(state)} />{stateLabel(state)}</div>
        {state.phase === 'error' && <p className="inline-warning" role="status">{state.message}</p>}
        {state.progress !== undefined && <progress aria-label={`${data.name} download progress`} value={state.progress} max={100} />}
        <div className="library-card-actions">{state.phase === 'ready' ? <button className="primary-button" onClick={() => onSelect(corpus)}>Start exploring<ArrowRight size={15} /></button> : <CollectionAction runtime={runtime} corpus={corpus} />}{selected === corpus && <span className="selected-label"><Check size={12} />Selected</span>}</div></div></article>;
    })}</div>
    <button className="library-model" onClick={onModel}><span className="model-art-icon"><Sparkles size={21} /></span><span><strong>Go from finding to understanding.</strong><span>Add the local answer model for conversational answers with citations.</span></span><ArrowUpRight size={19} /></button>
    <div className="library-privacy"><ShieldCheck size={17} /><p>Your indexes, model, and conversations stay in this browser.<br />No account, server, or subscription required.</p></div>
  </div>;
}

function Modal({ title, eyebrow, children, onClose, className = '' }: { title: string; eyebrow: string; children: ReactNode; onClose(): void; className?: string }) {
  const root = useRef<HTMLDialogElement>(null); const heading = useId();
  useEffect(() => {
    const dialog = root.current; dialog?.showModal();
    return () => { dialog?.close(); };
  }, []);
  const { contextSafe } = useGSAP(() => {
    const media = gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)', () => { gsap.from('.sheet', { x: 36, autoAlpha: 0, duration: 0.35, ease: 'power3.out' }); }, root);
    return () => media.revert();
  }, { scope: root });
  const close = contextSafe(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { onClose(); return; }
    gsap.to(root.current?.querySelector('.sheet') ?? [], { x: 20, autoAlpha: 0, duration: 0.18, ease: 'power2.in', onComplete: onClose });
  });
  return <dialog className={`panel-dialog ${className}`} ref={root} aria-labelledby={heading} onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }}><section className="sheet"><header className="sheet-header"><div><span className="eyebrow">{eyebrow}</span><h2 id={heading}>{title}</h2></div><button className="icon-button sheet-close" aria-label="Close panel" onClick={close}><X size={19} /></button></header>{children}</section></dialog>;
}

function SetupPanel({ runtime, tab, onTab, onChoose, onClose }: { runtime: AppRuntime; tab: SetupTab; onTab(tab: SetupTab): void; onChoose(corpus: Corpus): void; onClose(): void }) {
  const resources = useStore(runtime.states.state); const model = resources.resources.model;
  return <Modal title="Make yourself at home." eyebrow="WORKSPACE SETUP" onClose={onClose}><div className="setup-tabs" role="tablist" aria-label="Setup sections">{([['collections', Database, 'Collections'], ['model', Sparkles, 'Answer model'], ['storage', HardDrive, 'Storage']] as const).map(([name, Icon, label]) => <button key={name} role="tab" aria-selected={tab === name} tabIndex={tab === name ? 0 : -1} onClick={() => onTab(name)} onKeyDown={event => {
    const names = ['collections', 'model', 'storage'] as const;
    const index = names.indexOf(name);
    const next = event.key === 'ArrowRight' ? names[(index + 1) % names.length] : event.key === 'ArrowLeft' ? names[(index + names.length - 1) % names.length] : event.key === 'Home' ? names[0] : event.key === 'End' ? names[2] : undefined;
    if (next) { event.preventDefault(); onTab(next); document.getElementById(`setup-tab-${next}`)?.focus(); }
  }} id={`setup-tab-${name}`} aria-controls={`setup-panel-${name}`}><Icon size={14} />{label}</button>)}</div>
    <div className="sheet-content" role="tabpanel" id={`setup-panel-${tab}`} aria-labelledby={`setup-tab-${tab}`} tabIndex={0}>
      {tab === 'collections' && <><p className="panel-intro">Start small or explore the whole web. Each collection is indexed and searched locally.</p>{(['nfcorpus', 'msmarco'] as const).map(corpus => <SetupCollection key={corpus} runtime={runtime} corpus={corpus} onSelect={() => { onChoose(corpus); onClose(); }} />)}<div className="panel-info"><ShieldCheck size={17} /><p>Downloads are saved in this browser. Use the same browser and address to find them next time.</p></div></>}
      {tab === 'model' && <><div className="model-hero"><span className="model-hero-icon"><Sparkles size={30} strokeWidth={1.2} /></span><span className="eyebrow">MEET YOUR LOCAL THINKING PARTNER</span><h3>Answers with a paper trail.</h3><p>Turn retrieved documents into clear, conversational answers. Every response is grounded in sources you can inspect.</p></div>
        <div className="model-spec"><Cpu size={18} /><div><strong>MiniCPM5 · 2B</strong><span>Runs on your GPU · ~1.84 GB download</span></div><span className="subtle-tag">LOCAL</span></div>
        <div className="model-status" role="status"><StatusDot ready={runtime.model.ready} busy={model.phase === 'loading' || model.phase === 'checking'} /><span>{model.message}</span></div>
        {model.model?.stage === 'downloading' && <div className="model-downloaded">{formatBytes(model.model.downloadedBytes)} downloaded</div>}
        {model.phase === 'loading' ? <><progress aria-label="Loading answer model" /><button className="secondary-button full-width" onClick={() => runtime.model.cancelLoad()}>Cancel {model.model?.stage === 'downloading' ? 'download' : 'loading'}</button></> : runtime.model.ready ? <div className="model-ready-note"><Check size={16} />You’re ready for grounded conversations.</div> : <button className="primary-button full-width" disabled={['unsupported', 'checking'].includes(model.phase) || resources.shuttingDown} onClick={() => void runtime.loadModel()}><ArrowDownToLine size={16} />{runtime.model.loadAction()}</button>}
        <div className="panel-info"><CircleHelp size={17} /><p>{model.phase === 'unsupported' ? 'You can still search both collections and read all retrieved sources. AI answers need a browser and GPU with WebGPU and shader-f16 support.' : 'The model is optional. Keyword search works without it. A supported WebGPU browser and enough free storage are required.'}</p></div>
      </>}
      {tab === 'storage' && <StoragePanel runtime={runtime} />}
    </div>
  </Modal>;
}

function SetupCollection({ runtime, corpus, onSelect }: { runtime: AppRuntime; corpus: Corpus; onSelect(): void }) {
  const state = useStore(runtime.states.state, snapshot => snapshot.resources[corpus]);
  const selected = useStore(runtime.conversations.state, snapshot => snapshot.selected === corpus);
  const collection = COLLECTIONS[corpus]; const Icon = collection.icon;
  return <article className="setup-collection"><div className="setup-collection-title"><span className="setup-collection-icon"><Icon size={22} strokeWidth={1.4} /></span><div><h3>{collection.name}</h3><span>{collection.count} · {collection.size}</span></div></div><p>{collection.description}</p><div className="collection-state-line"><StatusDot ready={state.phase === 'ready'} busy={isResourceBusy(state)} />{stateLabel(state)}</div>
    {['error', 'unsupported'].includes(state.phase) && <p className="inline-warning" role="status">{state.message}</p>}
    {isResourceBusy(state) && <><p className="resource-detail" role="status">{state.message}</p><progress aria-label={`${collection.name} progress`} value={state.progress} max={100} /></>}
    <div className="setup-collection-actions"><CollectionAction runtime={runtime} corpus={corpus} /><button className="text-button" aria-label={`Use ${collection.name}`} aria-pressed={selected} onClick={onSelect}>{selected ? <Check size={13} /> : <ArrowRight size={13} />}{selected ? 'Selected' : 'Use for chat'}</button></div>
  </article>;
}

function StoragePanel({ runtime }: { runtime: AppRuntime }) {
  const [estimate, setEstimate] = useState<StorageEstimate | null>(null);
  const [retained, setRetained] = useState<boolean | null>(null);
  const [confirmAction, setConfirmAction] = useState<string | null>(null);
  const [message, setMessage] = useState(''); const [working, setWorking] = useState(false);
  const resources = useStore(runtime.states.state); const snapshot = useStore(runtime.conversations.state);
  useEffect(() => {
    let active = true;
    void navigator.storage?.estimate?.().then(value => { if (active) setEstimate(value); }).catch(() => {});
    void navigator.storage?.persisted?.().then(value => { if (active) setRetained(value); }).catch(() => {});
    return () => { active = false; };
  }, [message]);
  const disabled = working || resources.busy || !!snapshot.activeOperation || Object.values(resources.resources).some(isResourceBusy);
  async function remove(action: string) {
    setWorking(true); setMessage('');
    try {
      const success = action === 'chats' ? await runtime.chat.clear().then(() => true)
        : action === 'model' ? await runtime.clearModel() : await runtime.removeCollection(action as Corpus);
      setMessage(success ? 'Done. Your browser storage has been updated.' : 'This action could not finish. Check the resource status and try again.');
    } catch { setMessage('This action could not finish. Please try again.'); }
    finally { setWorking(false); setConfirmAction(null); }
  }
  return <><p className="panel-intro">Your workspace lives here. Keep what you need, make room when you don’t.</p><div className="storage-summary"><HardDrive size={24} strokeWidth={1.3} /><span className="eyebrow">BROWSER STORAGE</span><strong>{estimate?.usage !== undefined ? formatBytes(estimate.usage) : 'Stored on this device'}</strong><p>{estimate?.quota ? `of ${formatBytes(estimate.quota)} available to this browser` : 'Storage estimates aren’t available in this browser.'}</p>{estimate?.quota && <progress aria-label="Browser storage used" value={estimate.usage ?? 0} max={estimate.quota} />}</div>
    <div className="retention-row"><div><strong>{retained ? 'Storage protection is enabled' : 'Keep your workspace around'}</strong><p>Ask your browser to retain downloaded files.</p></div><button className="secondary-button" disabled={retained === true || working} onClick={() => { void navigator.storage?.persist?.().then(value => { setRetained(value); setMessage(value ? 'Storage protection enabled.' : 'The browser did not grant persistent storage.'); }).catch(() => setMessage('Storage protection is unavailable.')); }}>{retained ? <Check size={14} /> : 'Protect'}</button></div>
    <div className="storage-items">{([['nfcorpus', 'NFCorpus index', 'Rebuild the small index anytime.'], ['msmarco', 'MS MARCO index', 'Remove the saved 3.35 GB download.'], ['model', 'Answer model', 'Remove cached model files.'], ['chats', 'Conversations', `${savedConversations(snapshot).length} saved conversations in this browser.`]] as const).map(([key, label, description]) => <div className="storage-item" key={key}><span><strong>{label}</strong><span>{description}</span></span>{confirmAction === key ? <div className="delete-confirm"><button className="danger-button" disabled={disabled} onClick={() => void remove(key)}>Delete</button><button className="icon-button" aria-label="Cancel deletion" onClick={() => setConfirmAction(null)}><X size={15} /></button></div> : <button className="icon-button delete-button" disabled={disabled} aria-label={`Delete ${label}`} onClick={() => setConfirmAction(key)}><Trash2 size={15} /></button>}</div>)}</div>
    {message && <p className="resource-detail" role="status">{message}</p>}<div className="panel-info"><ShieldCheck size={17} /><p>Deleting an index leaves your saved conversations and source snapshots intact. Browser data is specific to this address and profile.</p></div>
  </>;
}

function SourcePanel({ selection, onClose }: { selection: SourceSelection; onClose(): void }) {
  const { document } = selection;
  return <Modal title="A closer look." eyebrow="RETRIEVED EVIDENCE" onClose={onClose} className="source-dialog"><div className="sheet-content"><div className="source-document-meta"><span><FileText size={13} />{document.id}</span><span>BM25 {document.score.toFixed(4)}</span></div><h3 className="source-document-title">{document.title}</h3><div className="source-document-text">{document.text}</div><div className="panel-info"><BookOpen size={17} /><p>This is the source snapshot saved with this reply. Check the original evidence when interpreting an answer.</p></div></div></Modal>;
}
