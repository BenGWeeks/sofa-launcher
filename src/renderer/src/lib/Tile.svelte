<script lang="ts">
  import type { TileState } from '@shared/types';
  import nodieImg from '../assets/nodie.jpg';
  import audibleLogo from '../assets/audible.png';
  import fountainLogo from '../assets/fountain.svg';
  import primeLogo from '../assets/prime-video.png';
  import jellyfinLogo from '../assets/jellyfin.svg';
  import jellyseerrLogo from '../assets/jellyseerr.svg';
  import netflixLogo from '../assets/netflix.svg';
  import youtubeLogo from '../assets/youtube.svg';
  import homeAssistantLogo from '../assets/home-assistant.png';
  import tidalLogo from '../assets/tidal.svg';
  import disneyLogo from '../assets/disney-plus.svg';
  import iplayerLogo from '../assets/bbc-iplayer.svg';
  import spotifyLogo from '../assets/spotify.svg';
  import browserLogo from '../assets/browser.svg';
  import edgeLogo from '../assets/microsoft-edge.svg';
  import dockerLogo from '../assets/containers/docker.svg';

  let { app, index = 99, focused = false, onclick, bare = false, art }: {
    app: TileState; index?: number; focused?: boolean; onclick?: () => void;
    /** Artwork only (no number, status dot, label or button), for use inside another control. */
    bare?: boolean;
    /** A game's artwork (data URL), shown whole over a blurred copy of itself. */
    art?: string;
  } = $props();
  /** Games without artwork get a quiet gradient in a colour of their own. */
  const hue = $derived([...app.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7));

  const images: Record<string, string> = { nodie: nodieImg };
  const image = $derived(app.image ? images[app.image] : undefined);
  /** Each service's own wordmark (see assets/ATTRIBUTION.md), shown on a tile in its colours. */
  const wordmarks: Record<string, string> = {
    jellyfin: jellyfinLogo, jellyseerr: jellyseerrLogo, netflix: netflixLogo, prime: primeLogo, youtube: youtubeLogo,
    homeassistant: homeAssistantLogo, tidal: tidalLogo, disney: disneyLogo, iplayer: iplayerLogo, spotify: spotifyLogo,
  };
  /** Symbols (not wordmarks): shown beside the app's name, like Audible and Fountain. */
  const symbols: Record<string, string> = { audible: audibleLogo, fountain: fountainLogo, edge: edgeLogo, browser: browserLogo, docker: dockerLogo };
  const symbol = $derived(app.brand ? symbols[app.brand] : undefined);
  const wordmark = $derived(app.brand ? wordmarks[app.brand] : undefined);
</script>

