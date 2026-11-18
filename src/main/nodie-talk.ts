/**
 * The Nod.ie talk button. Nod.ie listens for its own hotkey, which Sofa sends to the
 * window in front. That only means something while Nod.ie is running: otherwise the
 * key lands on whatever has the keyboard, and "listening" would be untrue.
 */
export async function talkToNodie(deps: {
  app: { id: string; name: string; hotkeys: { talk?: string } } | undefined;
  isRunning: (id: string) => Promise<boolean>;
  launcherInFront: boolean;
  open: (id: string) => Promise<{ ok: boolean; message?: string }>;
  sendKeys: (key: string) => Promise<boolean>;
  toast: (text: string) => void;
}): Promise<void> {
  const { app } = deps;
  if (!app?.hotkeys.talk) return deps.toast('Nod.ie isn’t set up');
  if (!await deps.isRunning(app.id).catch(() => false)) {
    // From Home, the button is the way in: start Nod.ie. Over a film, leave the film alone.
    if (!deps.launcherInFront) return deps.toast(`${app.name} isn’t running · open it from Home`);
    const result = await deps.open(app.id).catch(() => ({ ok: false as const, message: undefined }));
    if (!result.ok) deps.toast(result.message ?? `${app.name} couldn’t start`);
    return;
  }
  await deps.sendKeys(app.hotkeys.talk).then(
    (sent) => { if (sent) deps.toast('🎤 Nod.ie listening'); }, () => deps.toast('Couldn’t reach Nod.ie'),
  );
}
