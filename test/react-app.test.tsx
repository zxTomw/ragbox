// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App.tsx';
import type { AppRuntime } from '../src/app-runtime.ts';
import { ChatController } from '../src/chat-controller.ts';
import { ConversationStore } from '../src/conversations.ts';
import { ResourceStates } from '../src/resource-state.ts';
import type { ControllerState, ModelService } from '../src/model-service.ts';
import type { Corpus, ModelStatus, RetrievalResult, SearchResult } from '../src/types.ts';
import { memoryRepository } from './conversation-fixtures.ts';

// Animation behavior is checked in a real browser. Here animations must not hide
// interactive elements while the actual React/controller integration is exercised.
vi.mock('@gsap/react', () => ({
  useGSAP: Object.assign(() => ({ contextSafe: <T,>(callback: T): T => callback }), { register: () => {} }),
}));

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', { writable: true, value: vi.fn(query => ({
    matches: false, media: query, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  })) });
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  Element.prototype.scrollIntoView = vi.fn();
  window.scrollTo = vi.fn();
});
afterEach(cleanup);

const evidence: SearchResult[] = [{
  id: 'MED-1', title: 'Coffee and cardiovascular health',
  text: 'The saved first source reports that coffee intake was associated with lower cardiovascular mortality.', score: 4.2,
}];
const secondEvidence: SearchResult[] = [{
  id: 'MED-2', title: 'Tea and cholesterol',
  text: 'The second source describes a reduction in LDL cholesterol following green tea consumption.', score: 3.1,
}];

class FakeModel {
  state: ControllerState = 'ready';
  model: ModelStatus = { cache: 'installed', stage: 'ready', downloadedBytes: 0 };
  repairNeeded = false;
  private listeners = new Set<() => void>();
  get ready() { return this.state === 'ready' || this.state === 'generating'; }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  setState(state: ControllerState) {
    this.state = state;
    this.model = state === 'idle'
      ? { cache: 'missing', stage: 'idle', downloadedBytes: 0 }
      : { cache: 'installed', stage: 'ready', downloadedBytes: 0 };
    for (const listener of this.listeners) listener();
  }
  loadAction() { return 'Download model (~1.84 GB)'; }
  recoverModel = vi.fn(async () => { this.setState('ready'); });
  cancelLoad = vi.fn(() => false);
  refreshCache = vi.fn(async () => {});
  resolveQuery = vi.fn(async (question: string) => ({ query: question, contextLimited: false }));
  generateAnswer = vi.fn(async (options: Parameters<ModelService['generateAnswer']>[0], _signal: AbortSignal) => {
    const id = options.documents[0].id;
    options.onContext?.([id], false);
    const answer = `The evidence supports this finding [${id}].`;
    options.onDelta?.(answer);
    return { answer, documentIds: [id] };
  });
}

async function harness(options: { modelReady?: boolean; nfReady?: boolean; repository?: ReturnType<typeof memoryRepository> } = {}) {
  const repository = options.repository ?? memoryRepository();
  const conversations = new ConversationStore(repository);
  await conversations.initialize();
  const states = new ResourceStates();
  states.set('nfcorpus', options.nfReady === false ? 'missing' : 'ready', options.nfReady === false ? 'Prepare NFCorpus to begin.' : 'NFCorpus ready');
  states.set('msmarco', 'ready', 'MS MARCO ready');
  const model = new FakeModel();
  if (options.modelReady === false) model.setState('idle');
  const syncModel = () => states.set('model', model.state, model.ready ? 'Model ready' : 'Model not installed', model.model);
  syncModel();
  model.subscribe(syncModel);
  const retrieve = vi.fn(async (_corpus: Corpus, _query: string): Promise<RetrievalResult> => ({ documents: evidence, elapsedMs: 12 }));
  const chat = new ChatController(conversations, model, {
    ready: corpus => states.get(corpus).phase === 'ready', busy: () => states.busy,
    subscribe: listener => states.watch(state => [state.busy, state.resources.nfcorpus.phase, state.resources.msmarco.phase], listener, false),
    retrieve,
  });
  const prepareNFCorpus = vi.fn(async () => { states.set('nfcorpus', 'ready', 'NFCorpus ready'); });
  const runtime: AppRuntime = {
    conversations, states, model: model as unknown as ModelService, chat,
    prepareNFCorpus,
    downloadMSMarco: vi.fn(async () => {}),
    openMSMarco: vi.fn(async () => {}),
    cancelDownload: vi.fn(),
    loadModel: model.recoverModel,
    clearModel: vi.fn(async () => true),
    removeCollection: vi.fn(async (_corpus: Corpus) => true),
    initialize: vi.fn(async () => {}),
    dispose: vi.fn(async () => { chat.dispose(); await conversations.flush(); }),
  };
  const user = userEvent.setup();
  render(<App runtime={runtime} />);
  return { repository, conversations, states, model, chat, retrieve, prepareNFCorpus, runtime, user };
}

