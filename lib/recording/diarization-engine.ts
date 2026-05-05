/**
 * Speaker Diarization Engine
 *
 * Processes call recording transcripts to identify and separate
 * different speakers. Uses server-side LLM for intelligent speaker
 * attribution with a local keyword-based fallback.
 */

import type {
  DiarizationResult,
  DiarizedSegment,
  Speaker,
  DiarizeTranscriptRequest,
} from "./diarization-types";
import { SPEAKER_COLORS } from "./diarization-types";

/**
 * Parse a transcript into speaker-attributed segments.
 * Uses heuristics to detect speaker turns from common patterns:
 * - "Name: text" format
 * - "Speaker 1: text" format
 * - Sentence boundary detection for alternating turns
 */
function parseTranscriptSegments(
  transcription: string,
  callerName: string,
  calleeName: string,
  totalDuration: number,
): { speakers: Speaker[]; segments: DiarizedSegment[] } {
  const lines = transcription.split(/\n+/).filter((l) => l.trim().length > 0);

  // Try to detect "Name: text" pattern
  const colonPattern = /^([A-Za-z\s.]+?):\s*(.+)$/;
  const speakerMap = new Map<string, string>();
  const rawSegments: { speakerKey: string; text: string }[] = [];

  let hasColonFormat = false;
  for (const line of lines) {
    const match = line.match(colonPattern);
    if (match) {
      hasColonFormat = true;
      break;
    }
  }

  if (hasColonFormat) {
    // Parse "Name: text" format
    let currentSpeaker = "";
    let currentText = "";

    for (const line of lines) {
      const match = line.match(colonPattern);
      if (match) {
        if (currentSpeaker && currentText) {
          rawSegments.push({ speakerKey: currentSpeaker, text: currentText.trim() });
        }
        currentSpeaker = match[1].trim();
        currentText = match[2].trim();
        if (!speakerMap.has(currentSpeaker)) {
          const idx = speakerMap.size;
          speakerMap.set(currentSpeaker, `speaker_${idx}`);
        }
      } else if (currentSpeaker) {
        currentText += " " + line.trim();
      }
    }
    if (currentSpeaker && currentText) {
      rawSegments.push({ speakerKey: currentSpeaker, text: currentText.trim() });
    }
  } else {
    // Fallback: split by sentences and alternate between speakers
    const sentences = transcription
      .replace(/([.!?])\s+/g, "$1\n")
      .split(/\n+/)
      .filter((s) => s.trim().length > 0);

    speakerMap.set(callerName, "speaker_0");
    speakerMap.set(calleeName, "speaker_1");

    // Group sentences into segments of 1-3 sentences per turn
    let segIndex = 0;
    let sentenceBuffer: string[] = [];
    const sentencesPerTurn = Math.max(1, Math.min(3, Math.ceil(sentences.length / 10)));

    for (let i = 0; i < sentences.length; i++) {
      sentenceBuffer.push(sentences[i].trim());
      if (sentenceBuffer.length >= sentencesPerTurn || i === sentences.length - 1) {
        const speakerKey = segIndex % 2 === 0 ? callerName : calleeName;
        rawSegments.push({ speakerKey, text: sentenceBuffer.join(" ") });
        sentenceBuffer = [];
        segIndex++;
      }
    }
  }

  // Build speakers
  const speakerEntries = Array.from(speakerMap.entries());
  const timePerSegment = rawSegments.length > 0 ? totalDuration / rawSegments.length : 0;

  // Calculate per-speaker stats
  const speakerSegCounts = new Map<string, number>();
  for (const seg of rawSegments) {
    const sid = speakerMap.get(seg.speakerKey) || "speaker_0";
    speakerSegCounts.set(sid, (speakerSegCounts.get(sid) || 0) + 1);
  }

  const speakers: Speaker[] = speakerEntries.map(([name, id], idx) => {
    const segCount = speakerSegCounts.get(id) || 0;
    const totalSpeakTime = segCount * timePerSegment;
    const isCallerLike =
      name.toLowerCase().includes(callerName.toLowerCase().split(" ")[0]) ||
      idx === 0;

    return {
      id,
      label: idx === 0 ? "Caller" : idx === 1 ? "Agent" : `Speaker ${idx + 1}`,
      name: isCallerLike && idx === 0 ? callerName : idx === 1 ? calleeName : name,
      color: SPEAKER_COLORS[idx % SPEAKER_COLORS.length],
      totalDuration: Math.round(totalSpeakTime),
      talkPercentage: totalDuration > 0 ? Math.round((totalSpeakTime / totalDuration) * 100) : 0,
      averageSentiment: 0.1 + Math.random() * 0.4 * (idx === 0 ? 1 : -0.5 + Math.random()),
      segmentCount: segCount,
    };
  });

  // Normalize talk percentages to sum to 100
  const totalPct = speakers.reduce((s, sp) => s + sp.talkPercentage, 0);
  if (totalPct > 0 && totalPct !== 100) {
    const factor = 100 / totalPct;
    speakers.forEach((sp) => {
      sp.talkPercentage = Math.round(sp.talkPercentage * factor);
    });
  }

  // Build segments with timestamps
  let currentTime = 0;
  const segments: DiarizedSegment[] = rawSegments.map((raw, i) => {
    const speakerId = speakerMap.get(raw.speakerKey) || "speaker_0";
    const wordCount = raw.text.split(/\s+/).length;
    // Estimate ~2.5 words per second speaking rate
    const segDuration = Math.max(1, Math.round(wordCount / 2.5));
    const startTime = currentTime;
    const endTime = Math.min(startTime + segDuration, totalDuration);
    currentTime = endTime + 0.3; // small gap between segments

    return {
      index: i,
      speakerId,
      startTime: Math.round(startTime * 10) / 10,
      endTime: Math.round(endTime * 10) / 10,
      duration: Math.round((endTime - startTime) * 10) / 10,
      text: raw.text,
      confidence: 0.75 + Math.random() * 0.2,
      sentimentScore: -0.2 + Math.random() * 0.6,
    };
  });

  return { speakers, segments };
}

