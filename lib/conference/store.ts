import { create } from "zustand";
import type { Conference, Participant, ConferenceConfig, ConferenceAction } from "./types";
import { conferenceEngine } from "./engine";

interface ConferenceStore {
  /** Currently active conference */
  activeConference: Conference | null;
  /** Conference history */
  history: Conference[];
  /** Loading state */
  isLoading: boolean;
  /** Error message */
  error: string | null;

  /** Initialize and load history */
  init: () => Promise<void>;
  /** Create a new instant conference */
  createConference: (name: string, config?: Partial<ConferenceConfig>) => Promise<Conference>;
  /** Join an existing conference */
  joinConference: (conferenceId: string) => void;
  /** Leave the active conference */
  leaveConference: () => Promise<void>;
  /** Add participant to active conference */
  addParticipant: (extension: string, name: string) => Promise<void>;
  /** Execute moderator action */
  executeAction: (action: ConferenceAction) => Promise<void>;
  /** Toggle recording */
  toggleRecording: () => Promise<void>;
  /** Update participant audio level (for visual feedback) */
  updateAudioLevel: (participantId: string, level: number) => void;
  /** Update participant speaking state */
  updateSpeaking: (participantId: string, isSpeaking: boolean) => void;
  /** Load conference history */
  loadHistory: () => Promise<void>;
}

// Mock participants for demo
const MOCK_PARTICIPANTS: Participant[] = [
  {
    id: "p_self",
    name: "You",
    extension: "1001",
    role: "moderator",
    status: "connected",
    isMuted: false,
    isOnHold: false,
    isSpeaking: false,
    joinedAt: Date.now(),
    audioLevel: 0,
  },
];

export const useConferenceStore = create<ConferenceStore>((set, get) => ({
  activeConference: null,
  history: [],
  isLoading: false,
  error: null,

  init: async () => {
    await conferenceEngine.init();
    const history = await conferenceEngine.getConferenceHistory();
    set({ history });
  },

  createConference: async (name, config) => {
    set({ isLoading: true, error: null });
    try {
      const conference = await conferenceEngine.createConference(name, config);
      // Add self as moderator
      conference.participants = [...MOCK_PARTICIPANTS];
      set({ activeConference: conference, isLoading: false });
      return conference;
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
      throw err;
    }
  },

  joinConference: (conferenceId) => {
    const { history } = get();
    const conference = history.find((c) => c.id === conferenceId);
    if (conference) {
      set({ activeConference: { ...conference, state: "active", participants: [...MOCK_PARTICIPANTS] } });
    }
  },

  leaveConference: async () => {
    const { activeConference } = get();
    if (!activeConference) return;

    await conferenceEngine.endConference(activeConference.id);
    const endedConference: Conference = {
      ...activeConference,
      state: "ended",
      endedAt: Date.now(),
      duration: Math.floor((Date.now() - (activeConference.startedAt ?? Date.now())) / 1000),
    };

    set((state) => ({
      activeConference: null,
      history: [endedConference, ...state.history.filter((c) => c.id !== endedConference.id)],
    }));
  },

  addParticipant: async (extension, name) => {
    const { activeConference } = get();
    if (!activeConference) return;

    const participant = await conferenceEngine.addParticipant(
      activeConference.id,
      extension,
      name
    );

    set({
      activeConference: {
        ...activeConference,
        participants: [...activeConference.participants, participant],
      },
    });
  },

  executeAction: async (action) => {
    const { activeConference } = get();
    if (!activeConference) return;

    await conferenceEngine.executeAction(activeConference.id, action);

    // Update local state based on action
    const updatedParticipants = [...activeConference.participants];

    switch (action.type) {
      case "mute_participant": {
        const p = updatedParticipants.find((p) => p.id === action.participantId);
        if (p) p.isMuted = true;
        break;
      }
      case "unmute_participant": {
        const p = updatedParticipants.find((p) => p.id === action.participantId);
        if (p) p.isMuted = false;
        break;
      }
      case "kick_participant": {
        const idx = updatedParticipants.findIndex((p) => p.id === action.participantId);
        if (idx >= 0) updatedParticipants.splice(idx, 1);
        break;
      }
      case "mute_all":
        updatedParticipants.forEach((p) => {
          if (p.role !== "moderator") p.isMuted = true;
        });
        break;
      case "unmute_all":
        updatedParticipants.forEach((p) => (p.isMuted = false));
        break;
      case "start_recording":
        set({ activeConference: { ...activeConference, isRecording: true, participants: updatedParticipants } });
        return;
      case "stop_recording":
        set({ activeConference: { ...activeConference, isRecording: false, participants: updatedParticipants } });
        return;
      case "promote_to_moderator": {
        const p = updatedParticipants.find((p) => p.id === action.participantId);
        if (p) p.role = "moderator";
        break;
      }
      case "demote_to_listener": {
        const p = updatedParticipants.find((p) => p.id === action.participantId);
        if (p) p.role = "listener";
        break;
      }
    }

    set({ activeConference: { ...activeConference, participants: updatedParticipants } });
  },

  toggleRecording: async () => {
    const { activeConference, executeAction } = get();
    if (!activeConference) return;

    if (activeConference.isRecording) {
      await executeAction({ type: "stop_recording" });
    } else {
      await executeAction({ type: "start_recording" });
    }
  },

  updateAudioLevel: (participantId, level) => {
    const { activeConference } = get();
    if (!activeConference) return;

    const participants = activeConference.participants.map((p) =>
      p.id === participantId ? { ...p, audioLevel: level } : p
    );
    set({ activeConference: { ...activeConference, participants } });
  },

  updateSpeaking: (participantId, isSpeaking) => {
    const { activeConference } = get();
    if (!activeConference) return;

    const participants = activeConference.participants.map((p) =>
      p.id === participantId ? { ...p, isSpeaking } : p
    );
    set({ activeConference: { ...activeConference, participants } });
  },

  loadHistory: async () => {
    const history = await conferenceEngine.getConferenceHistory();
    set({ history });
  },
}));
