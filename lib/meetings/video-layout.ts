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
