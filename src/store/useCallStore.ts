import { create } from 'zustand';
import type { CallEndReason, CallMedia, CallPeer, CallPhase } from '../types/call';

interface CallState {
  phase: CallPhase;
  callId: string | null;
  peer: CallPeer | null;
  media: CallMedia;
  muted: boolean;
  cameraOff: boolean;
  speakerOn: boolean;
  minimized: boolean;
  /** 通话接通时间（ms） */
  startedAt: number | null;
  endReason: CallEndReason | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;

  beginOutgoing: (peer: CallPeer, callId: string, media: CallMedia) => void;
  beginIncoming: (peer: CallPeer, callId: string, media: CallMedia) => void;
  setPhase: (phase: CallPhase) => void;
  setPeerStreams: (local: MediaStream | null, remote: MediaStream | null) => void;
  setMuted: (muted: boolean) => void;
  setCameraOff: (off: boolean) => void;
  setSpeakerOn: (on: boolean) => void;
  setMinimized: (minimized: boolean) => void;
  markActive: () => void;
  markEnded: (reason: CallEndReason) => void;
  reset: () => void;
}

const initial = {
  phase: 'idle' as CallPhase,
  callId: null as string | null,
  peer: null as CallPeer | null,
  media: 'audio' as CallMedia,
  muted: false,
  cameraOff: false,
  speakerOn: true,
  minimized: false,
  startedAt: null as number | null,
  endReason: null as CallEndReason | null,
  localStream: null as MediaStream | null,
  remoteStream: null as MediaStream | null,
};

export const useCallStore = create<CallState>((set) => ({
  ...initial,
  beginOutgoing: (peer, callId, media) =>
    set({ ...initial, phase: 'outgoing', peer, callId, media }),
  beginIncoming: (peer, callId, media) =>
    set({ ...initial, phase: 'incoming', peer, callId, media }),
  setPhase: (phase) => set({ phase }),
  setPeerStreams: (local, remote) => set({ localStream: local, remoteStream: remote }),
  setMuted: (muted) => set({ muted }),
  setCameraOff: (cameraOff) => set({ cameraOff }),
  setSpeakerOn: (speakerOn) => set({ speakerOn }),
  setMinimized: (minimized) => set({ minimized }),
  markActive: () => set({ phase: 'active', startedAt: Date.now(), endReason: null }),
  markEnded: (reason) => set({ phase: 'ended', endReason: reason }),
  reset: () => set({ ...initial }),
}));
