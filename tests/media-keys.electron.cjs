// Real X11/KDE claim -> physical-key emulation -> exact restoration on a development PC.
// DISPLAY=:0 electron tests/media-keys.electron.cjs (run without --no-sandbox if supported)
const {app,globalShortcut} = require('electron');
const {readFileSync,mkdtempSync,rmSync} = require('node:fs');
const {join} = require('node:path');
const {tmpdir} = require('node:os');
const {execFileSync} = require('node:child_process');
const Module = require('node:module');
const ts = require('typescript');
const assert = require('node:assert/strict');
const dir=mkdtempSync(join(tmpdir(),'sofa-media-x11-'));
app.setPath('userData',join(dir,'profile'));
const mod=new Module(join(__dirname,'../src/main/media-keys.ts'),module);
mod.filename=join(__dirname,'../src/main/media-keys.ts');mod.paths=module.paths;
mod._compile(ts.transpileModule(readFileSync(mod.filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,mod.filename);
const {DesktopMediaKeys}=mod.exports;
app.whenReady().then(async()=>{
 const keys=new DesktopMediaKeys(join(dir,'original.json'),{register:(key,cb)=>globalShortcut.register(key,cb),unregister:key=>globalShortcut.unregister(key)});
 let result=1;
 try {
  assert.equal(await keys.prepare(),true);
  const originals=JSON.parse(readFileSync(join(dir,'original.json'),'utf8'));
  const received=[];assert.equal(keys.register(command=>received.push(command)),true);
  await new Promise(r=>setTimeout(r,200));
  for(const [key,command] of [['XF86AudioPlay','PlayPause'],['XF86AudioStop','Stop'],['XF86AudioNext','Next'],['XF86AudioPrev','Previous']]){
   execFileSync('xdotool',['key','--clearmodifiers',key]);await new Promise(r=>setTimeout(r,150));assert.equal(received.at(-1),command);
  }
  await keys.restore();
  for(const entry of originals){
   const after=execFileSync('gdbus',['call','--session','--dest','org.kde.kglobalaccel','--object-path','/kglobalaccel','--method','org.kde.KGlobalAccel.shortcut',JSON.stringify(entry.action)],{encoding:'utf8'});
   assert.deepEqual(mod.exports.parseShortcutKeys(after),entry.keys);
  }
  console.log('Real X11 transport keys claimed, dispatched once each, and exact KDE bindings restored.');result=0;
 }catch(error){console.error(error);}finally{await keys.restore().catch(console.error);globalShortcut.unregisterAll();rmSync(dir,{recursive:true,force:true});app.exit(result);}
});
