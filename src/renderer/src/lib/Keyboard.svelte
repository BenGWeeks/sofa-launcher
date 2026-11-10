<script lang="ts">
  import { onDestroy } from 'svelte';
  import { BACK_KEYS } from './nav';
  import { keyboardRows, moveKeyboardFocus, type KeyboardPage } from './keyboard-layout';

  let page = $state<KeyboardPage>('letters');
  let text = $state('');
  let focus = $state(0);
  let shift = $state(false);
  let recording = $state(false);
  let busy = $state(false);
  let status = $state('Select a field in the app first. Input opens this keyboard.');
  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const rows = $derived(keyboardRows(page, shift));
  const keys = $derived(rows.flat());
  const indexFor = (row: number, column: number) => rows.slice(0, row).reduce((sum, keys) => sum + keys.length, 0) + column;

  function releaseMic() {
    clearTimeout(timer);
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    recording = false;
    void window.sofa.keyboardMic(false);
  }

  async function microphone() {
    if (recording) { recorder?.stop(); releaseMic(); return; }
    if (busy) return;
    busy = true;
    status = 'Opening microphone…';
    try {
      await window.sofa.keyboardMic(true);
      const capture = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      if (disposed) { capture.getTracks().forEach((track) => track.stop()); return; }
      stream = capture;
      const chunks: Blob[] = [];
      recorder = new MediaRecorder(capture, { mimeType: 'audio/webm' });
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = async () => {
        releaseMic();
        if (disposed) return;
        busy = true;
        status = 'Transcribing locally…';
        try {
          const audio = new Uint8Array(await new Blob(chunks, { type: 'audio/webm' }).arrayBuffer());
          const result = await window.sofa.keyboardTranscribe(audio);
          if (disposed) return;
          text = (text ? text + ' ' : '') + result;
          text = text.slice(0, 2000);
          status = result ? 'Review the words, then choose Type text.' : 'No speech detected. Try again.';
        } catch { if (!disposed) status = 'Speech unavailable. You can still use the keys below.'; }
        finally { busy = false; }
      };
      recorder.start();
      recording = true;
      status = 'Listening… choose Mic again to stop (maximum 15 seconds).';
      timer = setTimeout(() => { if (recorder?.state === 'recording') recorder.stop(); }, 15000);
    } catch {
      releaseMic();
      status = 'Microphone unavailable. You can still use the keys below.';
    } finally { busy = false; }
  }

  async function choose(index: number) {
    const key = keys[index];
    if (!key) return;
    if (key === 'Cancel') { void window.sofa.panelDismiss(); return; }
    if (key === 'Mic') { await microphone(); return; }
    if (busy || recording) return;
    switch (key) {
      case 'ABC': page = 'letters'; focus = 0; break;
      case '#+=': page = 'symbols'; focus = 0; break;
      case 'Shift': shift = !shift; break;
      case 'Space': text = (text + ' ').slice(0, 2000); break;
      case 'Delete': text = [...text].slice(0, -1).join(''); break;
      case 'Clear': text = ''; break;
      case 'Type text':
        busy = true;
        try { await window.sofa.keyboardType(text); }
        catch { status = 'Could not type into the app. Select the field and try again.'; }
        finally { busy = false; }
        break;
      default: text = (text + key).slice(0, 2000);
    }
  }

  function onkeydown(event: KeyboardEvent) {
    if (BACK_KEYS.has(event.key)) { event.preventDefault(); void window.sofa.panelDismiss(); return; }
    if (event.key.startsWith('Arrow')) focus = moveKeyboardFocus(rows, focus, event.key);
    else if (event.key === 'Enter' && !event.repeat) void choose(focus);
    else return;
    event.preventDefault();
  }

  onDestroy(() => {
    disposed = true;
    if (recorder?.state === 'recording') recorder.stop();
    releaseMic();
  });
</script>

<svelte:window {onkeydown} />
<div class="keyboard">
  <div class="heading"><strong>Keyboard / microphone</strong><span>Arrows select · OK chooses · Back cancels</span></div>
  <div class="text" aria-label="Text to type">{text || 'Enter text…'}<span class="caret">▏</span></div>
  <div class="keys">
    {#each rows as row, rowIndex}
      <div class="key-row" class:letter-middle={page === 'letters' && rowIndex === 2}>
      {#each row as key, column}
        {@const index = indexFor(rowIndex, column)}
        <button class:space={key === 'Space'} class:action={['Shift', 'Delete', 'ABC', '#+=', 'Mic', 'Type text', 'Cancel'].includes(key)} class:focused={index === focus} class:recording={key === 'Mic' && recording} onclick={() => { focus = index; void choose(index); }}>{key === 'Space' ? 'space' : key === 'Delete' ? '⌫' : key === 'Shift' ? (shift ? '⇧ ON' : '⇧') : key === 'Mic' && recording ? '■ Stop mic' : key}</button>
      {/each}
      </div>
    {/each}
  </div>
  <p role="status">{status}</p>
</div>

<style>
  .keyboard { display:flex; flex-direction:column; gap:0.65rem; margin-top:auto; padding-bottom:0.4rem; }
  .heading { display:flex; justify-content:space-between; align-items:center; font-size:1.2rem; }
  .heading span { color:var(--muted); font-size:1rem; }
  .text { background:#131b26; padding:0.6rem 1rem; border-radius:0.5rem; min-height:2.6rem; font-size:1.3rem; white-space:pre-wrap; overflow:auto; max-height:4rem; overflow-wrap:anywhere; }
  .caret { color:var(--accent); }
  .keys { display:flex; flex-direction:column; gap:0.5rem; }
  .key-row { display:flex; gap:0.4rem; justify-content:center; }
  .letter-middle { padding:0 5%; }
  button { flex:1; background:#e1e4e9; color:#151a22; border:0; border-radius:0.6rem; padding:0.65rem 0.2rem; min-height:2.6rem; font-size:1.3rem; }
  button.action { background:#374254; color:#fff; font-size:1.1rem; }
  button.space { flex:3; }
  button.focused { background:var(--accent); color:var(--accent-contrast); outline:0.15rem solid var(--focus-ring); }
  button.recording { box-shadow:0 0 0 0.2rem #f66 inset; }
  p { margin:0; color:var(--muted); font-size:1rem; }
</style>
