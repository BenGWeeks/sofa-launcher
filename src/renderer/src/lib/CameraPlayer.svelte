<script lang="ts">
  import { onMount } from 'svelte';
  import Hls from 'hls.js';
  import { CameraPreview } from './camera-preview';
  import { cameraLoader } from './camera-loader';
  import type { CameraSource } from '@shared/camera-types';
  let { index, name, cameraState, volume = 100, muted = true, onretry }: { index: number; name: string; cameraState: string; volume?: number; muted?: boolean; onretry: () => void } = $props();
  let video: HTMLVideoElement;
  let hls: Hls | null = null;
  let peer: RTCPeerConnection | null = null;
  let rtcId: string | null = null;
  let offRtc: (() => void) | null = null;
  let rtcTimer: ReturnType<typeof setTimeout>;
  function stopRtc() {
    clearTimeout(rtcTimer); offRtc?.(); offRtc = null; peer?.close(); peer = null;
    if (rtcId) void window.sofaCamera.rtcStop(rtcId).catch(() => undefined);
    rtcId = null;
    if (video) video.srcObject = null;
  }
  async function startRtc(source: Extract<CameraSource, {kind:'webrtc'}>, current: number) {
    const id = crypto.randomUUID(); rtcId = id;
    const connection = new RTCPeerConnection(source.configuration); peer = connection;
    const remoteCandidates: RTCIceCandidateInit[] = [];
    const localCandidates: RTCIceCandidateInit[] = [];
    let offered = false;
    let stopped = false;
    const fail = () => { if (!stopped && alive && current === generation) { stopped = true; status = 'Camera live stream unavailable'; failed = true; stopRtc(); } };
    rtcTimer = setTimeout(fail, 30_000);
    offRtc = window.sofaCamera.onRtc(signal => {
      if (signal.id !== id || !alive || stopped || rtcId !== id || current !== generation) return;
      void (async () => {
        if (signal.type === 'error') { fail(); return; }
        if (signal.type === 'answer') {
          await connection.setRemoteDescription({ type: 'answer', sdp: signal.answer });
          for (const candidate of remoteCandidates.splice(0)) await connection.addIceCandidate(candidate);
        } else if (!connection.remoteDescription) {
          if (remoteCandidates.length >= 128) { fail(); return; }
          remoteCandidates.push(signal.candidate);
        }
        else await connection.addIceCandidate(signal.candidate);
      })().catch(fail);
    });
    connection.onicecandidate = event => {
      if (!event.candidate || stopped || rtcId !== id || !alive || current !== generation) return;
      const candidate = event.candidate.toJSON();
      if (offered) void window.sofaCamera.rtcCandidate(id, candidate).catch(fail);
      else if (localCandidates.length < 128) localCandidates.push(candidate);
      else fail();
    };
    connection.onconnectionstatechange = () => {
      if (stopped || rtcId !== id || !alive || current !== generation) return;
      if (connection.connectionState === 'failed') fail();
    };
    connection.ontrack = event => {
      if (!alive || stopped || rtcId !== id || current !== generation) return;
      let stream = event.streams[0] ?? (video.srcObject instanceof MediaStream ? video.srcObject : new MediaStream());
      if (!stream.getTracks().includes(event.track)) stream.addTrack(event.track);
      video.srcObject = stream;
      void video.play().catch(fail);
    };
    if (source.dataChannel) connection.createDataChannel(source.dataChannel);
    connection.addTransceiver('video', { direction: 'recvonly' });
    connection.addTransceiver('audio', { direction: 'recvonly' });
    const offer = await connection.createOffer(); await connection.setLocalDescription(offer);
    if (!alive || stopped || rtcId !== id || current !== generation) { connection.close(); return; }
    await window.sofaCamera.rtcOffer(index, id, connection.localDescription!.sdp);
    if (stopped || rtcId !== id || current !== generation) return;
    offered = true;
    for (const candidate of localCandidates.splice(0)) {
      if (stopped || rtcId !== id || current !== generation) break;
      await window.sofaCamera.rtcCandidate(id, candidate);
    }
  }
  let snapshot = $state<string | null>(null);
  let live = $state(false);
  const preview = new CameraPreview((image, ready) => { if (!ready) snapshot = image; live = ready; });
  let frameCallback: number | undefined;
  function firstFrame() {
    if (!alive || paused || !(peer || hls) || video.readyState < 2 || video.paused) return;
    preview.frame(); status = ''; failed = false; clearTimeout(rtcTimer);
  }
  let status = $state('Connecting…');
  let failed = $state(false);
  let paused = false;
  let alive = true;
  let generation = 0;
  async function start() {
    const current = ++generation;
    hls?.destroy(); hls = null; stopRtc();
    if (frameCallback !== undefined) video.cancelVideoFrameCallback(frameCallback);
    failed = false; paused = false;
    preview.start(() => window.sofaCamera.snapshot(index));
    frameCallback = video.requestVideoFrameCallback(() => { if (alive && current === generation) firstFrame(); });
    if (cameraState === 'unavailable' || cameraState === 'unknown') { status = 'Camera offline'; failed = true; return; }
    status = 'Connecting…';
    try {
      const source = await window.sofaCamera.start(index);
      if (!alive || current !== generation) return;
      if (source.kind === 'webrtc') { await startRtc(source, current); return; }
      if (!Hls.isSupported()) { status = 'Live video is not supported on this device'; failed = true; return; }
      hls = new Hls({ loader: cameraLoader(window.sofaCamera), enableWorker: false, lowLatencyMode: true, backBufferLength: 10, maxBufferLength: 15 });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) { status = 'Live stream unavailable'; failed = true; hls?.destroy(); hls = null; }
      });
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        void video.play().catch(() => { status = 'Press play to watch'; failed = true; });
      });
      hls.attachMedia(video);
      hls.loadSource(source.source);
    } catch { if (alive && current === generation && !failed) { status = 'Camera could not start'; failed = true; stopRtc(); } }
  }
  onMount(() => {
    void start();
    const off = window.sofaCamera.onPause(() => { generation++; preview.stop(); paused = true; hls?.destroy(); hls = null; stopRtc(); video.pause(); status = 'Camera paused'; failed = true; });
    const resume = () => { if (paused) void start(); };
    window.addEventListener('focus', resume);
    return () => { alive = false; generation++; preview.stop(); if (frameCallback !== undefined) video.cancelVideoFrameCallback(frameCallback); off(); window.removeEventListener('focus', resume); hls?.destroy(); stopRtc(); };
  });
