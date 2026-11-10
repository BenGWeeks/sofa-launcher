import type { WebContents } from 'electron';

/**
 * Screenshot mode (--demo-screen=containers), after the capture: drive the real view with the
 * remote's keys and check focus stays visible, details open and close, and Back leaves.
 */
export async function verifyContainersView(contents: WebContents): Promise<void> {
  const js = <T>(code: string) => contents.executeJavaScript(code) as Promise<T>;
  const press = async (key: string, times = 1) => {
    for (let i = 0; i < times; i++) {
      await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, cancelable: true }))`);
      await new Promise((r) => setTimeout(r, 40));
    }
    await new Promise((r) => setTimeout(r, 300)); // smooth scrolling
  };
  /** The focused card and its ring lie inside the scrolling grid. */
  const focusVisible = () => js<boolean>(`(() => {
    const card = document.querySelector('.card.focused'); const grid = document.querySelector('.grid');
    if (!card || !grid) return false;
    const c = card.getBoundingClientRect(), g = grid.getBoundingClientRect(), ring = 6;
    return c.top - ring >= g.top && c.bottom + ring <= g.bottom && c.left - ring >= g.left && c.right + ring <= g.right;
  })()`);
  const count = await js<number>(`document.querySelectorAll('.card').length`);
  const [visible, screens] = await js<[number, number]>(`(() => { const g = document.querySelector('.grid').getBoundingClientRect();
    const seen = [...document.querySelectorAll('.card')].filter((c) => { const r = c.getBoundingClientRect(); return r.top >= g.top && r.bottom <= g.bottom; }).length;
    const grid = document.querySelector('.grid'); return [seen, Math.round(grid.scrollHeight / grid.clientHeight * 10) / 10]; })()`);
  if (count < 50) throw new Error(`Containers view must show the demo containers (saw ${count})`);
  if (!await js<boolean>(`document.querySelector('.card.focused')?.classList.contains('red')`)) throw new Error('Problems must come first');
  await press('ArrowDown', 40);
  await press('ArrowRight', 10);
  if (!await js<boolean>(`document.querySelector('.card.focused') === [...document.querySelectorAll('.card')].at(-1)`)) throw new Error('Arrows must reach the last container');
  if (!await focusVisible()) throw new Error('The focused card must scroll fully into view');
  if (!await js<boolean>(`document.querySelector('.grid').scrollTop > 0`)) throw new Error('The grid must scroll');
  await press('ArrowUp', 40);
  if (!await focusVisible()) throw new Error('The focused card must stay visible scrolling back up');
  await press('Enter');
  if (!await js<boolean>(`!!document.querySelector('.detail')`)) throw new Error('OK must open the details');
  await press('Escape');
  if (await js<boolean>(`!!document.querySelector('.detail')`) || !await js<boolean>(`!!document.querySelector('.view')`)) throw new Error('Back must close the details first');
  await press('Escape');
  if (await js<boolean>(`!!document.querySelector('.view')`)) throw new Error('Back must leave the containers view');
  console.log(`Containers view verified: ${count} cards (${visible} fully visible at once, ${screens} screens tall), focus visible while scrolling, details, Back`);
}
