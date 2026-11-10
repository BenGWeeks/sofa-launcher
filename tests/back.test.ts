import { describe, expect, it, vi } from 'vitest';
import { backKeyFor, backToWebApp } from '../src/main/back';

describe('backKeyFor', () => {
  it('uses browser history back for web apps', () => {
    expect(backKeyFor({ type: 'web' })).toBe('alt+Left');
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
    const watchHome = vi.fn(async () => true);
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

  it.each([false, true])('leaves focus alone after navigation or switching apps (home request: %s)', async home => {
    const goHome = vi.fn(async () => {});
    await backToWebApp('ctrl+shift+F8', '7', { sendKeys: async () => true, watchHome: async () => home, activeWindow: async () => '8', goHome });
    expect(goHome).not.toHaveBeenCalled();
  });
});

it('skips title polling entirely when Back was dropped', async () => {
  const watchHome = vi.fn(async () => true);
  const activeWindow = vi.fn(async () => '7');
  const goHome = vi.fn(async () => {});
  await backToWebApp('Escape', '7', { sendKeys: async () => false, watchHome, activeWindow, goHome });
  expect(watchHome).not.toHaveBeenCalled();
  expect(activeWindow).not.toHaveBeenCalled();
  expect(goHome).not.toHaveBeenCalled();
});