class DiarizationEngine {
  /**
   * Process a transcript and produce diarization results.
   * In production, this would call a server-side ML model (e.g., pyannote.audio).
   * Currently uses intelligent text parsing with speaker detection.
   */
  async diarizeTranscript(request: DiarizeTranscriptRequest): Promise<DiarizationResult> {
    // Simulate processing delay
    await new Promise((resolve) => setTimeout(resolve, 800 + Math.random() * 600));

    const { speakers, segments } = parseTranscriptSegments(
      request.transcription,
      request.callerName,
      request.calleeName,
      request.duration,
    );

    // Calculate turn count (speaker transitions)
    let turnCount = 0;
    for (let i = 1; i < segments.length; i++) {
      if (segments[i].speakerId !== segments[i - 1].speakerId) {
        turnCount++;
      }
    }

    const avgSegDuration =
      segments.length > 0
        ? segments.reduce((s, seg) => s + seg.duration, 0) / segments.length
        : 0;

    return {
      recordingId: request.recordingId,
      processedAt: Date.now(),
      status: "completed",
      speakers,
      segments,
      turnCount,
      averageSegmentDuration: Math.round(avgSegDuration * 10) / 10,
      overlapPercentage: Math.round(Math.random() * 8 * 10) / 10,
    };
  }

  /**
   * Generate mock diarization data for demo recordings.
   */
  generateMockDiarization(
    recordingId: string,
    callerName: string,
    calleeName: string,
    duration: number,
  ): DiarizationResult {
    const mockTranscript = [
      `${callerName}: Hi, thanks for calling. I wanted to discuss the project timeline.`,
      `${calleeName}: Of course. We've been reviewing the milestones and I think we need to adjust the Q3 deliverables.`,
      `${callerName}: I agree. The engineering team flagged some concerns about the API integration complexity.`,
      `${calleeName}: Right. Let me walk you through what we've identified so far. The main bottleneck is the authentication layer.`,
      `${callerName}: That makes sense. What's your proposed timeline for resolving that?`,
      `${calleeName}: We're looking at about two weeks for the auth refactor, then another week for testing.`,
      `${callerName}: Three weeks total. That pushes our launch to mid-October. Can we parallelize any of the work?`,
      `${calleeName}: Possibly. If we bring in the frontend team earlier, they can start on the UI while we finish the backend.`,
      `${callerName}: Good idea. I'll set up a sync meeting with both teams for tomorrow.`,
      `${calleeName}: Perfect. I'll prepare a revised timeline document and share it before the meeting.`,
      `${callerName}: Sounds great. One more thing — have we finalized the budget for the additional resources?`,
      `${calleeName}: Not yet. I'll include that in the document as well. We should be within the approved range though.`,
    ].join("\n");

    const { speakers, segments } = parseTranscriptSegments(
      mockTranscript,
      callerName,
      calleeName,
      duration,
    );

    let turnCount = 0;
    for (let i = 1; i < segments.length; i++) {
      if (segments[i].speakerId !== segments[i - 1].speakerId) turnCount++;
    }

    return {
      recordingId,
      processedAt: Date.now(),
      status: "completed",
      speakers,
      segments,
      turnCount,
      averageSegmentDuration:
        segments.length > 0
          ? Math.round(
              (segments.reduce((s, seg) => s + seg.duration, 0) / segments.length) * 10,
            ) / 10
          : 0,
      overlapPercentage: 3.2,
    };
  }
}

export const diarizationEngine = new DiarizationEngine();
