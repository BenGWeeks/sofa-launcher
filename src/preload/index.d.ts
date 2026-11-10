import type { SofaApi } from '@shared/types';
import type { ContainersApi } from '@shared/containers';
declare global {
  interface Window {
    sofa: SofaApi;
    sofaContainers: ContainersApi;
  }
}
export {};
