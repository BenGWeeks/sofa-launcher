export const BROWSER_IDS = ['edge', 'chrome', 'chromium', 'brave', 'vivaldi'] as const;
export type BrowserId = typeof BROWSER_IDS[number];
export type BrowserChoice = 'default' | BrowserId;
export const BROWSER_NAMES: Record<BrowserId, string> = {
  edge: 'Microsoft Edge', chrome: 'Google Chrome', chromium: 'Chromium', brave: 'Brave', vivaldi: 'Vivaldi',
};
export interface InstalledBrowser { id: BrowserId; binary: string }
export interface BrowserState {
  choice: BrowserChoice;
  installed: BrowserId[];
  defaultBrowser: BrowserId | null;
}
