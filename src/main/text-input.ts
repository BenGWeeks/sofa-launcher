import { execFile } from 'node:child_process';

/** Send literal text over stdin, keeping passwords out of process arguments. */
export function typeText(text: unknown): Promise<void> {
  if (typeof text !== 'string' || text.length > 2000 || /[\x00-\x08\x0b-\x1f\x7f]/.test(text)) {
    return Promise.reject(new Error('Invalid text (maximum 2000 characters)'));
  }
  return new Promise((resolve, reject) => {
    const child = execFile('xdotool', ['type', '--clearmodifiers', '--delay', '5', '--file', '-'], { timeout: 15000 },
      (error) => error ? reject(new Error('Could not type into the app')) : resolve());
    child.stdin?.on('error', () => {});
    child.stdin?.end(text);
  });
}

/** Uses the local Whisper speech recognition service. */
export async function transcribe(audio: unknown): Promise<string> {
  if (!(audio instanceof Uint8Array) || audio.byteLength < 100 || audio.byteLength > 5 * 1024 * 1024) {
    throw new Error('Invalid recording (maximum 5 MB)');
  }
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audio)]), 'speech.webm');
  form.append('model', 'Systran/faster-whisper-tiny.en');
  form.append('language', 'en');
  const result = await fetch('http://127.0.0.1:8100/v1/audio/transcriptions', {
    method: 'POST', body: form, signal: AbortSignal.timeout(30000),
  });
  if (!result.ok) throw new Error('Local speech recognition is unavailable');
  const data = await result.json() as { text?: unknown };
  if (typeof data.text !== 'string' || data.text.length > 2000) throw new Error('Invalid transcription');
  return data.text.trim();
}
