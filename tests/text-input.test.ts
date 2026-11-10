import { afterEach, describe, expect, it, vi } from 'vitest';

const input = vi.hoisted(() => ({ end: vi.fn(), on: vi.fn() }));
vi.mock('node:child_process', () => ({
  execFile: vi.fn((_file, _args, _options, callback) => {
    queueMicrotask(() => callback(null));
    return { stdin: input };
  }),
}));
import { execFile } from 'node:child_process';
import { transcribe, typeText } from '../src/main/text-input';

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('TV text input', () => {
  it('passes literal text on stdin rather than exposing it in process arguments', async () => {
    const text = 'secret $(echo unsafe) @ sign';
    await typeText(text);
    expect(execFile).toHaveBeenCalledWith('xdotool', ['type', '--clearmodifiers', '--delay', '5', '--file', '-'], { timeout: 15000 }, expect.any(Function));
    expect(input.end).toHaveBeenCalledWith(text);
  });
  it.each(['\x00', 'x'.repeat(2001), 42])('rejects invalid input before spawning a process', async (text) => {
    await expect(typeText(text)).rejects.toThrow('Invalid text');
    expect(execFile).not.toHaveBeenCalled();
  });
  it('sends recordings only to the local speech endpoint and returns text for review', async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ text: ' A film title ' }) }));
    vi.stubGlobal('fetch', fetch);
    expect(await transcribe(new Uint8Array(120))).toBe('A film title');
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:8100/v1/audio/transcriptions', expect.objectContaining({ method: 'POST', body: expect.any(FormData) }));
  });
  it('rejects oversized audio without sending it', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(transcribe(new Uint8Array(5 * 1024 * 1024 + 1))).rejects.toThrow('Invalid recording');
    expect(fetch).not.toHaveBeenCalled();
  });
});
