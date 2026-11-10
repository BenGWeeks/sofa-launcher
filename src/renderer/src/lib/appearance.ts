import type { AppearanceState, SofaApi, Theme } from '@shared/types';

type AppearanceApi = Pick<SofaApi, 'appearance' | 'onAppearance'>;

/** Shared by home, panel and toast; a live reload takes precedence over an older initial reply. */
export function followAppearanceState(api: AppearanceApi, apply: (state: AppearanceState) => void): () => void {
  let updated = false;
  let disposed = false;
  const off = api.onAppearance((state) => {
    updated = true;
    if (!disposed) apply(state);
  });
  void api.appearance().then((state) => {
    if (!updated && !disposed) apply(state);
  });
  return () => { disposed = true; off(); };
}

export function followAppearance(api: AppearanceApi, apply: (theme: Theme) => void): () => void {
  return followAppearanceState(api, (state) => apply(state.theme));
}
