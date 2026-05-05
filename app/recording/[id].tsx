/**
 * Recording Detail Screen
 *
 * Full playback controls, waveform visualization, transcription,
 * AI-powered insights (summary, topics, sentiment, action items),
 * tags, notes, and sharing for a single call recording.
 */

import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  Share,
  TextInput,
  ActivityIndicator,
  Modal,
  Platform,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { useColors } from "@/hooks/use-colors";
import { useRecordingStore } from "@/lib/recording/store";
import type { CallAnalysis, SentimentLabel, UrgencyLevel } from "@/lib/recording/ai-types";
import type { DiarizationResult, DiarizedSegment, Speaker } from "@/lib/recording/diarization-types";
import { SPEAKER_COLORS } from "@/lib/recording/diarization-types";

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

const PLAYBACK_SPEEDS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
const WAVEFORM_BARS = 60;
const generateWaveform = () =>
  Array.from({ length: WAVEFORM_BARS }, () => 0.1 + Math.random() * 0.9);

const SENTIMENT_CONFIG: Record<SentimentLabel, { icon: string; color: string; label: string }> = {
  positive: { icon: "checkmark.circle.fill", color: "#22C55E", label: "Positive" },
  neutral: { icon: "info.circle", color: "#6B7280", label: "Neutral" },
  negative: { icon: "exclamationmark.triangle.fill", color: "#EF4444", label: "Negative" },
  mixed: { icon: "arrow.right.arrow.left", color: "#F59E0B", label: "Mixed" },
};

const URGENCY_CONFIG: Record<UrgencyLevel, { color: string; bgColor: string }> = {
  high: { color: "#EF4444", bgColor: "#EF444415" },
  medium: { color: "#F59E0B", bgColor: "#F59E0B15" },
  low: { color: "#22C55E", bgColor: "#22C55E15" },
};

