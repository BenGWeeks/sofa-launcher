import { describe, expect, it, vi } from 'vitest';
import { backKeyFor, backToWebApp } from '../src/main/back';

describe('backKeyFor', () => {
  it('uses browser history back for web apps', () => {
    expect(backKeyFor({ type: 'web' })).toBe('alt+Left');
  });

  it('uses Escape for a browser game, never history back', () => {
    expect(backKeyFor({ type: 'web', group: 'games', url: 'https://games.example/invaders/' })).toBe('Escape');
  });

  it('uses Escape for desktop apps', () => {
    expect(backKeyFor({ type: 'desktop' })).toBe('Escape');
  });

  it('uses Escape when the app is unknown', () => {
    expect(backKeyFor(undefined)).toBe('Escape');
  });

  it('asks streaming apps to activate their own back control, including in a player', () => {
    expect(backKeyFor({ type: 'web', remoteNavigation: true, url: 'https://www.netflix.com/watch/123' })).toBe('ctrl+shift+F8');
    expect(backKeyFor({ type: 'web', remoteNavigation: true, url: 'https://tidal.com/' })).toBe('ctrl+shift+F8');
    expect(backKeyFor({ type: 'web', remoteNavigation: true, url: 'https://custom.example/' })).toBe('alt+Left');
    expect(backKeyFor({ type: 'web', url: 'https://www.youtube.com/tv' })).toBe('Escape');
  });
});


describe('web Back to home', () => {
  it('waits for delivery before polling and focuses Sofa when the first page requests home', async () => {
    let release!: (sent: boolean) => void;
    const sendKeys = vi.fn(() => new Promise<boolean>(resolve => { release = resolve; }));
    const watchHome = vi.fn(async () => 'home' as const);
    const goHome = vi.fn(async () => {});
    const pending = backToWebApp('Escape', '7', { sendKeys, watchHome, activeWindow: async () => '7', goHome });
    expect(watchHome).not.toHaveBeenCalled();
    expect(goHome).not.toHaveBeenCalled();
    release(true);
    await pending;
    expect(sendKeys).toHaveBeenCalledWith('Escape');
    expect(watchHome).toHaveBeenCalledWith('7');
    expect(goHome).toHaveBeenCalledOnce();
  });

  it.each([null, 'home'] as const)('leaves focus alone after navigation or switching apps (request: %s)', async home => {
    const goHome = vi.fn(async () => {});
    await backToWebApp('ctrl+shift+F8', '7', { sendKeys: async () => true, watchHome: async () => home, activeWindow: async () => '8', goHome });
    expect(goHome).not.toHaveBeenCalled();
  });
});

it('skips title polling entirely when Back was dropped', async () => {
  const watchHome = vi.fn(async () => 'home' as const);
  const activeWindow = vi.fn(async () => '7');
  const goHome = vi.fn(async () => {});
  await backToWebApp('Escape', '7', { sendKeys: async () => false, watchHome, activeWindow, goHome });
  expect(watchHome).not.toHaveBeenCalled();
  expect(activeWindow).not.toHaveBeenCalled();
  expect(goHome).not.toHaveBeenCalled();
});

it('answers YouTube’s request for a real Backspace (its player ignores Escape and page-made keys)', async () => {
  const sendKeys = vi.fn(async () => true);
  const goHome = vi.fn(async () => {});
  // The page asks again (controls were hidden), then stops: two Backspaces, never more.
  await backToWebApp('Escape', '7', { sendKeys, watchHome: async () => 'backspace', activeWindow: async () => '7', goHome });
  expect(sendKeys.mock.calls).toEqual([['Escape'], ['BackSpace'], ['BackSpace']]);
  const once = vi.fn(async () => true);
  const answers = ['backspace', null] as const;
  await backToWebApp('Escape', '7', { sendKeys: once, watchHome: async () => answers[once.mock.calls.length - 1] ?? null, activeWindow: async () => '7', goHome });
  expect(once.mock.calls).toEqual([['Escape'], ['BackSpace']]);
  expect(goHome).not.toHaveBeenCalled();
  // Not to another window that has come to the front meanwhile.
  const other = vi.fn(async () => true);
  await backToWebApp('Escape', '7', { sendKeys: other, watchHome: async () => 'backspace', activeWindow: async () => '8', goHome });
  expect(other.mock.calls).toEqual([['Escape']]);
});
