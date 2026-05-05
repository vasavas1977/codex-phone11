/**
 * Call Recording Store
 * 
 * Zustand store for managing call recordings, playback state,
 * recording controls, and AI transcript analysis.
 */

import { create } from "zustand";
import type {
  CallRecording,
  RecordingFilter,
  RecordingPlaybackState,
} from "./types";
import type { CallAnalysis, AnalysisStatus } from "./ai-types";
import type { DiarizationResult, DiarizationStatus, DiarizationCorrections, SpeakerCorrection, SegmentReassignment } from "./diarization-types";
import { recordingEngine } from "./engine";
import { aiAnalysisEngine } from "./ai-engine";
import { diarizationEngine } from "./diarization-engine";

interface RecordingState {
  recordings: CallRecording[];
  isLoading: boolean;
  error: string | null;
  filter: RecordingFilter;
  playback: RecordingPlaybackState;

  // AI Analysis state
  analyses: Record<string, CallAnalysis>;
  analysisStatus: Record<string, AnalysisStatus>;

  // Diarization state
  diarizations: Record<string, DiarizationResult>;
  diarizationStatus: Record<string, DiarizationStatus>;

  // Data actions
  fetchRecordings: () => Promise<void>;
  setFilter: (filter: Partial<RecordingFilter>) => void;
  toggleStar: (recordingId: string) => void;
  markAsPlayed: (recordingId: string) => void;
  deleteRecording: (recordingId: string) => Promise<void>;

  // Playback actions
  startPlayback: (recording: CallRecording) => void;
  stopPlayback: () => void;
  togglePlayPause: () => void;
  seekTo: (position: number) => void;
  setPlaybackSpeed: (speed: number) => void;
  updatePosition: (position: number) => void;

  // AI Analysis actions
  analyzeRecording: (recording: CallRecording) => Promise<void>;
  getAnalysis: (recordingId: string) => CallAnalysis | null;
  toggleActionItem: (recordingId: string, taskIndex: number) => void;

  // Diarization actions
  diarizeRecording: (recording: CallRecording) => Promise<void>;
  getDiarization: (recordingId: string) => DiarizationResult | null;

  // Speaker correction actions
  corrections: Record<string, DiarizationCorrections>;
  renameSpeaker: (recordingId: string, speakerId: string, newLabel: string, newName?: string) => void;
  reassignSegment: (recordingId: string, segmentIndex: number, toSpeakerId: string) => void;

  // Recording control (during active call)
  startCallRecording: (callUuid: string) => Promise<boolean>;
  stopCallRecording: (callUuid: string) => Promise<boolean>;
  pauseCallRecording: (callUuid: string) => Promise<boolean>;
  resumeCallRecording: (callUuid: string) => Promise<boolean>;
  isRecordingActive: boolean;
  isRecordingPaused: boolean;
  activeRecordingCallUuid: string | null;
}