export default function RecordingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const colors = useColors();
  const waveform = useRef(generateWaveform()).current;
  const [showNotes, setShowNotes] = useState(false);
  const [notes, setNotes] = useState("");

  // Speaker correction modal state
  const [editSpeakerModal, setEditSpeakerModal] = useState<{ speakerId: string; currentLabel: string; currentName: string } | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editName, setEditName] = useState("");
  const [reassignModal, setReassignModal] = useState<{ segmentIndex: number; currentSpeakerId: string } | null>(null);

  const {
    recordings,
    playback,
    startPlayback,
    stopPlayback,
    togglePlayPause,
    seekTo,
    setPlaybackSpeed,
    toggleStar,
    deleteRecording,
    analyzeRecording,
    getAnalysis,
    analysisStatus,
    toggleActionItem,
    diarizeRecording,
    getDiarization,
    diarizationStatus,
    renameSpeaker,
    reassignSegment,
  } = useRecordingStore();

  const recording = recordings.find((r) => r.id === id);
  const analysis = id ? getAnalysis(id) : null;
  const currentAnalysisStatus = id ? analysisStatus[id] : undefined;
  const isAnalyzing = currentAnalysisStatus === "analyzing";
  const diarization = id ? getDiarization(id) : null;
  const currentDiarizationStatus = id ? diarizationStatus[id] : undefined;
  const isDiarizing = currentDiarizationStatus === "processing";

  // Auto-analyze when screen opens if transcript exists and no analysis yet
  useEffect(() => {
    if (recording?.transcription && !analysis && currentAnalysisStatus !== "analyzing" && currentAnalysisStatus !== "failed") {
      analyzeRecording(recording);
    }
  }, [recording?.id]);

  // Auto-diarize when screen opens if transcript exists and no diarization yet
  useEffect(() => {
    if (recording?.transcription && !diarization && currentDiarizationStatus !== "processing" && currentDiarizationStatus !== "failed") {
      diarizeRecording(recording);
    }
  }, [recording?.id]);

  // Simulate playback progress
  useEffect(() => {
    if (!playback.isPlaying || playback.recordingId !== id) return;
    const interval = setInterval(() => {
      const store = useRecordingStore.getState();
      const newPos = store.playback.currentPosition + store.playback.playbackSpeed;
      if (newPos >= store.playback.duration) {
        store.stopPlayback();
      } else {
        store.updatePosition(newPos);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [playback.isPlaying, playback.recordingId, id]);

  if (!recording) {
    return (
      <ScreenContainer edges={["top", "bottom", "left", "right"]} className="p-6">
        <View style={styles.centered}>
          <Text style={[styles.errorText, { color: colors.muted }]}>Recording not found</Text>
          <TouchableOpacity onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: colors.primary }]}>
            <Text style={styles.backBtnText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </ScreenContainer>
    );
  }

  const isCurrentlyPlaying = playback.recordingId === id;
  const progress = isCurrentlyPlaying ? playback.currentPosition / playback.duration : 0;
  const currentBarIndex = Math.floor(progress * WAVEFORM_BARS);

  const handlePlayPause = () => {
    if (isCurrentlyPlaying) {
      togglePlayPause();
    } else {
      startPlayback(recording);
    }
  };

  const handleSeek = (barIndex: number) => {
    const position = (barIndex / WAVEFORM_BARS) * recording.duration;
    if (!isCurrentlyPlaying) startPlayback(recording);
    seekTo(position);
  };

  const handleSpeedCycle = () => {
    const currentSpeed = isCurrentlyPlaying ? playback.playbackSpeed : 1.0;
    const idx = PLAYBACK_SPEEDS.indexOf(currentSpeed);
    const nextSpeed = PLAYBACK_SPEEDS[(idx + 1) % PLAYBACK_SPEEDS.length];
    setPlaybackSpeed(nextSpeed);
  };

  const handleShare = async () => {
    try {
      let shareText = `Call Recording: ${recording.callerName} \u2194 ${recording.calleeName}\nDate: ${formatDate(recording.startedAt)}\nDuration: ${formatDuration(recording.duration)}`;
      if (analysis) {
        shareText += `\n\nSummary: ${analysis.summary}`;
        if (analysis.actionItems.length > 0) {
          shareText += `\n\nAction Items:\n${analysis.actionItems.map((a, i) => `${i + 1}. ${a.task} (${a.assignee})`).join("\n")}`;
        }
      }
      await Share.share({ message: shareText });
    } catch (e) {}
  };

  const handleDelete = () => {
    Alert.alert("Delete Recording", "This recording will be permanently deleted.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await deleteRecording(recording.id);
          router.back();
        },
      },
    ]);
  };

  const handleReanalyze = () => {
    if (recording.transcription) {
      analyzeRecording(recording);
    }
  };

  const handleSpeakerTap = (speaker: Speaker) => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditLabel(speaker.label);
    setEditName(speaker.name || "");
    setEditSpeakerModal({ speakerId: speaker.id, currentLabel: speaker.label, currentName: speaker.name || "" });
  };

  const handleSaveSpeakerLabel = () => {
    if (!editSpeakerModal || !id) return;
    const trimLabel = editLabel.trim();
    const trimName = editName.trim();
    if (!trimLabel) return;
    renameSpeaker(id, editSpeakerModal.speakerId, trimLabel, trimName || undefined);
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setEditSpeakerModal(null);
  };

  const handleSegmentLongPress = (segmentIndex: number, currentSpeakerId: string) => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setReassignModal({ segmentIndex, currentSpeakerId });
  };

  const handleReassignSegment = (toSpeakerId: string) => {
    if (!reassignModal || !id) return;
    reassignSegment(id, reassignModal.segmentIndex, toSpeakerId);
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setReassignModal(null);
  };

  const directionIcon = recording.direction === "inbound"
    ? "phone.arrow.down.left"
    : recording.direction === "outbound"
    ? "phone.arrow.up.right"
    : "person.3.fill";

  const directionLabel = recording.direction === "inbound"
    ? "Inbound Call"
    : recording.direction === "outbound"
    ? "Outbound Call"
    : "Conference";

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
          <IconSymbol name="chevron.left" size={22} color={colors.primary} />
          <Text style={[styles.headerBtnText, { color: colors.primary }]}>Back</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Recording</Text>
        <TouchableOpacity onPress={() => toggleStar(recording.id)} style={styles.headerBtn}>
          <IconSymbol
            name="star.fill"
            size={22}
            color={recording.isStarred ? "#FFB800" : colors.muted}
          />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Call Info Card */}
        <View style={[styles.infoCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.avatarLarge, { backgroundColor: colors.primary + "20" }]}>
            <Text style={[styles.avatarText, { color: colors.primary }]}>
              {(recording.direction === "inbound" ? recording.callerName : recording.calleeName).charAt(0)}
            </Text>
          </View>
          <Text style={[styles.contactName, { color: colors.foreground }]}>
            {recording.direction === "inbound" ? recording.callerName : recording.calleeName}
          </Text>
          <Text style={[styles.contactNumber, { color: colors.muted }]}>
            {recording.direction === "inbound" ? recording.callerNumber : recording.calleeNumber}
          </Text>
          <View style={styles.directionRow}>
            <IconSymbol name={directionIcon as any} size={14} color={colors.muted} />
            <Text style={[styles.directionText, { color: colors.muted }]}>{directionLabel}</Text>
          </View>
          <Text style={[styles.dateText, { color: colors.muted }]}>{formatDate(recording.startedAt)}</Text>
        </View>

        {/* Waveform Player */}
        <View style={[styles.playerCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.waveformContainer}>
            {waveform.map((height, i) => (
              <TouchableOpacity
                key={i}
                onPress={() => handleSeek(i)}
                style={styles.waveformBarTouch}
                activeOpacity={0.7}
              >
                <View
                  style={[
                    styles.waveformBar,
                    {
                      height: 4 + height * 40,
                      backgroundColor: i <= currentBarIndex && isCurrentlyPlaying
                        ? colors.primary
                        : colors.border,
                      borderRadius: 2,
                    },
                  ]}
                />
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.timeRow}>
            <Text style={[styles.timeText, { color: colors.muted }]}>
              {isCurrentlyPlaying ? formatDuration(playback.currentPosition) : "0:00"}
            </Text>
            <Text style={[styles.timeText, { color: colors.muted }]}>
              {formatDuration(recording.duration)}
            </Text>
          </View>
          <View style={styles.controlsRow}>
            <TouchableOpacity onPress={handleSpeedCycle} style={[styles.speedBtn, { borderColor: colors.border }]}>
              <Text style={[styles.speedText, { color: colors.foreground }]}>
                {isCurrentlyPlaying ? `${playback.playbackSpeed}x` : "1x"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { if (isCurrentlyPlaying) seekTo(Math.max(0, playback.currentPosition - 15)); }}
              style={styles.skipBtn}
            >
              <IconSymbol name="arrow.clockwise" size={18} color={colors.muted} />
              <Text style={[styles.skipText, { color: colors.muted }]}>-15s</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handlePlayPause}
              style={[styles.playBtn, { backgroundColor: colors.primary }]}
            >
              <IconSymbol
                name={isCurrentlyPlaying && playback.isPlaying ? "pause.fill" : "play.fill"}
                size={28}
                color="#fff"
              />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { if (isCurrentlyPlaying) seekTo(Math.min(playback.duration, playback.currentPosition + 15)); }}
              style={styles.skipBtn}
            >
              <IconSymbol name="arrow.clockwise" size={18} color={colors.muted} />
              <Text style={[styles.skipText, { color: colors.muted }]}>+15s</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleShare} style={[styles.speedBtn, { borderColor: colors.border }]}>
              <IconSymbol name="paperplane.fill" size={18} color={colors.foreground} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ═══════════════════════════════════════════════════ */}
        {/* AI INSIGHTS SECTION                                */}
        {/* ═══════════════════════════════════════════════════ */}
        {recording.transcription && (
          <View style={[styles.aiInsightsCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {/* AI Insights Header */}
            <View style={styles.aiInsightsHeader}>
              <View style={styles.aiInsightsTitleRow}>
                <View style={[styles.aiIconCircle, { backgroundColor: colors.primary + "15" }]}>
                  <IconSymbol name="waveform" size={16} color={colors.primary} />
                </View>
                <Text style={[styles.aiInsightsTitle, { color: colors.foreground }]}>AI Insights</Text>
                <View style={[styles.aiBadge, { backgroundColor: colors.primary + "15" }]}>
                  <Text style={[styles.aiBadgeText, { color: colors.primary }]}>AI</Text>
                </View>
              </View>
              {analysis && !isAnalyzing && (
                <TouchableOpacity onPress={handleReanalyze} style={styles.reanalyzeBtn}>
                  <IconSymbol name="arrow.clockwise" size={14} color={colors.muted} />
                </TouchableOpacity>
              )}
            </View>

            {/* Loading State */}
            {isAnalyzing && (
              <View style={styles.analyzingContainer}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={[styles.analyzingText, { color: colors.muted }]}>
                  Analyzing transcript...
                </Text>
              </View>
            )}

            {/* Failed State */}
            {currentAnalysisStatus === "failed" && !analysis && (
              <View style={styles.failedContainer}>
                <IconSymbol name="exclamationmark.triangle.fill" size={20} color={colors.error} />
                <Text style={[styles.failedText, { color: colors.muted }]}>
                  Analysis failed. Tap to retry.
                </Text>
                <TouchableOpacity
                  onPress={handleReanalyze}
                  style={[styles.retryBtn, { backgroundColor: colors.primary }]}
                >
                  <Text style={styles.retryBtnText}>Retry</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Analysis Results */}
            {analysis && (
              <View style={styles.analysisContent}>
                {/* Summary */}
                <View style={styles.aiSection}>
                  <Text style={[styles.aiSectionLabel, { color: colors.muted }]}>SUMMARY</Text>
                  <Text style={[styles.summaryText, { color: colors.foreground }]}>
                    {analysis.summary}
                  </Text>
                </View>

                {/* Sentiment & Category Row */}
                <View style={styles.sentimentCategoryRow}>
                  <View style={[styles.sentimentChip, { backgroundColor: SENTIMENT_CONFIG[analysis.sentiment].color + "15" }]}>
                    <IconSymbol
                      name={SENTIMENT_CONFIG[analysis.sentiment].icon as any}
                      size={14}
                      color={SENTIMENT_CONFIG[analysis.sentiment].color}
                    />
                    <Text style={[styles.sentimentText, { color: SENTIMENT_CONFIG[analysis.sentiment].color }]}>
                      {SENTIMENT_CONFIG[analysis.sentiment].label}
                    </Text>
                    <Text style={[styles.sentimentScore, { color: SENTIMENT_CONFIG[analysis.sentiment].color }]}>
                      {analysis.sentimentScore > 0 ? "+" : ""}{analysis.sentimentScore.toFixed(1)}
                    </Text>
                  </View>
                  <View style={[styles.categoryChip, { backgroundColor: colors.primary + "10" }]}>
                    <Text style={[styles.categoryText, { color: colors.primary }]}>
                      {analysis.category}
                    </Text>
                  </View>
                  <View style={[styles.categoryChip, { backgroundColor: colors.muted + "15" }]}>
                    <Text style={[styles.categoryText, { color: colors.muted }]}>
                      {analysis.language.toUpperCase()}
                    </Text>
                  </View>
                </View>

                {/* Topics */}
                {analysis.topics.length > 0 && (
                  <View style={styles.aiSection}>
                    <Text style={[styles.aiSectionLabel, { color: colors.muted }]}>TOPICS</Text>
                    <View style={styles.topicsContainer}>
                      {analysis.topics.map((topic, i) => (
                        <View key={i} style={[styles.topicCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
                          <View style={styles.topicHeader}>
                            <Text style={[styles.topicLabel, { color: colors.foreground }]}>
                              {topic.label}
                            </Text>
                            <View style={[styles.confidenceBadge, { backgroundColor: colors.primary + "15" }]}>
                              <Text style={[styles.confidenceText, { color: colors.primary }]}>
                                {topic.confidence}%
                              </Text>
                            </View>
                          </View>
                          {/* Confidence bar */}
                          <View style={[styles.confidenceBarBg, { backgroundColor: colors.border }]}>
                            <View
                              style={[
                                styles.confidenceBarFill,
                                {
                                  backgroundColor: colors.primary,
                                  width: `${topic.confidence}%`,
                                },
                              ]}
                            />
                          </View>
                          <Text style={[styles.topicDesc, { color: colors.muted }]} numberOfLines={2}>
                            {topic.description}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}

                {/* Key Points */}
                {analysis.keyPoints.length > 0 && (
                  <View style={styles.aiSection}>
                    <Text style={[styles.aiSectionLabel, { color: colors.muted }]}>KEY POINTS</Text>
                    {analysis.keyPoints.map((point, i) => (
                      <View key={i} style={[styles.keyPointRow, { borderLeftColor: colors.primary }]}>
                        <View style={styles.keyPointContent}>
                          <Text style={[styles.keyPointText, { color: colors.foreground }]}>
                            {point.text}
                          </Text>
                          <Text style={[styles.keyPointSpeaker, { color: colors.muted }]}>
                            — {point.speaker === "caller" ? recording.callerName : point.speaker === "callee" ? recording.calleeName : "Unknown"}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}

                {/* Action Items */}
                {analysis.actionItems.length > 0 && (
                  <View style={styles.aiSection}>
                    <Text style={[styles.aiSectionLabel, { color: colors.muted }]}>ACTION ITEMS</Text>
                    {analysis.actionItems.map((item, i) => {
                      const urgencyConf = URGENCY_CONFIG[item.urgency];
                      return (
                        <TouchableOpacity
                          key={i}
                          onPress={() => toggleActionItem(recording.id, i)}
                          style={[styles.actionItemRow, { backgroundColor: colors.background, borderColor: colors.border }]}
                          activeOpacity={0.7}
                        >
                          <View style={[styles.actionCheckbox, {
                            backgroundColor: item.completed ? colors.primary : "transparent",
                            borderColor: item.completed ? colors.primary : colors.border,
                          }]}>
                            {item.completed && (
                              <IconSymbol name="checkmark" size={12} color="#fff" />
                            )}
                          </View>
                          <View style={styles.actionItemContent}>
                            <Text
                              style={[
                                styles.actionItemTask,
                                { color: colors.foreground },
                                item.completed && styles.actionItemCompleted,
                              ]}
                            >
                              {item.task}
                            </Text>
                            <View style={styles.actionItemMeta}>
                              <Text style={[styles.actionItemAssignee, { color: colors.muted }]}>
                                {item.assignee}
                              </Text>
                              <View style={[styles.urgencyBadge, { backgroundColor: urgencyConf.bgColor }]}>
                                <Text style={[styles.urgencyText, { color: urgencyConf.color }]}>
                                  {item.urgency.toUpperCase()}
                                </Text>
                              </View>
                            </View>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </View>
            )}
          </View>
        )}

        {/* Details */}
        <View style={[styles.detailsCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Details</Text>
          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: colors.muted }]}>Duration</Text>
            <Text style={[styles.detailValue, { color: colors.foreground }]}>{formatDuration(recording.duration)}</Text>
          </View>
          <View style={[styles.detailDivider, { backgroundColor: colors.border }]} />
          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: colors.muted }]}>File Size</Text>
            <Text style={[styles.detailValue, { color: colors.foreground }]}>{formatFileSize(recording.fileSize)}</Text>
          </View>
          <View style={[styles.detailDivider, { backgroundColor: colors.border }]} />
          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: colors.muted }]}>Format</Text>
            <Text style={[styles.detailValue, { color: colors.foreground }]}>{recording.format.toUpperCase()}</Text>
          </View>
          <View style={[styles.detailDivider, { backgroundColor: colors.border }]} />
          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: colors.muted }]}>From</Text>
            <Text style={[styles.detailValue, { color: colors.foreground }]}>{recording.callerName} ({recording.callerNumber})</Text>
          </View>
          <View style={[styles.detailDivider, { backgroundColor: colors.border }]} />
          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: colors.muted }]}>To</Text>
            <Text style={[styles.detailValue, { color: colors.foreground }]}>{recording.calleeName} ({recording.calleeNumber})</Text>
          </View>
          {recording.tags.length > 0 && (
            <>
              <View style={[styles.detailDivider, { backgroundColor: colors.border }]} />
              <View style={styles.detailRow}>
                <Text style={[styles.detailLabel, { color: colors.muted }]}>Tags</Text>
                <View style={styles.tagsRow}>
                  {recording.tags.map((tag) => (
                    <View key={tag} style={[styles.tag, { backgroundColor: colors.primary + "15" }]}>
                      <Text style={[styles.tagText, { color: colors.primary }]}>{tag}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </>
          )}
        </View>

        {/* Speaker Diarization / Transcription */}
        {recording.transcription && (
          <View style={[styles.detailsCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.sectionHeader}>
              <View style={styles.diarTitleRow}>
                <IconSymbol name="person.2.fill" size={16} color={colors.primary} />
                <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 0 }]}>Speaker Transcript</Text>
              </View>
              {diarization && (
                <View style={[styles.diarBadge, { backgroundColor: colors.primary + "15" }]}>
                  <Text style={[styles.diarBadgeText, { color: colors.primary }]}>
                    {diarization.speakers.length} speakers
                  </Text>
                </View>
              )}
            </View>

            {/* Diarization Loading */}
            {isDiarizing && (
              <View style={styles.analyzingContainer}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={[styles.analyzingText, { color: colors.muted }]}>Identifying speakers...</Text>
              </View>
            )}

            {/* Speaker Stats — tap to rename */}
            {diarization && diarization.speakers.length > 0 && (
              <View style={styles.speakerStatsContainer}>
                {diarization.speakers.map((speaker) => (
                  <TouchableOpacity
                    key={speaker.id}
                    style={[styles.speakerStatRow, { borderLeftColor: speaker.color }]}
                    onPress={() => handleSpeakerTap(speaker)}
                    activeOpacity={0.6}
                  >
                    <View style={styles.speakerStatInfo}>
                      <View style={[styles.speakerDot, { backgroundColor: speaker.color }]} />
                      <Text style={[styles.speakerStatName, { color: colors.foreground }]}>
                        {speaker.name || speaker.label}
                      </Text>
                      <Text style={[styles.speakerStatLabel, { color: colors.muted }]}>
                        ({speaker.label})
                      </Text>
                      <IconSymbol name="chevron.right" size={12} color={colors.muted} />
                    </View>
                    <View style={styles.speakerStatBar}>
                      <View style={[styles.speakerStatBarBg, { backgroundColor: colors.border }]}>
                        <View style={[
                          styles.speakerStatBarFill,
                          { backgroundColor: speaker.color, width: `${speaker.talkPercentage}%` },
                        ]} />
                      </View>
                      <Text style={[styles.speakerStatPct, { color: colors.muted }]}>
                        {speaker.talkPercentage}%
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
                <Text style={[styles.editHint, { color: colors.muted }]}>Tap speaker to rename · Long-press bubble to reassign</Text>
                <View style={styles.diarMetaRow}>
                  <Text style={[styles.diarMetaText, { color: colors.muted }]}>
                    {diarization.turnCount} turns
                  </Text>
                  <Text style={[styles.diarMetaText, { color: colors.muted }]}>
                    {diarization.overlapPercentage}% overlap
                  </Text>
                  <Text style={[styles.diarMetaText, { color: colors.muted }]}>
                    avg {diarization.averageSegmentDuration}s/segment
                  </Text>
                </View>
              </View>
            )}

            {/* Diarized Segments (Chat Bubbles) — long-press to reassign */}
            {diarization && diarization.segments.length > 0 ? (
              <View style={styles.segmentsContainer}>
                {diarization.segments.map((seg) => {
                  const speaker = diarization.speakers.find((s) => s.id === seg.speakerId);
                  const isLeft = seg.speakerId === "speaker_0";
                  return (
                    <TouchableOpacity
                      key={seg.index}
                      onLongPress={() => handleSegmentLongPress(seg.index, seg.speakerId)}
                      activeOpacity={0.7}
                      delayLongPress={400}
                      style={[
                        styles.segmentBubbleRow,
                        isLeft ? styles.segmentBubbleLeft : styles.segmentBubbleRight,
                      ]}
                    >
                      <View
                        style={[
                          styles.segmentBubble,
                          {
                            backgroundColor: (speaker?.color || colors.primary) + "12",
                            borderLeftColor: isLeft ? (speaker?.color || colors.primary) : "transparent",
                            borderRightColor: !isLeft ? (speaker?.color || colors.primary) : "transparent",
                            borderLeftWidth: isLeft ? 3 : 0,
                            borderRightWidth: !isLeft ? 3 : 0,
                          },
                        ]}
                      >
                        <View style={styles.segmentHeader}>
                          <Text style={[styles.segmentSpeaker, { color: speaker?.color || colors.primary }]}>
                            {speaker?.name || speaker?.label || "Unknown"}
                          </Text>
                          <Text style={[styles.segmentTime, { color: colors.muted }]}>
                            {formatDuration(seg.startTime)}
                          </Text>
                        </View>
                        <Text style={[styles.segmentText, { color: colors.foreground }]}>
                          {seg.text}
                        </Text>
                        <View style={styles.segmentFooter}>
                          <View style={[styles.confidencePill, { backgroundColor: colors.border }]}>
                            <Text style={[styles.confidenceLabel, { color: colors.muted }]}>
                              {Math.round(seg.confidence * 100)}% conf
                            </Text>
                          </View>
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : !isDiarizing ? (
              <Text style={[styles.transcriptionText, { color: colors.foreground }]}>
                {recording.transcription}
              </Text>
            ) : null}
          </View>
        )}

        {/* Notes */}
        <View style={[styles.detailsCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <TouchableOpacity onPress={() => setShowNotes(!showNotes)} style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Notes</Text>
            <IconSymbol name="chevron.right" size={16} color={colors.muted} />
          </TouchableOpacity>
          {showNotes && (
            <TextInput
              value={notes || recording.notes || ""}
              onChangeText={setNotes}
              placeholder="Add notes about this recording..."
              placeholderTextColor={colors.muted}
              multiline
              style={[styles.notesInput, { color: colors.foreground, borderColor: colors.border }]}
            />
          )}
        </View>

        {/* Actions */}
        <View style={styles.actionsRow}>
          <TouchableOpacity style={[styles.actionBtnBottom, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <IconSymbol name="arrow.down.circle.fill" size={20} color={colors.primary} />
            <Text style={[styles.actionBtnText, { color: colors.primary }]}>Download</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleDelete}
            style={[styles.actionBtnBottom, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <IconSymbol name="xmark.circle.fill" size={20} color={colors.error} />
            <Text style={[styles.actionBtnText, { color: colors.error }]}>Delete</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* ═══ Rename Speaker Modal ═══ */}
      <Modal
        visible={!!editSpeakerModal}
        transparent
        animationType="fade"
        onRequestClose={() => setEditSpeakerModal(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Edit Speaker</Text>
            <Text style={[styles.modalSubtitle, { color: colors.muted }]}>
              Rename "{editSpeakerModal?.currentLabel}" to correct the speaker identification.
            </Text>
            <Text style={[styles.modalFieldLabel, { color: colors.muted }]}>Label (e.g. Caller, Agent)</Text>
            <TextInput
              value={editLabel}
              onChangeText={setEditLabel}
              placeholder="Speaker label"
              placeholderTextColor={colors.muted}
              style={[styles.modalInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
              returnKeyType="next"
              autoFocus
            />
            <Text style={[styles.modalFieldLabel, { color: colors.muted }]}>Name (optional)</Text>
            <TextInput
              value={editName}
              onChangeText={setEditName}
              placeholder="Contact name"
              placeholderTextColor={colors.muted}
              style={[styles.modalInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
              returnKeyType="done"
              onSubmitEditing={handleSaveSpeakerLabel}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                onPress={() => setEditSpeakerModal(null)}
                style={[styles.modalBtn, { backgroundColor: colors.border }]}
              >
                <Text style={[styles.modalBtnText, { color: colors.foreground }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSaveSpeakerLabel}
                style={[styles.modalBtn, { backgroundColor: colors.primary }]}
              >
                <Text style={[styles.modalBtnText, { color: "#fff" }]}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ═══ Reassign Segment Modal ═══ */}
      <Modal
        visible={!!reassignModal}
        transparent
        animationType="fade"
        onRequestClose={() => setReassignModal(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Reassign Segment</Text>
            <Text style={[styles.modalSubtitle, { color: colors.muted }]}>
              Move this segment to a different speaker.
            </Text>
            {diarization?.speakers.map((sp) => {
              const isCurrent = sp.id === reassignModal?.currentSpeakerId;
              return (
                <TouchableOpacity
                  key={sp.id}
                  onPress={() => !isCurrent && handleReassignSegment(sp.id)}
                  style={[
                    styles.reassignRow,
                    { borderColor: isCurrent ? sp.color : colors.border, backgroundColor: isCurrent ? sp.color + "10" : colors.background },
                  ]}
                  activeOpacity={isCurrent ? 1 : 0.6}
                >
                  <View style={[styles.speakerDot, { backgroundColor: sp.color }]} />
                  <Text style={[styles.reassignLabel, { color: colors.foreground }]}>
                    {sp.name || sp.label}
                  </Text>
                  {isCurrent && (
                    <Text style={[styles.reassignCurrent, { color: colors.muted }]}>Current</Text>
                  )}
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity
              onPress={() => setReassignModal(null)}
              style={[styles.modalBtn, { backgroundColor: colors.border, marginTop: 12, alignSelf: "stretch" }]}
            >
              <Text style={[styles.modalBtnText, { color: colors.foreground }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
  },
  headerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    padding: 4,
  },
  headerBtnText: { fontSize: 16 },
  headerTitle: { fontSize: 17, fontWeight: "600" },
  content: { padding: 16, gap: 16 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16 },
  errorText: { fontSize: 16 },
  backBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 },
  backBtnText: { color: "#fff", fontWeight: "600" },

  // Info Card
  infoCard: {
    alignItems: "center",
    padding: 20,
    borderRadius: 16,
    borderWidth: 0.5,
    gap: 6,
  },
  avatarLarge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  avatarText: { fontSize: 26, fontWeight: "700" },
  contactName: { fontSize: 20, fontWeight: "700" },
  contactNumber: { fontSize: 14 },
  directionRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  directionText: { fontSize: 13 },
  dateText: { fontSize: 12, marginTop: 2 },

  // Player Card
  playerCard: {
    padding: 20,
    borderRadius: 16,
    borderWidth: 0.5,
  },
  waveformContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    height: 48,
    marginBottom: 8,
  },
  waveformBarTouch: {
    flex: 1,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  waveformBar: { width: 3 },
  timeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  timeText: { fontSize: 12, fontVariant: ["tabular-nums"] },
  controlsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  speedBtn: {
    width: 44,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  speedText: { fontSize: 13, fontWeight: "600" },
  skipBtn: {
    alignItems: "center",
    justifyContent: "center",
    width: 44,
    gap: 2,
  },
  skipText: { fontSize: 10, fontWeight: "600" },
  playBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
  },

  // ═══════════════════════════════════════
  // AI INSIGHTS STYLES
  // ═══════════════════════════════════════
  aiInsightsCard: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 0.5,
  },
  aiInsightsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  aiInsightsTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  aiIconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  aiInsightsTitle: {
    fontSize: 17,
    fontWeight: "700",
  },
  aiBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  aiBadgeText: { fontSize: 11, fontWeight: "700" },
  reanalyzeBtn: { padding: 8 },

  // Loading / Failed
  analyzingContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 24,
  },
  analyzingText: { fontSize: 14 },
  failedContainer: {
    alignItems: "center",
    gap: 8,
    paddingVertical: 16,
  },
  failedText: { fontSize: 14 },
  retryBtn: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 8,
    marginTop: 4,
  },
  retryBtnText: { color: "#fff", fontWeight: "600", fontSize: 14 },

  // Analysis Content
  analysisContent: { gap: 20 },
  aiSection: { gap: 8 },
  aiSectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
  },

  // Summary
  summaryText: {
    fontSize: 14,
    lineHeight: 22,
  },

  // Sentiment & Category
  sentimentCategoryRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  sentimentChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
  },
  sentimentText: { fontSize: 13, fontWeight: "600" },
  sentimentScore: { fontSize: 12, fontWeight: "500" },
  categoryChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
  },
  categoryText: { fontSize: 13, fontWeight: "600" },

  // Topics
  topicsContainer: { gap: 8 },
  topicCard: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 0.5,
    gap: 6,
  },
  topicHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  topicLabel: { fontSize: 14, fontWeight: "600" },
  confidenceBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  confidenceText: { fontSize: 11, fontWeight: "700" },
  confidenceBarBg: {
    height: 4,
    borderRadius: 2,
    overflow: "hidden",
  },
  confidenceBarFill: {
    height: 4,
    borderRadius: 2,
  },
  topicDesc: { fontSize: 12, lineHeight: 18 },

  // Key Points
  keyPointRow: {
    borderLeftWidth: 3,
    paddingLeft: 12,
    paddingVertical: 6,
  },
  keyPointContent: { gap: 2 },
  keyPointText: { fontSize: 14, lineHeight: 20 },
  keyPointSpeaker: { fontSize: 12, fontStyle: "italic" },

  // Action Items
  actionItemRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 12,
    borderRadius: 10,
    borderWidth: 0.5,
    marginBottom: 6,
  },
  actionCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  actionItemContent: { flex: 1, gap: 4 },
  actionItemTask: { fontSize: 14, lineHeight: 20 },
  actionItemCompleted: {
    textDecorationLine: "line-through",
    opacity: 0.5,
  },
  actionItemMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  actionItemAssignee: { fontSize: 12 },
  urgencyBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  urgencyText: { fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },

  // ═══════════════════════════════════════
  // EXISTING STYLES
  // ═══════════════════════════════════════
  detailsCard: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 0.5,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: { fontSize: 16, fontWeight: "700", marginBottom: 12 },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
  },
  detailLabel: { fontSize: 14 },
  detailValue: { fontSize: 14, fontWeight: "500", flexShrink: 1, textAlign: "right", maxWidth: "60%" },
  detailDivider: { height: 0.5 },
  tagsRow: { flexDirection: "row", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" },
  tag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  tagText: { fontSize: 12, fontWeight: "600" },

  transcriptionText: { fontSize: 14, lineHeight: 22 },

  // ═══════════════════════════════════════
  // SPEAKER DIARIZATION STYLES
  // ═══════════════════════════════════════
  diarTitleRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
  },
  diarBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  diarBadgeText: { fontSize: 12, fontWeight: "600" as const },
  speakerStatsContainer: {
    marginTop: 12,
    marginBottom: 16,
    gap: 10,
  },
  speakerStatRow: {
    borderLeftWidth: 3,
    paddingLeft: 12,
    gap: 4,
  },
  speakerStatInfo: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
  },
  speakerDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  speakerStatName: { fontSize: 14, fontWeight: "600" as const },
  speakerStatLabel: { fontSize: 12 },
  speakerStatBar: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    marginTop: 2,
  },
  speakerStatBarBg: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    overflow: "hidden" as const,
  },
  speakerStatBarFill: {
    height: 6,
    borderRadius: 3,
  },
  speakerStatPct: { fontSize: 12, fontWeight: "600" as const, width: 36, textAlign: "right" as const },
  diarMetaRow: {
    flexDirection: "row" as const,
    gap: 12,
    paddingTop: 8,
    borderTopWidth: 0.5,
    borderTopColor: "#E5E7EB",
  },
  diarMetaText: { fontSize: 11, fontWeight: "500" as const },
  segmentsContainer: {
    gap: 8,
    marginTop: 8,
  },
  segmentBubbleRow: {
    flexDirection: "row" as const,
    paddingHorizontal: 4,
  },
  segmentBubbleLeft: {
    justifyContent: "flex-start" as const,
    paddingRight: 40,
  },
  segmentBubbleRight: {
    justifyContent: "flex-end" as const,
    paddingLeft: 40,
  },
  segmentBubble: {
    flex: 1,
    padding: 12,
    borderRadius: 12,
  },
  segmentHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    marginBottom: 4,
  },
  segmentSpeaker: { fontSize: 12, fontWeight: "700" as const },
  segmentTime: { fontSize: 10, fontVariant: ["tabular-nums" as const] },
  segmentText: { fontSize: 14, lineHeight: 21 },
  segmentFooter: {
    flexDirection: "row" as const,
    justifyContent: "flex-end" as const,
    marginTop: 4,
  },
  confidencePill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  confidenceLabel: { fontSize: 9, fontWeight: "600" as const },

  notesInput: {
    marginTop: 8,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    minHeight: 80,
    textAlignVertical: "top",
  },

  actionsRow: {
    flexDirection: "row",
    gap: 12,
  },
  actionBtnBottom: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 0.5,
  },
  actionBtnText: { fontSize: 15, fontWeight: "600" },

  // ═══════════════════════════════════════
  // SPEAKER CORRECTION MODAL STYLES
  // ═══════════════════════════════════════
  editHint: {
    fontSize: 11,
    fontStyle: "italic" as const,
    textAlign: "center" as const,
    marginTop: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center" as const,
    alignItems: "center" as const,
    padding: 24,
  },
  modalCard: {
    width: "100%" as any,
    maxWidth: 360,
    borderRadius: 20,
    padding: 24,
    gap: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700" as const,
    textAlign: "center" as const,
  },
  modalSubtitle: {
    fontSize: 13,
    textAlign: "center" as const,
    marginBottom: 8,
    lineHeight: 19,
  },
  modalFieldLabel: {
    fontSize: 12,
    fontWeight: "600" as const,
    marginTop: 4,
    marginBottom: 2,
  },
  modalInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
  },
  modalActions: {
    flexDirection: "row" as const,
    gap: 10,
    marginTop: 16,
  },
  modalBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  modalBtnText: {
    fontSize: 15,
    fontWeight: "600" as const,
  },
  reassignRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 6,
  },
  reassignLabel: {
    fontSize: 15,
    fontWeight: "500" as const,
    flex: 1,
  },
  reassignCurrent: {
    fontSize: 12,
    fontWeight: "600" as const,
  },
});
