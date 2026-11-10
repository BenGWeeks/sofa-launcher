import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import Panel from './lib/Panel.svelte';
import Toasts from './lib/Toasts.svelte';
import CameraView from './lib/CameraView.svelte';
import { followAppearanceState } from './lib/appearance';
import { parseRoute } from './lib/route';

const { route, demo } = parseRoute(location.hash);
if (route === 'home' || route === 'panel') followAppearanceState(window.sofa, ({ theme, background }) => {
  document.documentElement.dataset.theme = theme;
  // Only the home screen paints a background; the panel window is transparent.
  if (route === 'home') document.documentElement.dataset.background = background;
});
const target = document.getElementById('app')!;
let cursorTimer: ReturnType<typeof setTimeout>;
document.addEventListener('mousemove', () => {
  document.documentElement.classList.add('mouse-active');
  clearTimeout(cursorTimer);
  cursorTimer = setTimeout(() => document.documentElement.classList.remove('mouse-active'), 3000);
});
document.addEventListener('keydown', () => {
  clearTimeout(cursorTimer);
  document.documentElement.classList.remove('mouse-active');
});
if (route === 'panel' || route === 'toast') document.documentElement.classList.add('transparent');

export default route === 'camera' ? mount(CameraView, {target}) : route === 'panel'
  ? mount(Panel, { target, props: { demo } })
  : route === 'toast'
    ? mount(Toasts, { target })
    : mount(App, { target, props: { demo } });
