/** Local presentation only: this never changes membership, subscriptions or host authority. */
export type MeetingVideoLayout = "speaker" | "gallery";
export type MeetingViewChoice = Readonly<{
  room?: object;
  layout: MeetingVideoLayout;
}>;
export type MeetingViewParticipant = Readonly<{
  identity: string;
  local: boolean;
  speaking?: boolean;
}>;

export function meetingViewForRoom(
  choice: MeetingViewChoice,
  room?: object,
): MeetingVideoLayout {
  return room && choice.room === room ? choice.layout : "speaker";
}

/** Keep a simultaneous speaker stable, then prefer a remote speaker over the local preview. */
export function meetingSpeakerIdentity(
  participants: readonly MeetingViewParticipant[],
  previousIdentity?: string,
): string | undefined {
  const remotes = participants.filter((participant) => !participant.local);
  const speaking = remotes.filter(
    (participant) => participant.speaking === true,
  );
  const previousSpeaking = speaking.find(
    (participant) => participant.identity === previousIdentity,
  );
  if (previousSpeaking) return previousSpeaking.identity;
  if (speaking[0]) return speaking[0].identity;
  const previous = remotes.find(
    (participant) => participant.identity === previousIdentity,
  );
  if (previous) return previous.identity;
  return (
    remotes[0]?.identity ??
    participants.find((participant) => participant.local)?.identity
  );
}

/** Preserve every tile and its stable key; only its local display order changes. */
export function orderMeetingVideoTiles<
  T extends { identity: string; screenShare: boolean },
>(tiles: readonly T[], layout: MeetingVideoLayout, speaker?: string): T[] {
  const sharing = tiles.some((tile) => tile.screenShare);
  const priority = (tile: T) =>
    tile.screenShare
      ? 0
      : layout === "speaker" && !sharing && tile.identity === speaker
        ? 1
        : 2;
  return [...tiles].sort((left, right) => priority(left) - priority(right));
}

/** Content-sized stages measure width; use two rows instead of feeding their own height back into capacity. */
export function meetingGalleryColumns(width: number): number {
  const available = Number.isFinite(width) && width > 0 ? width : 360;
  return Math.max(1, Math.min(4, Math.floor((available + 2) / 162)));
}

export function meetingGalleryPage(
  total: number,
  capacity: number,
  requested: number,
) {
  const size = Number.isFinite(capacity)
    ? Math.max(1, Math.floor(capacity))
    : 4;
  const count = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  const pages = Math.max(1, Math.ceil(count / size));
  const wanted = Number.isFinite(requested) ? Math.floor(requested) : 0;
  const index = Math.max(0, Math.min(pages - 1, wanted));
  return { index, pages, start: index * size, end: (index + 1) * size };
}

/** Observe a completed horizontal touch without claiming the parent's vertical scroll responder. */
export function meetingGallerySwipe(
  start: { x: number; y: number; at: number },
  end: { x: number; y: number; at: number },
): -1 | 0 | 1 {
  const dx = end.x - start.x,
    dy = end.y - start.y,
    elapsed = end.at - start.at;
  if (
    ![dx, dy, elapsed].every(Number.isFinite) ||
    elapsed < 0 ||
    elapsed > 1000 ||
    Math.abs(dx) < 64 ||
    Math.abs(dx) < Math.abs(dy) * 1.5
  )
    return 0;
  return dx < 0 ? 1 : -1;
}
