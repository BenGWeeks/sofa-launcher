// Spike S1: is the renderer actually OS-sandboxed on Ubuntu 24.04
// (kernel.apparmor_restrict_unprivileged_userns=1)? Prints a JSON result and exits.
//
// process.sandboxed only reflects Electron's JS-level renderer sandbox
// (webPreferences.sandbox) and is true even with --no-sandbox, so we read
// the OS evidence from /proc for the renderer process:
//   - Seccomp: 2      -> seccomp-bpf filter active (OS sandbox on)
//   - NoNewPrivs: 1   -> set by the sandbox
//   - user namespace differs from the main process -> namespace sandbox in use
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const field = (pid, name) => {
  const m = fs.readFileSync(`/proc/${pid}/status`, 'utf8').match(new RegExp(`^${name}:\\s*(\\S+)`, 'm'));
  return m ? m[1] : null;
};
const userns = (pid) => { try { return fs.readlinkSync(`/proc/${pid}/ns/user`); } catch { return null; } };

const result = { electron: process.versions.electron, argv: process.argv.slice(2) };
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false,
                      preload: path.join(__dirname, 'preload.js') },
  });
  await win.loadURL('data:text/html,<p>s1</p>');
  const rpid = win.webContents.getOSProcessId();
  result.jsSandboxed = await win.webContents.executeJavaScript('window.s1 && window.s1.sandboxed');
  result.renderer = {
    pid: rpid,
    seccomp: field(rpid, 'Seccomp'),
    noNewPrivs: field(rpid, 'NoNewPrivs'),
    ownUserNamespace: userns(rpid) !== userns(process.pid),
  };
  result.osSandboxed = result.renderer.seccomp === '2' && result.renderer.noNewPrivs === '1';
  console.log('S1_RESULT ' + JSON.stringify(result));
  app.quit();
});
