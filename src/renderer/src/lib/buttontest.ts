/** Pure rules for leaving the button test, so a mis-mapped remote can't trap anyone. */

/** Seconds without a key press before the test closes itself. */
export const IDLE_EXIT_SECONDS = 20;

/** Buttons that exit when pressed twice in a row. */
export const EXIT_BUTTONS = new Set(['back', 'home']);

export interface ExitPresses {
  id: string | null;
  count: number;
}

/** Fold a recognised button press into the "same exit button twice in a row" counter. */
export function nextExitPresses(prev: ExitPresses, buttonId: string | null): ExitPresses {
  if (!buttonId || !EXIT_BUTTONS.has(buttonId)) return { id: null, count: 0 };
  return { id: buttonId, count: prev.id === buttonId ? prev.count + 1 : 1 };
}

export const shouldExit = (p: ExitPresses): boolean => p.count >= 2;
