import { describe, expect, it, vi } from 'vitest';
import { canSwitchCommand, greeterCommand, lockCommand, lockedCommand, logOff, logoutCommand, logoutFallback, switchAccount, unlockCommand, type PowerCommand } from '../src/main/power';

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

describe('switch account', () => {
  const SEAT = '/org/freedesktop/DisplayManager/Seat0';
  /** A desktop that answers each command; `answers` overrides by the command's distinguishing argument. */
  function desktop(answers: Record<string, string | Error | (() => string)> = {}) {
    const calls: PowerCommand[] = [];
    const run = vi.fn(async (command: PowerCommand) => {
      calls.push(command);
      const key = command.args.find((a) => a in answers) ?? '';
      const answer = answers[key] ?? (command.args.includes('string:CanSwitch') ? '   variant       boolean true\n' : command.args.includes('LockedHint') ? 'yes\n' : '');
      if (answer instanceof Error) throw answer;
      return typeof answer === 'function' ? answer() : answer;
    });
    return { calls, deps: { run, wait: async () => undefined, lockTimeoutMs: 1000 } };
  }

  it('checks it can, locks, waits for the lock, then asks for the login screen', async () => {
    let asked = 0;
    const d = desktop({ LockedHint: () => (++asked < 3 ? 'no\n' : 'yes\n') });
    await switchAccount('c2', SEAT, d.deps);
    expect(d.calls).toEqual([canSwitchCommand(SEAT), lockCommand('c2'), lockedCommand('c2'), lockedCommand('c2'), lockedCommand('c2'), greeterCommand(SEAT)]);
  });

  it('does nothing when the computer cannot switch accounts', async () => {
    const no = desktop({ 'string:CanSwitch': '   variant       boolean false\n' });
    await expect(switchAccount('c2', SEAT, no.deps)).rejects.toThrow('cannot switch');
    expect(no.calls).toHaveLength(1);
    const missing = desktop({ 'string:CanSwitch': new Error('no display manager') });
    await expect(switchAccount('c2', SEAT, missing.deps)).rejects.toThrow();
    expect(missing.calls).toHaveLength(1);
  });

  it('never shows the login screen over a session that did not lock', async () => {
    const asked = desktop({ LockedHint: 'no\n' });
    await expect(switchAccount('c2', SEAT, asked.deps)).rejects.toThrow('did not lock');
    expect(asked.calls).not.toContainEqual(greeterCommand(SEAT));
    const failed = desktop({ 'lock-session': new Error('no loginctl') });
    await expect(switchAccount('c2', SEAT, failed.deps)).rejects.toThrow();
    expect(failed.calls).not.toContainEqual(greeterCommand(SEAT));
    const never = desktop();
    await expect(switchAccount('1;reboot', SEAT, never.deps)).rejects.toThrow();
    await expect(switchAccount(undefined, SEAT, never.deps)).rejects.toThrow();
    expect(never.calls).toEqual([]);
  });

  it('unlocks again when the login screen does not come', async () => {
    const d = desktop({ 'org.freedesktop.DisplayManager.Seat.SwitchToGreeter': new Error('timeout') });
    await expect(switchAccount('c2', SEAT, d.deps)).rejects.toThrow('timeout');
    expect(d.calls.at(-1)).toEqual(unlockCommand('c2'));
  });

  it.each([undefined, '', '/org/freedesktop/DisplayManager/Seat0 --x', '/evil', '/org/freedesktop/DisplayManager/Seat0/../x'])('uses the first seat for seat path %s', (seat) => {
    expect(greeterCommand(seat).args).toContain(SEAT);
    expect(greeterCommand('/org/freedesktop/DisplayManager/Seat1').args).toContain('/org/freedesktop/DisplayManager/Seat1');
  });

  it('rejects an odd session id', () => {
    expect(lockCommand('-1')).toBeNull();
    expect(lockCommand('3')).toEqual({ file: 'loginctl', args: ['lock-session', '3'] });
  });
});