<svelte:element this={bare ? 'span' : 'button'} class="slot" class:bare class:focused class:missing={!app.installed} {onclick} tabindex={bare ? undefined : -1} aria-hidden={bare ? 'true' : undefined}>
  <div class="tile brand-{app.brand ?? 'generic'}" style:--hue={app.brand === 'game' ? hue : undefined}>
    {#if !bare}
      {#if index < 9}<span class="n">{index + 1}</span>{/if}
      {#if app.status}<span class="dot health-{app.status}" title="Containers: {app.status}"></span>
      {:else}<span class="dot" class:on={app.running} title={app.running ? 'Running' : 'Not running'}></span>{/if}
    {/if}
    {#if image}
      <img class="photo" src={image} alt="" />
    {:else if app.group === 'games' && art}
      <img class="art-backdrop" src={art} alt="" /><img class="art" src={art} alt={app.name} />
    {:else if symbol}
      <span class="service-logo"><img src={symbol} alt="" /><span>{app.name}</span></span>
    {:else if app.type === 'camera'}
      <svg class="camera" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h12v11H3zM15 10l6-3v11l-6-3z" /></svg>
    {:else if wordmark}
      <img class="wordmark" src={wordmark} alt={app.name} />
    {:else if app.group === 'games'}
      <span class="game-name">{app.name}</span>
    {:else}
      {app.name}
    {/if}
  </div>
  {#if !bare}<div class="label">{app.name}{#if !app.installed}<small>&nbsp;· {app.type === 'containers' ? 'not set up' : 'not installed'}</small>{/if}</div>{/if}
</svelte:element>

<style>
  /* --ts scales the whole tile (the panel uses small tiles). */
  .slot { --ts: 1; }
  .slot { all: unset; display: block; width: 100%; }
  .tile {
    position: relative; aspect-ratio: 16 / 10; border-radius: calc(1.2rem * var(--ts));
    display: flex; align-items: center; justify-content: center; overflow: hidden;
    font-weight: 800; font-size: calc(2rem * var(--ts)); letter-spacing: -0.02em;
    box-shadow: 0 calc(0.6rem * var(--ts)) calc(1.6rem * var(--ts)) rgba(0, 0, 0, 0.45);
    transition: transform 150ms ease, box-shadow 150ms ease;
  }
  .focused .tile {
    transform: scale(1.12);
    box-shadow: 0 0 0 calc(0.35rem * var(--ts)) var(--focus-ring), 0 0 calc(3rem * var(--ts)) var(--accent-glow), 0 calc(1.2rem * var(--ts)) calc(2.4rem * var(--ts)) rgba(0, 0, 0, 0.6);
  }
  /* Camera layout only (--inner-ring: block): the ring sits inside the tile, painted above photo
     children so their image cannot cover it. Elsewhere the outer box-shadow ring is the only one. */
  .focused .tile::after { content:''; display:var(--inner-ring, none); position:absolute; inset:0; border:calc(.35rem * var(--ts)) solid var(--focus-ring); border-radius:inherit; z-index:2; pointer-events:none; }
  .bare .tile { box-shadow: none; }
  .wordmark { width:72%; height:55%; object-fit:contain; }
  .missing:not(.focused) .tile { filter: grayscale(0.8) brightness(0.6); }
  .n { position: absolute; left: calc(0.7rem * var(--ts)); top: calc(0.5rem * var(--ts)); font-size: calc(0.95rem * var(--ts)); font-weight: 600; opacity: 0.8; z-index: 1; }
  .dot { position: absolute; right: calc(0.8rem * var(--ts)); top: calc(0.8rem * var(--ts)); width: calc(0.8rem * var(--ts)); height: calc(0.8rem * var(--ts)); border-radius: 50%; background: #6b7280; z-index: 1; }
  .dot.on { background: var(--ok); box-shadow: 0 0 calc(0.6rem * var(--ts)) var(--ok); }
  .photo { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: 50% 22%; }
  .label { margin-top: calc(0.9rem * var(--ts)); font-size: calc(1.3rem * var(--ts)); color: #aeb7c7; text-align: center; transition: color 150ms; }
  .label small { color: var(--muted); font-size: calc(1rem * var(--ts)); }
  .focused .label { color: #fff; font-weight: 600; }

  .brand-generic { background: linear-gradient(135deg, #2b3445, #1a2030); font-size: calc(1.6rem * var(--ts)); }
  .brand-jellyfin { background: #000b25; }
  .brand-jellyseerr { background: #111827; }
  .brand-netflix { background: #141414; }
  .brand-prime { background: linear-gradient(135deg, #0f79af, #00a8e1); font-weight: 700; font-size: calc(1.8rem * var(--ts)); }
  .brand-youtube { background: #fff; color: #0f0f0f; }
  .brand-homeassistant { background: #111318; }
  .brand-homeassistant .wordmark { width: 82%; }
  .brand-disney { background: linear-gradient(135deg, #0b1a5c, #1a3fa8); }
  /* The published marks are dark artwork: show them in white on their dark tiles. */
  .brand-disney .wordmark { filter: brightness(0) invert(1); }
  .brand-iplayer { background: #000; }
  .brand-spotify { background: #121212; }
  .brand-tidal { background: #000; }
  .brand-tidal .wordmark { filter: invert(1); }
  .brand-camera { background:#142c39; color:#8cdef1; }
  .brand-game { background:linear-gradient(135deg, hsl(var(--hue) 32% 26%), hsl(var(--hue) 38% 12%)); }
  .brand-roblox { background:#fff; color:#121215; }
  .game-name { padding:0 8%; text-align:center; line-height:1.15; font-size:calc(1.6rem * var(--ts)); display:-webkit-box; -webkit-line-clamp:3; line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
  .brand-roblox .game-name { font-size:calc(2.2rem * var(--ts)); font-weight:900; letter-spacing:.02em; text-transform:uppercase; }
  /* Steam headers are wider than a tile: show the whole image, over a blurred, dimmed copy. */
  .art-backdrop { position:absolute; inset:-10%; width:120%; height:120%; object-fit:cover; filter:blur(calc(1.2rem * var(--ts))) brightness(.55); }
  .art { position:relative; width:100%; height:100%; object-fit:contain; }
  .camera { width:4rem; height:4rem; fill:none; stroke:currentColor; stroke-width:1.5; stroke-linejoin:round; }
  .service-logo { display:flex; align-items:center; justify-content:center; gap:calc(.65rem * var(--ts)); width:88%; }
  .service-logo img { width:calc(3.4rem * var(--ts)); height:calc(3.4rem * var(--ts)); object-fit:contain; flex-shrink:0; }
  .brand-audible { background: #fff; color: #18130a; font-size: calc(1.8rem * var(--ts)); }
  .brand-fountain { background: #242035; color: #fff; font-size: calc(1.8rem * var(--ts)); }
  .brand-docker { background: #0c1a33; color: #fff; font-size: calc(1.8rem * var(--ts)); }
  /* Docker tile: the worst container status (a bigger dot, red / amber / green). */
  .dot[class*='health-'] { width: calc(1.1rem * var(--ts)); height: calc(1.1rem * var(--ts)); box-shadow: 0 0 0 calc(0.18rem * var(--ts)) rgba(0, 0, 0, 0.55); }
  .health-red { background: #ff5c5c; } .health-amber { background: #ffb020; } .health-green { background: #3ddc84; }
  .brand-browser, .brand-edge { background: #0f1a2b; color: #fff; font-size: calc(1.45rem * var(--ts)); line-height: 1.1; }
</style>
