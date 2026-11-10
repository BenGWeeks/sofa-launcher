import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { hostname } from 'node:os';
import { prepareRemoteProfile } from '../src/main/browser-profile';
const dirs: string[] = [];
function profile() { const dir = mkdtempSync(join(tmpdir(), 'sofa-profile-')); dirs.push(dir); mkdirSync(join(dir, 'Default')); return dir; }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
describe('dedicated browser profile preparation', () => {
  it('removes obsolete Sofa adapters while preserving the active copy and unrelated extensions', () => {
    const dir = profile(), old = join(dir, 'old-adapter'), active = join(dir, 'active-adapter');
    mkdirSync(old); writeFileSync(join(old, 'manifest.json'), JSON.stringify({name:'Sofa remote navigation'}));
    const prefs = { extensions:{ui:{developer_mode:true},settings:{old:{path:old},missing:{path:'/tmp/sofa-remote-old'},active:{path:active},alby:{path:'/tmp/alby-extension'}}} };
    writeFileSync(join(dir,'Default/Preferences'),JSON.stringify(prefs));
    prepareRemoteProfile(dir,active);
    expect(JSON.parse(readFileSync(join(dir,'Default/Preferences'),'utf8')).extensions.settings).toEqual({active:{path:active},alby:{path:'/tmp/alby-extension'}});
  });
  it('never prunes an adapter while its browser profile is running', () => {
    const dir=profile(); const path=join(dir,'Default/Preferences');
    const original=JSON.stringify({extensions:{ui:{developer_mode:true},settings:{old:{path:'/tmp/sofa-remote-old'}}}});
    writeFileSync(path,original);symlinkSync(`${hostname()}-${process.pid}`,join(dir,'SingletonLock'));
    expect(()=>prepareRemoteProfile(dir,'/opt/sofa-launcher/resources/browser-remote')).toThrow('Close this Sofa browser profile');
    expect(readFileSync(path,'utf8')).toBe(original);
  });
  it('preserves unrelated preferences and enables the bundled extension', () => {
    const dir = profile();
    writeFileSync(join(dir, 'Default/Preferences'), JSON.stringify({ unrelated: { keep: true }, extensions: { ui: { other: true } } }));
    prepareRemoteProfile(dir);
    expect(JSON.parse(readFileSync(join(dir, 'Default/Preferences'), 'utf8'))).toEqual({ unrelated: { keep: true }, extensions: { ui: { other: true, developer_mode: true } } });
  });
  it('does not overwrite preferences while Edge holds a lock, including a dangling symlink', () => {
    const dir = profile();
    const path = join(dir, 'Default/Preferences');
    writeFileSync(path, '{}');
    symlinkSync(`${hostname()}-${process.pid}`, join(dir, 'SingletonLock'));
    expect(() => prepareRemoteProfile(dir)).toThrow('Close this Sofa browser profile');
    expect(readFileSync(path, 'utf8')).toBe('{}');
  });
  it('allows Edge to recover its stale lock after a previous process exited', () => {
    const dir = profile();
    symlinkSync(`${hostname()}-2147483647`, join(dir, 'SingletonLock'));
    prepareRemoteProfile(dir);
    expect(JSON.parse(readFileSync(join(dir, 'Default/Preferences'), 'utf8')).extensions.ui.developer_mode).toBe(true);
  });
  it('does not reset malformed preferences', () => {
    const dir = profile();
    const path = join(dir, 'Default/Preferences');
    writeFileSync(path, '{bad');
    expect(() => prepareRemoteProfile(dir)).toThrow();
    expect(readFileSync(path, 'utf8')).toBe('{bad');
  });
});
