/** Home-screen backgrounds, in menu order. The first one is the default. */
export const BACKGROUNDS = [
  { id: 'midnight', label: 'Midnight' },
  { id: 'corner-glow', label: 'Corner glow' },
  { id: 'horizon-glow', label: 'Horizon glow' },
  { id: 'brand-wash', label: 'Green and orange wash' },
  { id: 'dot-grid', label: 'Dot grid' },
  { id: 'near-black', label: 'Near black' },
  { id: 'horizon', label: 'Horizon line' },
  { id: 'ribbons', label: 'Glow ribbons' },
  { id: 'smoke-left', label: 'Smoke, left' },
  { id: 'smoke-right', label: 'Smoke, right' },
  { id: 'nebula', label: 'Nebula' },
  { id: 'planet', label: 'Planet edge' },
  { id: 'pavement-lights', label: 'Light-up pavement' },
  { id: 'glove-and-hat', label: 'Glove and hat' },
  { id: 'toe-stand', label: 'Toe stand' },
  { id: 'moonlit-night', label: 'Moonlit night' },
  { id: 'stage-lean', label: 'Stage lean' },
  { id: 'moonwalk', label: 'Moonwalk' },
] as const satisfies readonly { id: string; label: string }[];

export type Background = (typeof BACKGROUNDS)[number]['id'];
export const DEFAULT_BACKGROUND: Background = 'midnight';
export const BACKGROUND_IDS = BACKGROUNDS.map((b) => b.id) as [Background, ...Background[]];