</script>
<section class="camera-player" aria-label={name}>
  <video bind:this={video} autoplay {muted} volume={volume / 100} playsinline controls tabindex="0" aria-label={name} onplaying={firstFrame}></video>
  {#if snapshot}<img class="snapshot" class:live src={snapshot} alt="" ontransitionend={(event) => { if (live && event.propertyName === 'opacity') snapshot = null; }} />{/if}
  <span class="name">{name}</span>
  {#if status}<div class="status" class:with-snapshot={!!snapshot}><p>{status}</p>{#if failed}<button onclick={onretry}>Try again</button>{/if}</div>{/if}
</section>
<style>
  .camera-player { position:relative; background:#050608; min-height:0; overflow:hidden; border-radius:.5rem; }
  video { display:block; width:100%; height:100%; object-fit:contain; }
  .snapshot { position:absolute; inset:0; width:100%; height:100%; object-fit:contain; opacity:1; transition:opacity 250ms ease; pointer-events:none; }
  .snapshot.live { opacity:0; }
  .status.with-snapshot { background:transparent; justify-content:flex-end; text-shadow:0 1px 4px #000; }
  .name { position:absolute; top:.6rem; left:.7rem; padding:.3rem .6rem; border-radius:.4rem; background:#10141cce; font-size:1rem; pointer-events:none; }
  .status { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; background:#0b101b; color:#e5eaf3; text-align:center; padding:1rem; }
  p { margin:0 0 .8rem; }
  button { background:#f7931a; border:0; border-radius:.5rem; padding:.6rem 1rem; color:#101010; font:inherit; }
  video:focus-visible { outline:.2rem solid #9dff0a; outline-offset:-.25rem; }
  button:focus-visible { outline:.2rem solid white; outline-offset:.2rem; }
</style>
