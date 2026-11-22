import { describe, expect, it } from 'vitest';
import { FILTER_FOR_BUTTON, matchesFilter, type ContainerColour } from '../src/shared/containers';

const card = (colour: ContainerColour, available = false) => ({ colour, update: { available } as never });

describe('container filters', () => {
  it('maps the remote colours: red problems, green running, yellow not running, blue updates', () => {
    expect(FILTER_FOR_BUTTON).toEqual({ cameraToggle: 'problems', cameraNext: 'running', cameraCorner: 'notRunning', blue: 'updates' });
  });

  it('filters by status colour', () => {
    expect(matchesFilter(card('red'), 'problems')).toBe(true);
    expect(matchesFilter(card('green'), 'running')).toBe(true);
    expect(matchesFilter(card('green'), 'problems')).toBe(false);
  });

  it('counts amber (not ready) and grey (stopped) as not running', () => {
    expect(matchesFilter(card('amber'), 'notRunning')).toBe(true);
    expect(matchesFilter(card('grey'), 'notRunning')).toBe(true);
    expect(matchesFilter(card('red'), 'notRunning')).toBe(false);
  });

  it('shows any colour with an update available', () => {
    expect(matchesFilter(card('green', true), 'updates')).toBe(true);
    expect(matchesFilter(card('red', true), 'updates')).toBe(true);
    expect(matchesFilter(card('green'), 'updates')).toBe(false);
    expect(matchesFilter({ colour: 'green', update: null }, 'updates')).toBe(false);
  });
});
