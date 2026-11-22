// Runs in the page's own world on youtube.com/tv.
// YouTube's TV app calls window.close() when Back is pressed with nowhere left to
// go (after its side guide). In a Sofa window that should show the launcher's home
// screen and leave YouTube running, so the title carries the request instead:
// Sofa reads the window title just after sending Back.
(() => {
  const marker = '[sofa:home]';
  window.close = () => {
    if (document.title.startsWith(marker)) return;
    const title = document.title;
    document.title = `${marker} ${title}`;
    setTimeout(() => { if (document.title.startsWith(marker)) document.title = title; }, 1500);
  };
  // Back in the player. Sofa sends Escape for Back. In its player YouTube's TV app takes Escape
  // as "show the controls", so Back never left a video; the player has no address of its own
  // (it stays #/), and a Backspace made by the page is ignored. Its Back key there is a real
  // Backspace (elsewhere Escape is right: at the side menu only Escape asks to close, which Sofa
  // turns into its home screen). So while the player fills the window, keep the Escape from
  // YouTube and ask Sofa, in the title, to press Backspace instead.
  const backspaceMarker = '[sofa:backspace]';
  const playerShown = () => {
    const v = document.querySelector('video');
    if (!v || v.readyState < 2) return false;
    const r = v.getBoundingClientRect();
    return r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.6 && getComputedStyle(v).visibility !== 'hidden';
  };
  let clear = 0;
  const plain = () => document.title.replace(`${backspaceMarker} `, '');
  const ask = () => {
    clearTimeout(clear);
    const title = plain();
    document.title = `${backspaceMarker} ${title}`;
    clear = setTimeout(() => { if (document.title.startsWith(backspaceMarker)) document.title = title; }, 1500);
  };
  // With its controls hidden, the player takes the first Back as "show the controls" and only the
  // next one leaves. So one Back may need two Backspaces: after Sofa's first, if the player is
  // still there, ask once more (once per Back, so this can never repeat by itself).
  let askedAt = 0;
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && e.isTrusted && askedAt) {
      // Sofa answered: take the request down at once, so a second one is read as new.
      clearTimeout(clear);
      document.title = plain();
      const at = askedAt;
      askedAt = 0;
      if (Date.now() - at < 3000) setTimeout(() => { if (playerShown()) ask(); }, 400);
      return;
    }
    if (e.key !== 'Escape' || !e.isTrusted || !playerShown()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.repeat || document.title.startsWith(backspaceMarker)) return;
    askedAt = Date.now();
    ask();
  }, true);
})();
