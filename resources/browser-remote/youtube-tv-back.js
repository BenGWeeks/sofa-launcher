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
  // Back while a video plays. Sofa sends Escape for Back, and YouTube's TV app (which Sofa
  // presents as a Tizen TV) takes Escape in its player as "show the controls", so Back never
  // left a video. The player has its own address (#/watch?v=…): step back in YouTube's own
  // history instead, to the page the video was opened from. Elsewhere Escape is untouched.
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !e.isTrusted || !location.hash.startsWith('#/watch')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!e.repeat) history.back();
  }, true);
})();