export const useRecordingStore = create<RecordingState>((set, get) => ({
  recordings: [],
  isLoading: false,
  error: null,
  filter: { direction: "all" },
  playback: {
    recordingId: null,
    isPlaying: false,
    currentPosition: 0,
    duration: 0,
    playbackSpeed: 1.0,
  },
  analyses: {},
  analysisStatus: {},
  diarizations: {},
  diarizationStatus: {},
  corrections: {},
  isRecordingActive: false,
  isRecordingPaused: false,
  activeRecordingCallUuid: null,

  fetchRecordings: async () => {
    set({ isLoading: true, error: null });
    try {
      const recordings = await recordingEngine.fetchRecordings(get().filter);
      set({ recordings, isLoading: false });
    } catch (error: any) {
      set({ error: error.message, isLoading: false });
    }
  },

  setFilter: (filter) => {
    set((state) => ({
      filter: { ...state.filter, ...filter },
    }));
    get().fetchRecordings();
  },

  toggleStar: (recordingId) => {
    set((state) => ({
      recordings: state.recordings.map((r) =>
        r.id === recordingId ? { ...r, isStarred: !r.isStarred } : r
      ),
    }));
  },

  markAsPlayed: (recordingId) => {
    set((state) => ({
      recordings: state.recordings.map((r) =>
        r.id === recordingId ? { ...r, isPlayed: true } : r
      ),
    }));
  },

  deleteRecording: async (recordingId) => {
    const success = await recordingEngine.deleteRecording(recordingId);
    if (success) {
      set((state) => {
        const newAnalyses = { ...state.analyses };
        const newStatus = { ...state.analysisStatus };
        delete newAnalyses[recordingId];
        delete newStatus[recordingId];
        return {
          recordings: state.recordings.filter((r) => r.id !== recordingId),
          analyses: newAnalyses,
          analysisStatus: newStatus,
        };
      });
      if (get().playback.recordingId === recordingId) {
        get().stopPlayback();
      }
    }
  },

  startPlayback: (recording) => {
    set({
      playback: {
        recordingId: recording.id,
        isPlaying: true,
        currentPosition: 0,
        duration: recording.duration,
        playbackSpeed: get().playback.playbackSpeed,
      },
    });
    get().markAsPlayed(recording.id);
  },

  stopPlayback: () => {
    set({
      playback: {
        ...get().playback,
        recordingId: null,
        isPlaying: false,
        currentPosition: 0,
      },
    });
  },

  togglePlayPause: () => {
    set((state) => ({
      playback: {
        ...state.playback,
        isPlaying: !state.playback.isPlaying,
      },
    }));
  },

  seekTo: (position) => {
    set((state) => ({
      playback: {
        ...state.playback,
        currentPosition: Math.max(0, Math.min(position, state.playback.duration)),
      },
    }));
  },

  setPlaybackSpeed: (speed) => {
    set((state) => ({
      playback: {
        ...state.playback,
        playbackSpeed: speed,
      },
    }));
  },

  updatePosition: (position) => {
    set((state) => ({
      playback: {
        ...state.playback,
        currentPosition: position,
      },
    }));
  },

  // AI Analysis actions
  analyzeRecording: async (recording) => {
    if (!recording.transcription) return;

    // Set analyzing status
    set((state) => ({
      analysisStatus: { ...state.analysisStatus, [recording.id]: "analyzing" },
    }));

    try {
      const analysis = await aiAnalysisEngine.analyzeTranscript({
        recordingId: recording.id,
        transcription: recording.transcription,
        callerName: recording.callerName,
        calleeName: recording.calleeName,
        direction: recording.direction,
        duration: recording.duration,
      });

      set((state) => ({
        analyses: { ...state.analyses, [recording.id]: analysis },
        analysisStatus: { ...state.analysisStatus, [recording.id]: "completed" },
      }));
    } catch (error: any) {
      console.error("[RecordingStore] AI analysis failed:", error);
      set((state) => ({
        analysisStatus: { ...state.analysisStatus, [recording.id]: "failed" },
      }));
    }
  },

  getAnalysis: (recordingId) => {
    return get().analyses[recordingId] || null;
  },

  toggleActionItem: (recordingId, taskIndex) => {
    set((state) => {
      const analysis = state.analyses[recordingId];
      if (!analysis) return state;

      const updatedItems = analysis.actionItems.map((item, i) =>
        i === taskIndex ? { ...item, completed: !item.completed } : item
      );

      return {
        analyses: {
          ...state.analyses,
          [recordingId]: { ...analysis, actionItems: updatedItems },
        },
      };
    });
  },

  // Diarization actions
  diarizeRecording: async (recording) => {
    if (!recording.transcription) return;
    set((state) => ({
      diarizationStatus: { ...state.diarizationStatus, [recording.id]: "processing" },
    }));
    try {
      const result = await diarizationEngine.diarizeTranscript({
        recordingId: recording.id,
        transcription: recording.transcription,
        callerName: recording.callerName,
        calleeName: recording.calleeName,
        duration: recording.duration,
      });
      set((state) => ({
        diarizations: { ...state.diarizations, [recording.id]: result },
        diarizationStatus: { ...state.diarizationStatus, [recording.id]: "completed" },
      }));
    } catch (error: any) {
      console.error("[RecordingStore] Diarization failed:", error);
      set((state) => ({
        diarizationStatus: { ...state.diarizationStatus, [recording.id]: "failed" },
      }));
    }
  },

  getDiarization: (recordingId) => {
    return get().diarizations[recordingId] || null;
  },

  renameSpeaker: (recordingId, speakerId, newLabel, newName) => {
    set((state) => {
      const diarization = state.diarizations[recordingId];
      if (!diarization) return state;

      const speaker = diarization.speakers.find((s) => s.id === speakerId);
      if (!speaker) return state;

      const correction: SpeakerCorrection = {
        speakerId,
        originalLabel: speaker.label,
        originalName: speaker.name,
        newLabel,
        newName,
        correctedAt: Date.now(),
      };

      const updatedSpeakers = diarization.speakers.map((s) =>
        s.id === speakerId ? { ...s, label: newLabel, name: newName ?? s.name } : s
      );

      const existing = state.corrections[recordingId] || {
        recordingId,
        speakerCorrections: [],
        segmentReassignments: [],
        lastModified: Date.now(),
      };

      return {
        diarizations: {
          ...state.diarizations,
          [recordingId]: { ...diarization, speakers: updatedSpeakers },
        },
        corrections: {
          ...state.corrections,
          [recordingId]: {
            ...existing,
            speakerCorrections: [...existing.speakerCorrections, correction],
            lastModified: Date.now(),
          },
        },
      };
    });
  },

  reassignSegment: (recordingId, segmentIndex, toSpeakerId) => {
    set((state) => {
      const diarization = state.diarizations[recordingId];
      if (!diarization) return state;

      const segment = diarization.segments.find((s) => s.index === segmentIndex);
      if (!segment || segment.speakerId === toSpeakerId) return state;

      const reassignment: SegmentReassignment = {
        segmentIndex,
        fromSpeakerId: segment.speakerId,
        toSpeakerId,
        reassignedAt: Date.now(),
      };

      const updatedSegments = diarization.segments.map((s) =>
        s.index === segmentIndex ? { ...s, speakerId: toSpeakerId } : s
      );

      // Recalculate speaker stats
      const speakerDurations: Record<string, number> = {};
      const speakerCounts: Record<string, number> = {};
      const totalDur = updatedSegments.reduce((sum, s) => sum + s.duration, 0) || 1;
      for (const seg of updatedSegments) {
        speakerDurations[seg.speakerId] = (speakerDurations[seg.speakerId] || 0) + seg.duration;
        speakerCounts[seg.speakerId] = (speakerCounts[seg.speakerId] || 0) + 1;
      }
      const updatedSpeakers = diarization.speakers.map((sp) => ({
        ...sp,
        totalDuration: Math.round(speakerDurations[sp.id] || 0),
        talkPercentage: Math.round(((speakerDurations[sp.id] || 0) / totalDur) * 100),
        segmentCount: speakerCounts[sp.id] || 0,
      }));

      const existing = state.corrections[recordingId] || {
        recordingId,
        speakerCorrections: [],
        segmentReassignments: [],
        lastModified: Date.now(),
      };

      return {
        diarizations: {
          ...state.diarizations,
          [recordingId]: { ...diarization, segments: updatedSegments, speakers: updatedSpeakers },
        },
        corrections: {
          ...state.corrections,
          [recordingId]: {
            ...existing,
            segmentReassignments: [...existing.segmentReassignments, reassignment],
            lastModified: Date.now(),
          },
        },
      };
    });
  },

  // Active call recording controls
  startCallRecording: async (callUuid) => {
    const result = await recordingEngine.startRecording(callUuid);
    if (result) {
      set({ isRecordingActive: true, isRecordingPaused: false, activeRecordingCallUuid: callUuid });
    }
    return !!result;
  },

  stopCallRecording: async (callUuid) => {
    const success = await recordingEngine.stopRecording(callUuid);
    if (success) {
      set({ isRecordingActive: false, isRecordingPaused: false, activeRecordingCallUuid: null });
    }
    return success;
  },

  pauseCallRecording: async (callUuid) => {
    const success = await recordingEngine.pauseRecording(callUuid);
    if (success) {
      set({ isRecordingPaused: true });
    }
    return success;
  },

  resumeCallRecording: async (callUuid) => {
    const success = await recordingEngine.resumeRecording(callUuid);
    if (success) {
      set({ isRecordingPaused: false });
    }
    return success;
  },
}));
