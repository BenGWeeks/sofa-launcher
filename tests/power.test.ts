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

import { greeterCommand, lockCommand, switchAccount } from '../src/main/power';

describe('switch account', () => {
  const greeter = (seat: string) => ({ file: 'dbus-send', args: ['--system', '--print-reply', '--dest=org.freedesktop.DisplayManager', seat, 'org.freedesktop.DisplayManager.Seat.SwitchToGreeter'] });
  it('locks this session, then asks for the login screen', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    await switchAccount('c2', '/org/freedesktop/DisplayManager/Seat1', run);
    expect(run.mock.calls).toEqual([[{ file: 'loginctl', args: ['lock-session', 'c2'] }], [greeter('/org/freedesktop/DisplayManager/Seat1')]]);
  });
  it('never shows the login screen over a session it could not lock', async () => {
    const run = vi.fn().mockRejectedValue(new Error('no loginctl'));
    await expect(switchAccount('c2', undefined, run)).rejects.toThrow();
    expect(run).toHaveBeenCalledTimes(1);
    const never = vi.fn();
    await expect(switchAccount('1;reboot', undefined, never)).rejects.toThrow();
    await expect(switchAccount(undefined, undefined, never)).rejects.toThrow();
    expect(never).not.toHaveBeenCalled();
  });
  it.each([undefined, '', '/org/freedesktop/DisplayManager/Seat0 --x', '/evil', '/org/freedesktop/DisplayManager/Seat0/../x'])('uses the first seat for seat path %s', (seat) => {
    expect(greeterCommand(seat)).toEqual(greeter('/org/freedesktop/DisplayManager/Seat0'));
  });
  it('rejects an odd session id', () => {
    expect(lockCommand('-1')).toBeNull();
    expect(lockCommand('3')).toEqual({ file: 'loginctl', args: ['lock-session', '3'] });
  });
});
