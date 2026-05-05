/**
 * AI Transcript Analysis Engine (Client-Side)
 *
 * Calls the server-side tRPC endpoint for LLM-powered transcript analysis.
 * Falls back to mock analysis when the server is unavailable.
 */

import type {
  CallAnalysis,
  AnalyzeTranscriptRequest,
  SentimentLabel,
  CallTopic,
  KeyPoint,
  ActionItem,
} from "./ai-types";

class AiAnalysisEngine {
  private serverUrl: string = "";
  private cache: Map<string, CallAnalysis> = new Map();

  /**
   * Set the tRPC server URL for API calls
   */
  setServerUrl(url: string) {
    this.serverUrl = url;
  }

  /**
   * Get cached analysis for a recording
   */
  getCached(recordingId: string): CallAnalysis | null {
    return this.cache.get(recordingId) || null;
  }

  /**
   * Analyze a call transcript using the server-side LLM
   */
  async analyzeTranscript(request: AnalyzeTranscriptRequest): Promise<CallAnalysis> {
    // Check cache first
    const cached = this.cache.get(request.recordingId);
    if (cached && cached.status === "completed") {
      return cached;
    }

    try {
      // Try server-side analysis via tRPC
      const response = await fetch(`${this.serverUrl}/trpc/recording.analyzeTranscript`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ json: request }),
      });

      if (response.ok) {
        const data = await response.json();
        const result = data?.result?.data?.json || data?.result?.data;

        if (result?.success && result.analysis) {
          const analysis: CallAnalysis = {
            ...result.analysis,
            status: "completed",
            actionItems: result.analysis.actionItems.map((a: any) => ({
              ...a,
              completed: false,
            })),
          };
          this.cache.set(request.recordingId, analysis);
          return analysis;
        }
      }

      // Fall back to mock analysis if server call fails
      console.warn("[AiAnalysisEngine] Server analysis unavailable, using local analysis");
      return this.generateLocalAnalysis(request);
    } catch (error) {
      console.warn("[AiAnalysisEngine] Server unreachable, using local analysis:", error);
      return this.generateLocalAnalysis(request);
    }
  }

  /**
   * Generate a local mock analysis for demo/offline mode.
   * This provides realistic-looking results based on simple keyword matching.
   */
  private generateLocalAnalysis(request: AnalyzeTranscriptRequest): CallAnalysis {
    const { recordingId, transcription, callerName, calleeName, direction, duration } = request;
    const text = transcription.toLowerCase();

    // Simple keyword-based topic extraction
    const topics: CallTopic[] = [];
    const topicKeywords: Record<string, string[]> = {
      "Billing & Payments": ["billing", "invoice", "payment", "charge", "price", "cost", "fee", "balance"],
      "Account Management": ["account", "profile", "update", "change", "address", "email", "password"],
      "Technical Support": ["issue", "problem", "error", "fix", "troubleshoot", "not working", "broken"],
      "Sales Inquiry": ["interested", "demo", "proposal", "pricing", "enterprise", "solution", "purchase"],
      "Meeting Scheduling": ["schedule", "meeting", "conference", "calendar", "week", "available", "time"],
      "Product Discussion": ["feature", "product", "release", "update", "version", "roadmap"],
      "Team Coordination": ["sprint", "standup", "blocker", "progress", "task", "assign"],
      "Customer Onboarding": ["setup", "getting started", "onboard", "welcome", "first time"],
    };

    for (const [topic, keywords] of Object.entries(topicKeywords)) {
      const matchCount = keywords.filter((kw) => text.includes(kw)).length;
      if (matchCount > 0) {
        const confidence = Math.min(95, 50 + matchCount * 15);
        topics.push({
          label: topic,
          confidence,
          description: `Discussion related to ${topic.toLowerCase()} based on ${matchCount} keyword match(es).`,
        });
      }
    }

    // If no topics found, add a generic one
    if (topics.length === 0) {
      topics.push({
        label: "General Discussion",
        confidence: 60,
        description: "General conversation without specific categorized topics.",
      });
    }

    // Sort by confidence
    topics.sort((a, b) => b.confidence - a.confidence);

    // Extract key points from sentences
    const sentences = transcription.split(/[.!?]+/).filter((s) => s.trim().length > 10);
    const keyPoints: KeyPoint[] = sentences.slice(0, Math.min(4, sentences.length)).map((s, i) => ({
      text: s.trim(),
      speaker: i % 2 === 0 ? "caller" : "callee",
    }));

    // Simple sentiment analysis
    const positiveWords = ["great", "thank", "appreciate", "good", "excellent", "happy", "pleased", "wonderful", "helpful"];
    const negativeWords = ["issue", "problem", "frustrated", "disappointed", "complaint", "error", "fail", "wrong", "bad"];
    const posCount = positiveWords.filter((w) => text.includes(w)).length;
    const negCount = negativeWords.filter((w) => text.includes(w)).length;

    let sentiment: SentimentLabel = "neutral";
    let sentimentScore = 0;
    if (posCount > negCount + 1) {
      sentiment = "positive";
      sentimentScore = Math.min(0.9, 0.3 + posCount * 0.15);
    } else if (negCount > posCount + 1) {
      sentiment = "negative";
      sentimentScore = Math.max(-0.9, -0.3 - negCount * 0.15);
    } else if (posCount > 0 && negCount > 0) {
      sentiment = "mixed";
      sentimentScore = (posCount - negCount) * 0.1;
    }

    // Extract action items from action-oriented phrases
    const actionItems: ActionItem[] = [];
    const actionPhrases = [
      { pattern: /need to (\w[\w\s]{5,40})/gi, urgency: "high" as const },
      { pattern: /should (\w[\w\s]{5,40})/gi, urgency: "medium" as const },
      { pattern: /follow up (\w[\w\s]{5,40})/gi, urgency: "medium" as const },
      { pattern: /send (\w[\w\s]{5,40})/gi, urgency: "medium" as const },
      { pattern: /schedule (\w[\w\s]{5,40})/gi, urgency: "low" as const },
      { pattern: /check (\w[\w\s]{5,40})/gi, urgency: "low" as const },
      { pattern: /confirm (\w[\w\s]{5,40})/gi, urgency: "medium" as const },
    ];

    for (const { pattern, urgency } of actionPhrases) {
      let match;
      while ((match = pattern.exec(transcription)) !== null) {
        if (actionItems.length < 5) {
          actionItems.push({
            task: match[0].trim(),
            assignee: calleeName || "Unassigned",
            urgency,
            completed: false,
          });
        }
      }
    }

    // Determine category
    let category = "General";
    if (direction === "conference") category = "Conference";
    else if (topics.some((t) => t.label.includes("Support"))) category = "Support";
    else if (topics.some((t) => t.label.includes("Sales"))) category = "Sales";
    else if (topics.some((t) => t.label.includes("Team") || t.label.includes("Meeting"))) category = "Internal";

    // Generate summary
    const topTopics = topics.slice(0, 2).map((t) => t.label.toLowerCase()).join(" and ");
    const summary = `This ${duration > 300 ? "extended" : "brief"} ${direction} call between ${callerName} and ${calleeName} covered ${topTopics}. ${keyPoints.length > 0 ? keyPoints[0].text + "." : ""} ${actionItems.length > 0 ? `${actionItems.length} action item(s) were identified.` : "No specific action items were identified."}`;

    const analysis: CallAnalysis = {
      recordingId,
      analyzedAt: Date.now(),
      status: "completed",
      summary,
      topics: topics.slice(0, 5),
      keyPoints,
      sentiment,
      sentimentScore,
      actionItems,
      language: "en",
      category,
    };

    this.cache.set(recordingId, analysis);
    return analysis;
  }

  /**
   * Clear cached analysis for a recording
   */
  clearCache(recordingId?: string) {
    if (recordingId) {
      this.cache.delete(recordingId);
    } else {
      this.cache.clear();
    }
  }
}

export const aiAnalysisEngine = new AiAnalysisEngine();
