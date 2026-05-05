/**
 * Conference Engine — FreeSWITCH Conference Bridge Integration
 *
 * Manages conference rooms via FreeSWITCH ESL (Event Socket Library).
 * In production, this communicates with FreeSWITCH mod_conference
 * via the ESL API or a REST middleware.
 *
 * FreeSWITCH Conference Commands:
 * - conference <name> dial <endpoint> — Add participant
 * - conference <name> kick <member_id> — Remove participant
 * - conference <name> mute <member_id> — Mute participant
 * - conference <name> unmute <member_id> — Unmute participant
 * - conference <name> record <path> — Start recording
 * - conference <name> norecord <path> — Stop recording
 * - conference <name> lock — Lock conference
 * - conference <name> unlock — Unlock conference
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Conference, ConferenceConfig, Participant, ConferenceAction } from "./types";

const STORAGE_KEY = "cloudphone11_conferences";
const ESL_STORAGE_KEY = "cloudphone11_freeswitch_esl";

interface FreeSwitchESLConfig {
  host: string;
  port: number;
  password: string;
  apiEndpoint: string; // REST API middleware URL
}

class ConferenceEngine {
  private eslConfig: FreeSwitchESLConfig | null = null;
  private isInitialized = false;
  private eventListeners: Map<string, Set<(data: any) => void>> = new Map();

  /** Initialize the conference engine */
  async init(): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(ESL_STORAGE_KEY);
      if (stored) {
        this.eslConfig = JSON.parse(stored);
      }
      this.isInitialized = true;
    } catch (err) {
      console.warn("[ConferenceEngine] Init failed:", err);
    }
  }

  /** Configure FreeSWITCH ESL connection */
  async configure(config: FreeSwitchESLConfig): Promise<void> {
    this.eslConfig = config;
    await AsyncStorage.setItem(ESL_STORAGE_KEY, JSON.stringify(config));
  }

  /** Get ESL config */
  getConfig(): FreeSwitchESLConfig | null {
    return this.eslConfig;
  }

  /** Check if connected to FreeSWITCH */
  isConnected(): boolean {
    return this.isInitialized && this.eslConfig !== null;
  }

  /**
   * Create a new conference room on FreeSWITCH
   * In production: POST to FreeSWITCH REST API middleware
   */
  async createConference(
    name: string,
    config: Partial<ConferenceConfig> = {}
  ): Promise<Conference> {
    const conferenceId = `conf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const pin = this.generatePin();
    const moderatorPin = this.generatePin();

    const fullConfig: ConferenceConfig = {
      maxParticipants: config.maxParticipants ?? 50,
      pin: config.pin ?? pin,
      moderatorPin: config.moderatorPin ?? moderatorPin,
      recordEnabled: config.recordEnabled ?? false,
      muteOnEntry: config.muteOnEntry ?? false,
      announceJoinLeave: config.announceJoinLeave ?? true,
      waitForModerator: config.waitForModerator ?? false,
      endWhenModeratorLeaves: config.endWhenModeratorLeaves ?? false,
    };

    const conference: Conference = {
      id: conferenceId,
      name,
      type: "instant",
      state: "active",
      bridgeNumber: `*800${Math.floor(Math.random() * 9000 + 1000)}`,
      config: fullConfig,
      participants: [],
      createdBy: "current_user",
      createdAt: Date.now(),
      startedAt: Date.now(),
      duration: 0,
      isRecording: false,
    };

    // In production: Send ESL command to FreeSWITCH
    // api conference ${name} set max_members ${maxParticipants}
    // api conference ${name} pin ${pin}
    if (this.eslConfig) {
      try {
        await this.sendESLCommand(`conference ${name} set max_members ${fullConfig.maxParticipants}`);
      } catch (err) {
        console.warn("[ConferenceEngine] ESL command failed, using local mode:", err);
      }
    }

    await this.saveConference(conference);
    this.emit("conference_created", conference);
    return conference;
  }

  /** Add a participant to the conference */
  async addParticipant(
    conferenceId: string,
    extension: string,
    name: string,
    role: "moderator" | "speaker" | "listener" = "speaker"
  ): Promise<Participant> {
    const participant: Participant = {
      id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name,
      extension,
      role,
      status: "connected",
      isMuted: false,
      isOnHold: false,
      isSpeaking: false,
      joinedAt: Date.now(),
      audioLevel: 0,
    };

    // In production: ESL command
    // api conference ${conferenceId} dial sofia/internal/${extension}
    if (this.eslConfig) {
      try {
        await this.sendESLCommand(`conference ${conferenceId} dial sofia/internal/${extension}`);
      } catch (err) {
        console.warn("[ConferenceEngine] Dial failed:", err);
      }
    }

    this.emit("participant_joined", { conferenceId, participant });
    return participant;
  }

  /** Execute a moderator action */
  async executeAction(conferenceId: string, action: ConferenceAction): Promise<void> {
    const eslCommands: Record<string, string> = {
      mute_participant: `conference ${conferenceId} mute ${(action as any).participantId}`,
      unmute_participant: `conference ${conferenceId} unmute ${(action as any).participantId}`,
      kick_participant: `conference ${conferenceId} kick ${(action as any).participantId}`,
      mute_all: `conference ${conferenceId} mute all`,
      unmute_all: `conference ${conferenceId} unmute all`,
      start_recording: `conference ${conferenceId} record /recordings/${conferenceId}_${Date.now()}.wav`,
      stop_recording: `conference ${conferenceId} norecord all`,
      lock_conference: `conference ${conferenceId} lock`,
      unlock_conference: `conference ${conferenceId} unlock`,
    };

    const command = eslCommands[action.type];
    if (command && this.eslConfig) {
      try {
        await this.sendESLCommand(command);
      } catch (err) {
        console.warn("[ConferenceEngine] Action failed:", err);
      }
    }

    this.emit("conference_action", { conferenceId, action });
  }

  /** End a conference */
  async endConference(conferenceId: string): Promise<void> {
    if (this.eslConfig) {
      try {
        await this.sendESLCommand(`conference ${conferenceId} kick all`);
      } catch (err) {
        console.warn("[ConferenceEngine] End conference failed:", err);
      }
    }
    this.emit("conference_ended", { conferenceId });
  }

  /** Send ESL command to FreeSWITCH via REST middleware */
  private async sendESLCommand(command: string): Promise<any> {
    if (!this.eslConfig) throw new Error("FreeSWITCH ESL not configured");

    const response = await fetch(`${this.eslConfig.apiEndpoint}/api`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${btoa(`freeswitch:${this.eslConfig.password}`)}`,
      },
      body: JSON.stringify({ command }),
    });

    if (!response.ok) {
      throw new Error(`ESL command failed: ${response.status}`);
    }

    return response.json();
  }

  /** Generate a random 4-digit PIN */
  private generatePin(): string {
    return Math.floor(1000 + Math.random() * 9000).toString();
  }

  /** Save conference to local storage */
  private async saveConference(conference: Conference): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      const conferences: Conference[] = stored ? JSON.parse(stored) : [];
      const index = conferences.findIndex((c) => c.id === conference.id);
      if (index >= 0) {
        conferences[index] = conference;
      } else {
        conferences.unshift(conference);
      }
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(conferences.slice(0, 50)));
    } catch (err) {
      console.warn("[ConferenceEngine] Save failed:", err);
    }
  }

  /** Load conference history */
  async getConferenceHistory(): Promise<Conference[]> {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  }

  /** Event emitter */
  on(event: string, callback: (data: any) => void): () => void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(callback);
    return () => this.eventListeners.get(event)?.delete(callback);
  }

  private emit(event: string, data: any): void {
    this.eventListeners.get(event)?.forEach((cb) => cb(data));
  }
}

export const conferenceEngine = new ConferenceEngine();