async function ask(user: ReturnType<typeof userEvent.setup>, question: string) {
  await user.type(screen.getByRole('textbox', { name: 'Message' }), question);
  await user.click(screen.getByRole('button', { name: 'Send message' }));
}

describe('React chat workspace', () => {
  it('switches collections and prepares the selected small collection before chatting', async () => {
    const h = await harness({ nfReady: false });
    await h.user.click(screen.getByRole('button', { name: 'Use MS MARCO' }));
    expect(h.conversations.selected).toBe('msmarco');
    await ask(h.user, 'how does insulin work');
    await waitFor(() => expect(h.conversations.current().turns[0]?.phase).toBe('complete'));
    expect(h.retrieve).toHaveBeenLastCalledWith('msmarco', 'how does insulin work', expect.any(Object));
    await h.user.click(screen.getByRole('button', { name: /^Collections/ }));
    await h.user.click(screen.getByRole('button', { name: 'Use NFCorpus' }));
    expect(h.conversations.selected).toBe('nfcorpus');
    await h.user.click(screen.getByRole('button', { name: 'Workspace setup' }));
    await h.user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Prepare NFCorpus/i }));
    await waitFor(() => expect(h.prepareNFCorpus).toHaveBeenCalledOnce());
    expect(h.states.get('nfcorpus').phase).toBe('ready');
    h.chat.dispose();
  });

  it('keeps keyword matches and subsequent searches usable without installing the answer model', async () => {
    const h = await harness({ modelReady: false });
    await ask(h.user, 'coffee');
    await waitFor(() => expect(h.conversations.current().turns[0]?.phase).toBe('blocked'));
    expect(screen.getByRole('button', { name: /^1 source/ })).toBeTruthy();
    expect(h.model.generateAnswer).not.toHaveBeenCalled();
    await ask(h.user, 'tea');
    await waitFor(() => expect(h.conversations.current().turns).toHaveLength(2));
    expect(h.retrieve).toHaveBeenLastCalledWith('nfcorpus', 'tea', expect.any(Object));
    expect(h.model.generateAnswer).not.toHaveBeenCalled();
    h.chat.dispose();
  });

  it('opens the evidence snapshot cited by an earlier answer after a later retrieval', async () => {
    const h = await harness();
    await ask(h.user, 'coffee');
    await screen.findByRole('button', { name: 'View source MED-1' });
    h.retrieve.mockResolvedValueOnce({ documents: secondEvidence, elapsedMs: 7 });
    await ask(h.user, 'tea');
    await screen.findByRole('button', { name: 'View source MED-2' });
    await h.user.click(screen.getByRole('button', { name: 'View source MED-1' }));
    expect(within(screen.getByRole('dialog')).getByText(evidence[0].text)).toBeTruthy();
    expect(h.conversations.current().turns[0].results[0].id).toBe('MED-1');
    expect(h.conversations.current().turns[1].results[0].id).toBe('MED-2');
    h.chat.dispose();
  });

  it('supports multiline composition, Enter submission, Stop and Retry without duplicating the turn', async () => {
    const h = await harness();
    h.model.generateAnswer.mockImplementationOnce(async (options, signal) => {
      options.onContext?.(['MED-1'], false);
      options.onDelta?.('A partial supported answer [MED-1].');
      return new Promise<{ answer: string; documentIds: string[] }>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
      });
    });
    const composer = screen.getByRole('textbox', { name: 'Message' });
    await h.user.type(composer, 'coffee{shift>}{enter}{/shift}health');
    expect(h.retrieve).not.toHaveBeenCalled();
    expect((composer as HTMLTextAreaElement).value).toBe('coffee\nhealth');
    await h.user.keyboard('{Enter}');
    const stop = await screen.findByRole('button', { name: 'Stop response' });
    await h.user.click(stop);
    await waitFor(() => expect(h.conversations.current().turns[0].phase).toBe('stopped'));
    expect(screen.getByText(/A partial supported answer/)).toBeTruthy();
    await h.user.click(screen.getByRole('button', { name: /Retry/ }));
    await waitFor(() => expect(h.conversations.current().turns[0].phase).toBe('complete'));
    expect(h.conversations.current().turns).toHaveLength(1);
    expect(h.model.generateAnswer).toHaveBeenCalledTimes(2);
    h.chat.dispose();
  });

  it.each([
    ['Answer model', 'model'],
    ['NFCorpus index', 'nfcorpus'],
  ] as const)('reports an unsuccessful deletion of %s without claiming storage was updated', async (label, target) => {
    const h = await harness();
    if (target === 'model') vi.mocked(h.runtime.clearModel).mockResolvedValueOnce(false);
    else vi.mocked(h.runtime.removeCollection).mockResolvedValueOnce(false);
    await h.user.click(screen.getByRole('button', { name: 'Workspace setup' }));
    const dialog = within(screen.getByRole('dialog'));
    await h.user.click(dialog.getByRole('tab', { name: 'Storage' }));
    await h.user.click(dialog.getByRole('button', { name: `Delete ${label}` }));
    await h.user.click(dialog.getByRole('button', { name: 'Delete' }));
    expect(await dialog.findByText(/could not|unable/i)).toBeTruthy();
    expect(dialog.queryByText(/^Deleted\./)).toBeNull();
    if (target === 'model') expect(h.runtime.clearModel).toHaveBeenCalledOnce();
    else expect(h.runtime.removeCollection).toHaveBeenCalledWith('nfcorpus');
    h.chat.dispose();
  });

  it('navigates saved conversations and restores their cited sources after a reload', async () => {
    const h = await harness();
    await ask(h.user, 'Coffee and heart health');
    await screen.findByRole('button', { name: 'View source MED-1' });
    const firstId = h.conversations.current().id;
    await h.user.click(screen.getByRole('button', { name: /^New conversation/ }));
    await ask(h.user, 'Tea and cholesterol');
    await waitFor(() => expect(h.conversations.current().turns[0].phase).toBe('complete'));
    await h.user.click(screen.getByRole('button', { name: 'Coffee and heart health' }));
    expect(h.conversations.current().id).toBe(firstId);
    await act(async () => { await h.conversations.flush(); });
    expect(h.repository.saved.get(firstId)?.turns[0].results[0].text).toBe(evidence[0].text);
    h.chat.dispose();
    cleanup();
    const restored = await harness({ repository: h.repository });
    expect(restored.conversations.current().id).toBe(firstId);
    await restored.user.click(screen.getByRole('button', { name: 'View source MED-1' }));
    expect(within(screen.getByRole('dialog')).getByText(evidence[0].text)).toBeTruthy();
    restored.chat.dispose();
  });
});
