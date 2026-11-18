import { describe, expect, it, vi } from 'vitest';
import { talkToNodie } from '../src/main/nodie-talk';

function fixture(over: Partial<Parameters<typeof talkToNodie>[0]> = {}) {
  const deps = {
    app: { id: 'nodie', name: 'Nodie', hotkeys: { talk: 'ctrl+shift+space' } },
    isRunning: vi.fn(async () => true),
    launcherInFront: true,
    open: vi.fn(async () => ({ ok: true })),
    sendKeys: vi.fn(async () => true),
    toast: vi.fn(),
    ...over,
  };
  return deps;
}

describe('talkToNodie', () => {
  it('sends the talk key and says so while Nod.ie is running', async () => {
    const f = fixture();
    await talkToNodie(f);
    expect(f.sendKeys).toHaveBeenCalledExactlyOnceWith('ctrl+shift+space');
    expect(f.toast).toHaveBeenCalledExactlyOnceWith('🎤 Nod.ie listening');
    expect(f.open).not.toHaveBeenCalled();
  });

  it('never sends the key when Nod.ie is not running: on Home it starts Nod.ie instead', async () => {
    const f = fixture({ isRunning: vi.fn(async () => false) });
    await talkToNodie(f);
    expect(f.sendKeys).not.toHaveBeenCalled();
    expect(f.open).toHaveBeenCalledExactlyOnceWith('nodie');
    expect(f.toast).not.toHaveBeenCalled();
  });

  it('leaves the app in front alone when Nod.ie is not running', async () => {
    const f = fixture({ isRunning: vi.fn(async () => false), launcherInFront: false });
    await talkToNodie(f);
    expect(f.sendKeys).not.toHaveBeenCalled();
    expect(f.open).not.toHaveBeenCalled();
    expect(f.toast).toHaveBeenCalledExactlyOnceWith('Nodie isn’t running · open it from Home');
  });

  it('reports a start that failed', async () => {
    const f = fixture({ isRunning: vi.fn(async () => false), open: vi.fn(async () => ({ ok: false, message: 'Nodie isn’t installed' })) });
    await talkToNodie(f);
    expect(f.toast).toHaveBeenCalledExactlyOnceWith('Nodie isn’t installed');
  });

  it('adds no toast of its own when the start was superseded or already reported', async () => {
    const f = fixture({ isRunning: vi.fn(async () => false), open: vi.fn(async () => ({ ok: false })) });
    await talkToNodie(f);
    expect(f.toast).not.toHaveBeenCalled();
    const thrown = fixture({ isRunning: vi.fn(async () => false), open: vi.fn(async () => { throw new Error('ipc'); }) });
    await talkToNodie(thrown);
    expect(thrown.toast).toHaveBeenCalledExactlyOnceWith('Nodie couldn’t start');
  });

  it('says nothing was heard when the key was dropped, and reports failures', async () => {
    const dropped = fixture({ sendKeys: vi.fn(async () => false) });
    await talkToNodie(dropped);
    expect(dropped.toast).not.toHaveBeenCalled();
    const failed = fixture({ sendKeys: vi.fn(async () => { throw new Error('xdotool'); }) });
    await talkToNodie(failed);
    expect(failed.toast).toHaveBeenCalledExactlyOnceWith('Couldn’t reach Nod.ie');
    const unset = fixture({ app: undefined });
    await talkToNodie(unset);
    expect(unset.toast).toHaveBeenCalledExactlyOnceWith('Nod.ie isn’t set up');
  });
});
