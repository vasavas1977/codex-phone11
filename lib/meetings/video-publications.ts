/** Select only existing video tracks; this never subscribes or starts capture. */
export type MeetingVideoPublication<T> = {
  videoTrack?: T;
  track?: T;
  trackSid?: string;
  source?: string;
  isMuted?: boolean;
  isSubscribed?: boolean;
};

export function meetingVideoPublications<T extends { source?: string }>(
  publications?: ReadonlyMap<string, MeetingVideoPublication<T>>,
): readonly { key: string; track: T; screenShare: boolean }[] {
  const videos: { key: string; track: T; screenShare: boolean }[] = [];
  for (const [publicationKey, publication] of publications ?? []) {
    const track = publication.videoTrack ?? publication.track;
    if (!track || publication.isMuted || publication.isSubscribed === false) continue;
    const source = publication.source ?? track.source ?? "camera";
    videos.push({
      key: `${publication.trackSid || publicationKey}:${source}`,
      track,
      screenShare: source === "screen_share",
    });
  }
  return videos;
}
