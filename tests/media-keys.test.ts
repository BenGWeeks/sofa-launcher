import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DesktopMediaKeys, parseShortcutKeys, TRANSPORT_KEYS } from '../src/main/media-keys';
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir,{recursive:true,force:true})));
function fixture(failKey = '') {
  const dir = mkdtempSync(join(tmpdir(),'sofa-media-keys-')); dirs.push(dir);
  const file = join(dir,'shortcuts.json');
  const values = new Map(TRANSPORT_KEYS.map((key,i) => [key[2],[100+i]]));
  const registered = new Map<string,()=>void>();
  const keys = new DesktopMediaKeys(file, {
    register(key,cb) { if(key===failKey)return false; registered.set(key,cb); return true; },
    unregister(key) {registered.delete(key);},
  }, async (_file,args) => {
    const method = args[args.indexOf('--method')+1]!.split('.').at(-1);
    if(method==='allComponents')return '()';
    const action = JSON.parse(args[args.indexOf('--method')+2]!)[1];
    if(method==='shortcut')return `([${values.get(action as any)}],)`;
    if(method==='setForeignShortcut'){values.set(action,JSON.parse(args.at(-1)!));return '()';}
    return '()';
  });
  return { keys, values, registered, file };
}
describe('foreground transport ownership',()=>{
  it('parses KDE integer lists without accepting arbitrary GVariant text',()=>{
    expect(parseShortcutKeys('([16777344],)')).toEqual([16777344]);
    expect(parseShortcutKeys('(@ai [],)')).toEqual([]);
    expect(()=>parseShortcutKeys('error')).toThrow();
  });
  it('saves exact original bindings before releasing them and restores on shutdown',async()=>{
    const f=fixture(); expect(await f.keys.prepare()).toBe(true);
    expect([...f.values.values()]).toEqual([[],[],[],[]]);
    const saved=JSON.parse(readFileSync(f.file,'utf8'));expect(saved[0].keys).toEqual([100]);
    const received:string[]=[];expect(f.keys.register(command=>received.push(command))).toBe(true);
    f.registered.get('MediaPlayPause')!();expect(received).toEqual(['PlayPause']);
    await f.keys.restore();expect([...f.values.values()]).toEqual([[100],[101],[102],[103]]);
    expect(f.registered.size).toBe(0);
  });
  it('recovers a crash journal without overwriting original shortcuts with empty values',async()=>{
    const f=fixture();await f.keys.prepare();await f.keys.prepare();
    await f.keys.restore();expect([...f.values.values()]).toEqual([[100],[101],[102],[103]]);
  });
  it('preserves a shortcut the user changed while Sofa ran',async()=>{
    const f=fixture();await f.keys.prepare();f.values.set('nextmedia',[999]);
    await f.keys.restore();expect(f.values.get('nextmedia')).toEqual([999]);
  });
  it('rolls back partial key registration and restores the desktop',async()=>{
    const f=fixture('MediaStop');await f.keys.prepare();expect(f.keys.register(()=>{})).toBe(false);
    await f.keys.restore();expect(f.registered.size).toBe(0);
    expect([...f.values.values()]).toEqual([[100],[101],[102],[103]]);
  });
});
