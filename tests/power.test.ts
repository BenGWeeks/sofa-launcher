import { describe, expect, it, vi } from 'vitest';
import { logOff, logoutCommand, logoutFallback } from '../src/main/power';

describe('logout command plans', () => {
  it('asks KDE to log out without its own prompt', () => {
    expect(logoutCommand()).toEqual({ file: 'qdbus', args: ['org.kde.ksmserver', '/KSMServer', 'logout', '0', '0', '0'] });
  });
  it.each(['1', 'c12', 'ABC123'])('accepts alphanumeric session %s', (id) => {
    expect(logoutFallback(id)).toEqual({ file: 'loginctl', args: ['terminate-session', id] });
  });
  it.each([undefined, '', '../1', '1;reboot', '-1', 'a b', '1\n'])('rejects invalid session %s', (id) => {
    expect(logoutFallback(id)).toBeNull();
  });
  it('does not fall back when KDE succeeds', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    await logOff('c1', run);
    expect(run.mock.calls).toEqual([[logoutCommand()]]);
  });
  it('falls back only when KDE fails', async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error('no qdbus')).mockResolvedValueOnce(undefined);
    await logOff('c1', run);
    expect(run.mock.calls).toEqual([[logoutCommand()], [logoutFallback('c1')]]);
  });
  it('propagates failure without executing invalid fallback arguments', async () => {
    const run = vi.fn().mockRejectedValue(new Error('failure'));
    await expect(logOff('$(reboot)', run)).rejects.toThrow('failure');
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('reports failure if both commands fail', async () => {
    const run = vi.fn().mockRejectedValue(new Error('failure'));
    await expect(logOff('c1', run)).rejects.toThrow('failure');
    expect(run).toHaveBeenCalledTimes(2);
  });
});
