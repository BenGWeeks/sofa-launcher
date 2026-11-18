import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { appsLeftForHome } from '../src/main/home-pause';

describe('appsLeftForHome', () => {
  it('pauses the app that was in front', () => {
    expect(appsLeftForHome({ active: false }, 'youtube')).toEqual(['youtube']);
    expect(appsLeftForHome({ active: false }, null)).toEqual([]);
  });
  it('pauses both apps of a screen-in-screen pair', () => {
    expect(appsLeftForHome({ active: true, baseId: 'netflix', insetId: 'youtube' }, 'youtube')).toEqual(['netflix', 'youtube']);
  });
  it('pauses only the main app under a pinned camera, even when the camera was opened last', () => {
    expect(appsLeftForHome({ active: true, pinned: true, baseId: 'netflix', insetId: 'camera-cot' }, 'netflix')).toEqual(['netflix']);
    expect(appsLeftForHome({ active: true, pinned: true, baseId: 'netflix', insetId: 'camera-cot' }, 'camera-cot')).toEqual(['netflix']);
    expect(appsLeftForHome({ active: true, pinned: true, insetId: 'camera-cot' }, 'camera-cot')).toEqual([]);
  });
  it('never pauses Nod.ie', () => {
    expect(appsLeftForHome({ active: false }, 'nodie')).toEqual([]);
    expect(appsLeftForHome({ active: true, baseId: 'nodie', insetId: 'youtube' }, 'nodie')).toEqual(['youtube']);
  });
});

// Execute the real goHome with ports stubbed, without booting Electron.
function goHomeWith(inFront: boolean, pause?: (id: string) => Promise<void>) {
  const source = ts.createSourceFile('index.ts', readFileSync('src/main/index.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'goHome')!;
  const js = ts.transpileModule(declaration.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const order: string[] = [];
  const ports = {
    pipStartGeneration: 0, guideReturnTo: null,
    launcherInFront: () => inFront,
    appsLeftForHome,
    pip: { state: { active: false } },
    homePauses: new Map<string, object>(),
    apps: { lastAppId: 'youtube', pause: vi.fn(pause ?? (async (id: string) => { order.push(`pause ${id}`); })) },
    showHome: vi.fn(async () => { order.push('home'); }),
    sendAction: vi.fn(),
  };
  const goHome = new Function(...Object.keys(ports), `${js}; return goHome;`)(...Object.values(ports)) as () => Promise<void>;
  return { goHome, ports, order };
}

describe('goHome', () => {
  it('pauses the app being left, after Home is showing', async () => {
    const f = goHomeWith(false);
    await f.goHome();
    expect(f.order).toEqual(['home', 'pause youtube']);
  });
  it('asks again for a pause that a second Home press interrupted', async () => {
    let finish!: () => void;
    const slow = () => new Promise<void>((resolve) => { finish = resolve; });
    const f = goHomeWith(false, slow);
    await f.goHome();                       // leaves YouTube: its pause is still looking for the player
    f.ports.launcherInFront = () => true;   // Home is now in front
    await f.goHome();                       // second press
    expect(f.ports.apps.pause).toHaveBeenCalledTimes(2);
    expect(f.ports.apps.pause).toHaveBeenLastCalledWith('youtube');
    finish(); await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.ports.homePauses.size).toBe(0);
    await f.goHome();                       // nothing unfinished: Home on Home pauses nothing
    expect(f.ports.apps.pause).toHaveBeenCalledTimes(2);
  });
  it('pauses nothing when Home is pressed on Home', async () => {
    const f = goHomeWith(true);
    await f.goHome();
    expect(f.ports.showHome).toHaveBeenCalledOnce();
    expect(f.ports.apps.pause).not.toHaveBeenCalled();
  });
});
