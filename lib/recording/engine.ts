/**
 * FreeSWITCH Call Recording Engine
 * 
 * Manages server-side call recording via FreeSWITCH ESL (Event Socket Layer).
 * Recordings are stored on the FreeSWITCH server and accessed via HTTP API.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import type {
  CallRecording,
  RecordingCommand,
  RecordingFilter,
  FreeSwitchRecordingConfig,
  RecordingFormat,
} from "./types";

const RECORDING_CONFIG_KEY = "@cloudphone11:recording_config";

const DEFAULT_CONFIG: FreeSwitchRecordingConfig = {
  format: "wav",
  recordDir: "/var/lib/freeswitch/recordings",
  maxDuration: 0,
  silenceThreshold: 0,
  silenceHits: 0,
  stereo: true,
  autoRecord: false,
  playBeep: true,
};

class RecordingEngine {
  private config: FreeSwitchRecordingConfig = DEFAULT_CONFIG;
  private freeswitchUrl: string = "";
  private freeswitchPassword: string = "";
  private initialized: boolean = false;

  async init(): Promise<void> {
    try {
      const savedConfig = await AsyncStorage.getItem(RECORDING_CONFIG_KEY);
      if (savedConfig) {
        this.config = { ...DEFAULT_CONFIG, ...JSON.parse(savedConfig) };
      }

      const serverUrl = await AsyncStorage.getItem("@cloudphone11:freeswitch_url");
      const serverPass = await AsyncStorage.getItem("@cloudphone11:freeswitch_password");
      if (serverUrl) this.freeswitchUrl = serverUrl;
      if (serverPass) this.freeswitchPassword = serverPass;

      this.initialized = true;
      console.log("[RecordingEngine] Initialized with config:", this.config.format, this.config.stereo ? "stereo" : "mono");
    } catch (error) {
      console.error("[RecordingEngine] Init failed:", error);
    }
  }

  async updateConfig(config: Partial<FreeSwitchRecordingConfig>): Promise<void> {
    this.config = { ...this.config, ...config };
    await AsyncStorage.setItem(RECORDING_CONFIG_KEY, JSON.stringify(this.config));
  }

  getConfig(): FreeSwitchRecordingConfig {
    return { ...this.config };
  }

  /**
   * Send ESL command to FreeSWITCH to control recording
   */
  async sendCommand(command: RecordingCommand): Promise<boolean> {
    if (!this.freeswitchUrl) {
      console.warn("[RecordingEngine] FreeSWITCH URL not configured");
      return false;
    }

    try {
      const eslCommand = this.buildEslCommand(command);
      const response = await fetch(`${this.freeswitchUrl}/api`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${btoa(`freeswitch:${this.freeswitchPassword}`)}`,
        },
        body: eslCommand,
      });

      if (!response.ok) {
        throw new Error(`ESL command failed: ${response.status}`);
      }

      const result = await response.text();
      console.log(`[RecordingEngine] Command ${command.type} result:`, result.trim());
      return true;
    } catch (error) {
      console.error(`[RecordingEngine] Command ${command.type} failed:`, error);
      return false;
    }
  }

  private buildEslCommand(command: RecordingCommand): string {
    const { type, callUuid, filePath } = command;
    const ext = this.config.format;
    const path = filePath || `${this.config.recordDir}/${callUuid}.${ext}`;

    switch (type) {
      case "start":
        if (this.config.stereo) {
          return `uuid_record ${callUuid} start ${path} stereo`;
        }
        return `uuid_record ${callUuid} start ${path}`;
      case "stop":
        return `uuid_record ${callUuid} stop ${path}`;
      case "pause":
        return `uuid_record ${callUuid} mask ${path}`;
      case "resume":
        return `uuid_record ${callUuid} unmask ${path}`;
      case "mask":
        return `uuid_record ${callUuid} mask ${path}`;
      case "unmask":
        return `uuid_record ${callUuid} unmask ${path}`;
      default:
        return "";
    }
  }

  /**
   * Start recording a call
   */
  async startRecording(callUuid: string): Promise<string | null> {
    const filePath = `${this.config.recordDir}/${callUuid}.${this.config.format}`;

    if (this.config.playBeep) {
      // Play beep tone before recording (optional compliance requirement)
      await this.sendCommand({ type: "start", callUuid, filePath: "tone_stream://%(200,0,800)" } as any);
    }

    const success = await this.sendCommand({ type: "start", callUuid, filePath });
    return success ? filePath : null;
  }

  /**
   * Stop recording a call
   */
  async stopRecording(callUuid: string): Promise<boolean> {
    return this.sendCommand({ type: "stop", callUuid });
  }

  /**
   * Pause recording (masks audio with silence)
   */
  async pauseRecording(callUuid: string): Promise<boolean> {
    return this.sendCommand({ type: "mask", callUuid });
  }

  /**
   * Resume recording after pause
   */
  async resumeRecording(callUuid: string): Promise<boolean> {
    return this.sendCommand({ type: "unmask", callUuid });
  }

  /**
   * Fetch recordings list from FreeSWITCH server
   */
  async fetchRecordings(filter?: RecordingFilter): Promise<CallRecording[]> {
    if (!this.freeswitchUrl) {
      console.warn("[RecordingEngine] FreeSWITCH URL not configured, returning mock data");
      return this.getMockRecordings(filter);
    }

    try {
      const params = new URLSearchParams();
      if (filter?.search) params.set("search", filter.search);
      if (filter?.direction && filter.direction !== "all") params.set("direction", filter.direction);
      if (filter?.dateFrom) params.set("from", filter.dateFrom.toString());
      if (filter?.dateTo) params.set("to", filter.dateTo.toString());
      if (filter?.isStarred) params.set("starred", "true");

      const response = await fetch(
        `${this.freeswitchUrl}/recordings?${params.toString()}`,
        {
          headers: {
            Authorization: `Basic ${btoa(`freeswitch:${this.freeswitchPassword}`)}`,
          },
        }
      );

      if (!response.ok) throw new Error(`Fetch recordings failed: ${response.status}`);
      return await response.json();
    } catch (error) {
      console.warn("[RecordingEngine] Fetch failed, using mock data:", error);
      return this.getMockRecordings(filter);
    }
  }

  /**
   * Get download URL for a recording
   */
  getDownloadUrl(recording: CallRecording): string {
    if (recording.downloadUrl) return recording.downloadUrl;
    return `${this.freeswitchUrl}/recordings/${recording.id}.${recording.format}`;
  }

  /**
   * Delete a recording from the server
   */
  async deleteRecording(recordingId: string): Promise<boolean> {
    if (!this.freeswitchUrl) return true;

    try {
      const response = await fetch(`${this.freeswitchUrl}/recordings/${recordingId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Basic ${btoa(`freeswitch:${this.freeswitchPassword}`)}`,
        },
      });
      return response.ok;
    } catch (error) {
      console.error("[RecordingEngine] Delete failed:", error);
      return false;
    }
  }

  /**
   * Generate FreeSWITCH dial plan XML for auto-recording
   */
  generateDialPlanXml(): string {
    const ext = this.config.format;
    const dir = this.config.recordDir;
    const stereo = this.config.stereo ? "true" : "false";

    return `
<!-- CloudPhone11 Auto-Recording Dial Plan -->
<extension name="cloudphone11-auto-record">
  <condition field="destination_number" expression="^(.*)$">
    <action application="set" data="RECORD_STEREO=${stereo}"/>
    <action application="set" data="RECORD_MIN_SEC=3"/>
    <action application="set" data="media_bug_answer_req=true"/>
    <action application="set" data="recording_follow_transfer=true"/>
    <action application="set" data="record_waste_resources=true"/>
    <action application="record_session" data="${dir}/\${uuid}.${ext}"/>
  </condition>
</extension>`.trim();
  }

  /**
   * Mock recordings for demo/offline mode
   */
  private getMockRecordings(filter?: RecordingFilter): CallRecording[] {
    const now = Date.now();
    const hour = 3600000;
    const day = 86400000;

    const mockData: CallRecording[] = [
      {
        id: "rec-001",
        callUuid: "call-uuid-001",
        callerNumber: "+1 (555) 234-5678",
        callerName: "John Smith",
        calleeNumber: "+1 (555) 100-2000",
        calleeName: "Support Line",
        direction: "inbound",
        startedAt: now - 2 * hour,
        endedAt: now - 2 * hour + 342000,
        duration: 342,
        fileSize: 5467200,
        format: "wav",
        serverPath: "/var/lib/freeswitch/recordings/call-uuid-001.wav",
        downloadUrl: "",
        status: "completed",
        isPlayed: false,
        isStarred: true,
        transcription: "Hi, I'm calling about my account. I need to update my billing address and also check on the status of my last invoice. Can you help me with that?",
        tags: ["support", "billing"],
      },
      {
        id: "rec-002",
        callUuid: "call-uuid-002",
        callerNumber: "+1 (555) 100-2000",
        callerName: "You",
        calleeNumber: "+1 (555) 876-5432",
        calleeName: "Sarah Johnson",
        direction: "outbound",
        startedAt: now - 5 * hour,
        endedAt: now - 5 * hour + 187000,
        duration: 187,
        fileSize: 2992000,
        format: "wav",
        serverPath: "/var/lib/freeswitch/recordings/call-uuid-002.wav",
        downloadUrl: "",
        status: "completed",
        isPlayed: true,
        isStarred: false,
        transcription: "Hey Sarah, just following up on the proposal we discussed last week. I wanted to confirm the pricing details before we send it over to the client.",
        tags: ["sales"],
      },
      {
        id: "rec-003",
        callUuid: "call-uuid-003",
        callerNumber: "+44 20 7946 0958",
        callerName: "London Office",
        calleeNumber: "+1 (555) 100-2000",
        calleeName: "Main Line",
        direction: "inbound",
        startedAt: now - 1 * day - 3 * hour,
        endedAt: now - 1 * day - 3 * hour + 523000,
        duration: 523,
        fileSize: 8368000,
        format: "wav",
        serverPath: "/var/lib/freeswitch/recordings/call-uuid-003.wav",
        downloadUrl: "",
        status: "completed",
        isPlayed: true,
        isStarred: true,
        transcription: "Good morning, this is the London office calling regarding the quarterly review. We need to schedule a conference call with all regional managers by end of this week.",
        tags: ["internal", "meeting"],
      },
      {
        id: "rec-004",
        callUuid: "call-uuid-004",
        callerNumber: "+1 (555) 100-2000",
        callerName: "You",
        calleeNumber: "+1 (800) 555-0199",
        calleeName: "Vendor Support",
        direction: "outbound",
        startedAt: now - 1 * day - 7 * hour,
        endedAt: now - 1 * day - 7 * hour + 95000,
        duration: 95,
        fileSize: 1520000,
        format: "wav",
        serverPath: "/var/lib/freeswitch/recordings/call-uuid-004.wav",
        downloadUrl: "",
        status: "completed",
        isPlayed: false,
        isStarred: false,
        tags: ["vendor"],
      },
      {
        id: "rec-005",
        callUuid: "call-uuid-005",
        callerNumber: "+61 2 9876 5432",
        callerName: "Mike Chen",
        calleeNumber: "+1 (555) 100-2000",
        calleeName: "Sales Line",
        direction: "inbound",
        startedAt: now - 2 * day - 1 * hour,
        endedAt: now - 2 * day - 1 * hour + 678000,
        duration: 678,
        fileSize: 10848000,
        format: "wav",
        serverPath: "/var/lib/freeswitch/recordings/call-uuid-005.wav",
        downloadUrl: "",
        status: "completed",
        isPlayed: true,
        isStarred: false,
        transcription: "Hi there, I'm interested in your enterprise VoIP solution for our Sydney office. We have about 200 employees and need a full unified communications setup including video conferencing.",
        tags: ["sales", "enterprise"],
      },
      {
        id: "rec-006",
        callUuid: "call-uuid-006",
        callerNumber: "conf:8100",
        callerName: "Team Standup",
        calleeNumber: "conference",
        calleeName: "Conference Bridge",
        direction: "conference",
        startedAt: now - 3 * hour,
        endedAt: now - 3 * hour + 1845000,
        duration: 1845,
        fileSize: 29520000,
        format: "wav",
        serverPath: "/var/lib/freeswitch/recordings/call-uuid-006.wav",
        downloadUrl: "",
        status: "completed",
        isPlayed: false,
        isStarred: false,
        transcription: "Daily standup meeting recording with engineering team. Topics covered: sprint progress, blockers on the billing integration, and upcoming release timeline.",
        tags: ["conference", "standup"],
      },
    ];

    // Apply filters
    let filtered = mockData;
    if (filter?.search) {
      const q = filter.search.toLowerCase();
      filtered = filtered.filter(
        (r) =>
          r.callerName.toLowerCase().includes(q) ||
          r.calleeName.toLowerCase().includes(q) ||
          r.callerNumber.includes(q) ||
          r.calleeNumber.includes(q) ||
          r.transcription?.toLowerCase().includes(q) ||
          r.tags.some((t) => t.includes(q))
      );
    }
    if (filter?.direction && filter.direction !== "all") {
      filtered = filtered.filter((r) => r.direction === filter.direction);
    }
    if (filter?.isStarred) {
      filtered = filtered.filter((r) => r.isStarred);
    }
    if (filter?.dateFrom) {
      filtered = filtered.filter((r) => r.startedAt >= filter.dateFrom!);
    }
    if (filter?.dateTo) {
      filtered = filtered.filter((r) => r.startedAt <= filter.dateTo!);
    }

    return filtered.sort((a, b) => b.startedAt - a.startedAt);
  }
}

export const recordingEngine = new RecordingEngine();
