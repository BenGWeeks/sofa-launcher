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
})();
