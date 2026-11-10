/** Camera views expose metadata and opaque media handles, never HA credentials. */
export interface CameraDefinition { id: string; name: string; entity: string | 'all'; wmClass: string }
export type CameraStorage = 'keyring' | 'file-permissions' | 'none';
export interface CameraViewState {
  name: string;
  connected: boolean;
  storage: CameraStorage;
  audio: { volume: number; muted: boolean };
  cameras: { name: string; entity: string; state: string }[];
  error?: string;
}
export type CameraSource = { kind: 'hls'; source: string } | { kind: 'webrtc'; configuration: RTCConfiguration; dataChannel?: string };
export type CameraRtcSignal = { id: string; type: 'answer'; answer: string } | { id: string; type: 'candidate'; candidate: RTCIceCandidateInit } | { id: string; type: 'error'; message: string };
export interface CameraApi {
  state(): Promise<CameraViewState>;
  connect(token: string): Promise<CameraViewState>;
  snapshot(index: number): Promise<string | null>;
  start(index: number): Promise<CameraSource>;
  rtcOffer(index: number, id: string, offer: string): Promise<void>;
  rtcCandidate(id: string, candidate: RTCIceCandidateInit): Promise<void>;
  rtcStop(id: string): Promise<void>;
  onRtc(callback: (signal: CameraRtcSignal) => void): () => void;
  media(handle: string, range?: { start: number; end: number }): Promise<Uint8Array>;
  onPause(callback: () => void): () => void;
  onResume(callback: () => void): () => void;
  onAudio(callback: (state: { volume: number; muted: boolean }) => void): () => void;
}
declare global { interface Window { sofaCamera: CameraApi } }
