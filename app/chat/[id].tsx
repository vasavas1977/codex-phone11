import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ViewToken,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useAuth } from "@/hooks/use-auth";
import { getAuthSnapshot } from "@/lib/_core/auth";
import { chatError, chatDraftKey, type ChatThread } from "@/lib/chat/state";
import { useChatStore } from "@/lib/chat/store";
import {
  formatChatTime,
  type ChatAttachment,
  type ChatAllMention,
  type ChatConversationDetails,
  type ChatMessage,
  type ChatMention,
  type ChatReadReceipt,
} from "@/lib/chat/types";
import { createReadReceiptController, createReadReceiptRequestGuard, createReadReceiptSummaryLoader, READ_RECEIPT_VIEW_AREA_PERCENT } from "@/lib/chat/read-receipts";
import { findMentionTrigger, insertMention, reconcileMentions, selectionAfterEdit, type ComposerSelection, type MentionTrigger } from "@/lib/chat/mentions";
import { insertAllMention, isExactAllMention, reconcileAllMention } from "@/lib/chat/all-mentions";

import { ConversationRail } from "@/components/chat/conversation-rail";
import { PresenceIndicator } from "@/components/chat/presence-indicator";
import { usePresencePolling } from "@/lib/chat/presence-store";
import { useChatTyping } from "@/lib/chat/typing";
import { TypingIndicator } from "@/components/chat/typing-indicator";
import { ChatPeerCall } from "@/components/chat/peer-call";
import { ChatMeetingAction } from "@/components/chat/meeting-action";
import { ChannelMeetingPicker } from "@/components/chat/channel-meeting-picker";
import {
  ProfileAvatar,
  useProfilePhotoCacheScope,
} from "@/components/profile/profile-avatar";
import { useDirectory } from "@/hooks/use-directory";
import { useWorkspaceProfile } from "@/lib/profile/use-workspace-profile";
import {
  ChatAssistantSheet,
  type ChatAssistantMode,
} from "@/components/chat/assistant-sheet";
import { VoiceNote } from "@/components/chat/voice-note";
import { ChatMessageRow } from "@/components/chat/message-row";
import { NewMessagesJump, UnreadMessageDivider } from "@/components/chat/unread-message-indicator";
import { ReadReceiptSheet } from "@/components/chat/read-receipt-sheet";
import { MentionPicker } from "@/components/chat/mention-picker";
import { ConversationDetails } from "@/components/chat/conversation-details";
import { createChatTransport } from "@/lib/chat/transport";
import {
  uploadChatMedia,
  newUploadId,
  type ChatUpload,
} from "@/lib/chat/media-client";
import {
  chatMessageKey,
  emptyLocalArrivalState,
  observeLocalArrivals,
  type LocalArrivalBoundary,
} from "@/lib/chat/local-arrivals";
const messageApi = createChatTransport();
const QUICK_EMOJI = ["👍", "❤️", "😂", "🎉", "🙏", "✅"];

type SafetyCategory = "harassment" | "spam" | "safety" | "other";
type SendAction = {
  owner: { id: number } | null | undefined;
  workspaceId: number;
  roomId: string;
};
type ThreadAction = SendAction & { parentMessageId: string };
type ReceiptScope = { owner: { id: number } | null | undefined; workspaceId: number; roomId: string; threadRootId?: string };
function sameReceiptScope(left: ReceiptScope | null, right: ReceiptScope | null) {
  return !!left && !!right && left.owner === right.owner && left.workspaceId === right.workspaceId &&
    left.roomId === right.roomId && left.threadRootId === right.threadRootId;
}

function dayLabel(timestamp: number) {
  const date = new Date(timestamp);
  return date.toDateString() === new Date().toDateString()
    ? "Today"
    : date.toLocaleDateString([], {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
}

export default function ChatRoomScreen() {
  const params = useLocalSearchParams<{ id: string; tenantId?: string }>();
  const id = typeof params.id === "string" ? params.id : "";
  const tenantId = Number(params.tenantId);
  const colors = useColors();
  const { user } = useAuth({ autoFetch: false });
  const chat = useChatStore();
  const liveScopeRef = useRef<SendAction | null>(null);
  liveScopeRef.current = chat.workspace ? { owner: user, workspaceId: chat.workspace.id, roomId: id } : null;
  const [sendingAction, setSendingAction] = useState<SendAction | null>(null);
  const sendingRef = useRef<SendAction | null>(null);
  const [searchScope, setSearchScope] = useState<SendAction | null>(null);
  const [searchText, setSearchText] = useState("");
  const [searchResult, setSearchResult] = useState<{
    messages: ChatMessage[];
    hasMore: boolean;
  }>({ messages: [], hasMore: false });
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [threadScope, setThreadScope] = useState<ThreadAction | null>(null);
  const threadRequestRef = useRef<ThreadAction | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [messageMenuTarget, setMessageMenuTarget] =
    useState<ChatMessage | null>(null);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [safetyTarget, setSafetyTarget] = useState<ChatMessage | null>(null);
  const [safetyCategory, setSafetyCategory] = useState<SafetyCategory>("spam");
  const [safetyComment, setSafetyComment] = useState("");
  const [safetyConfirm, setSafetyConfirm] = useState<
    "report" | "block" | "unblock" | null
  >(null);
  const [safetyLoading, setSafetyLoading] = useState(false);
  const [safetyError, setSafetyError] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [attachmentOpen, setAttachmentOpen] = useState(false);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [mentionTrigger, setMentionTrigger] = useState<MentionTrigger | null>(null);
  const [mentionLoading, setMentionLoading] = useState(false);
  const [draftMentionState, setDraftMentionState] = useState<{ key: string; items: ChatMention[] }>({ key: "", items: [] });
  const [draftAllMentionState, setDraftAllMentionState] = useState<{ key: string; item?: ChatAllMention }>({ key: "" });
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [details, setDetails] = useState<ChatConversationDetails | null>(null);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [channelMeetingCapability, setChannelMeetingCapability] = useState<{ available: boolean; canStart: boolean; maxSelectedMembers: number } | null>(null);
  const [channelMeetingBusy, setChannelMeetingBusy] = useState(false);
  const [meetingInvitations, setMeetingInvitations] = useState<Awaited<ReturnType<typeof messageApi.channelMeetingInvitations>>>([]);
  const [channelMeetingOpen, setChannelMeetingOpen] = useState(false);
  const [channelMeetingScope, setChannelMeetingScope] = useState<SendAction | null>(null);
  const [channelMeetingMembers, setChannelMeetingMembers] = useState<ChatConversationDetails["members"]>([]);
  const [channelMeetingLoading, setChannelMeetingLoading] = useState(false);
  const [channelMeetingRosterError, setChannelMeetingRosterError] = useState<string | null>(null);
  const [channelMeetingCapabilityLoading, setChannelMeetingCapabilityLoading] = useState(false);
  const [channelMeetingCapabilityError, setChannelMeetingCapabilityError] = useState<string | null>(null);
  const [channelMeetingError, setChannelMeetingError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [editText, setEditText] = useState("");
  const [featureBusy, setFeatureBusy] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);
  const [savedMessages, setSavedMessages] = useState<ChatMessage[]>([]);
  const [newMessages, setNewMessages] = useState(false);
  const [localArrivalBoundary, setLocalArrivalBoundary] = useState<{
    scopeKey: string;
    boundary: LocalArrivalBoundary;
  } | null>(null);
  const [collectionTitle, setCollectionTitle] = useState("Saved messages");
  const [forwardTarget, setForwardTarget] = useState<ChatMessage | null>(null);
  const [aiAvailable, setAiAvailable] = useState(false);
  const [aiMode, setAiMode] = useState<{
    mode: ChatAssistantMode;
    messageId?: string;
  } | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [typingFocused, setTypingFocused] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState === "active");
  const [receiptCountState, setReceiptCountState] = useState<{ scope: ReceiptScope | null; counts: Record<string, number> }>({ scope: null, counts: {} });
  const [receiptTarget, setReceiptTarget] = useState<ChatMessage | null>(null);
  const [receiptRows, setReceiptRows] = useState<ChatReadReceipt[]>([]);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [localPreviews, setLocalPreviews] = useState<Record<string, string>>(
    {},
  );
  const ownsWorkspace = Boolean(
    user &&
    chat.userId === user.id &&
    chat.workspace &&
    (!params.tenantId ||
      (Number.isSafeInteger(tenantId) &&
        tenantId > 0 &&
        chat.workspace.id === tenantId)),
  );
  const searching =
    ownsWorkspace &&
    !!searchScope &&
    searchScope.owner === user &&
    searchScope.workspaceId === chat.workspace?.id &&
    searchScope.roomId === id;
  const currentScope = () => {
    const state = useChatStore.getState();
    return ownsWorkspace &&
      user &&
      getAuthSnapshot().user === user &&
      state.userId === user.id &&
      state.workspace?.id === chat.workspace?.id
      ? state
      : null;
  };
  const draftKey = chatDraftKey(
    id,
    threadScope?.roomId === id ? threadScope.parentMessageId : replyTo?.id,
  );
  const draft = ownsWorkspace ? chat.drafts[draftKey] || "" : "";
  const list = useRef<FlatList<ChatMessage>>(null);
  const composerInput = useRef<TextInput>(null);
  const composerSelection = useRef<ComposerSelection>({ start: draft.length, end: draft.length });
  const mentionDetailsRequest = useRef<SendAction | null>(null);
  const detailsScope = useRef<SendAction | null>(null);
  const meetingInvitationScope = useRef<SendAction | null>(null);
  const meetingStartRef = useRef<{ key: string; requestId: string; busy: boolean } | null>(null);
  const channelMeetingRequestRef = useRef<SendAction | null>(null);
  const activeDraftMentions = draftMentionState.key === draftKey ? draftMentionState.items : [];
  const activeAllMention = draftAllMentionState.key === draftKey ? draftAllMentionState.item : undefined;
  const composerDraft = useRef(draft);
  const composerMentionList = useRef<ChatMention[]>(activeDraftMentions);
  const composerAllMention = useRef<ChatAllMention | undefined>(activeAllMention);
  composerMentionList.current = activeDraftMentions;
  composerAllMention.current = activeAllMention;
  composerDraft.current = draft;
  const setDraft = (value: string, mentions = reconcileMentions(draft, value, activeDraftMentions), allMention = reconcileAllMention(draft, value, activeAllMention)) => {
    const state = currentScope();
    if (state?.channels.some((channel) => channel.id === id))
      state.setDraft(draftKey, value);
    composerDraft.current = value;
    composerMentionList.current = mentions;
    composerAllMention.current = allMention;
    setDraftMentionState({ key: draftKey, items: mentions });
    setDraftAllMentionState({ key: draftKey, item: allMention });
  };
  const channel = ownsWorkspace
    ? chat.channels.find((item) => item.id === id)
    : undefined;
  const messages = ownsWorkspace ? chat.messages[id] || [] : [];
  const atBottom = useRef(true);
  const initialScroll = useRef(true);
  const localArrivalStateRef = useRef(emptyLocalArrivalState());
  const forwardId = useRef(newUploadId());
  const canInteract = Boolean(ownsWorkspace && channel);
  const canCompose = Boolean(canInteract && !channel?.blocked);
  const mentionOpen = !!mentionTrigger;
  const actionIsCurrent = (action: SendAction | null) => !!action &&
    getAuthSnapshot().user === action.owner &&
    !!liveScopeRef.current && action.owner === liveScopeRef.current.owner &&
    action.workspaceId === liveScopeRef.current.workspaceId && action.roomId === liveScopeRef.current.roomId;
  const sending = actionIsCurrent(sendingAction);
  const threadIsCurrent =
    !!threadScope &&
    actionIsCurrent(threadScope) &&
    threadScope.parentMessageId === thread?.root.id;
  const threadOpen = !!threadScope && actionIsCurrent(threadScope);
  const directPeerId =
    channel?.kind === "direct"
      ? channel.memberIds.find((memberId) => memberId !== user?.id)
      : undefined;
  const directory = useDirectory(
    chat.workspace?.id,
    Boolean(ownsWorkspace && channel?.kind === "direct" && !threadOpen),
  );
  const directPeer = directPeerId
    ? directory.people.find((person) => person.id === directPeerId)
    : undefined;
  const directPeerPhotoUrl =
    directPeer?.photoUrl ??
    messages.find((message) => message.senderId === directPeerId)
      ?.senderPhotoUrl ??
    null;
  const ownProfile = useWorkspaceProfile(
    user,
    ownsWorkspace ? chat.workspace?.id : undefined,
  ).profile;
  useProfilePhotoCacheScope(
    ownsWorkspace ? chat.workspace?.id : undefined,
  );
  const memberContext = threadOpen
    ? "Original message and replies"
    : channel
      ? channel.kind === "channel"
        ? `${channel.memberIds.length} members · Channel`
        : channel.kind === "group"
          ? `${channel.memberIds.length} members · Group chat`
          : "Private conversation"
      : "";
  usePresencePolling(chat.workspace?.id, directPeerId ? [directPeerId] : [], Boolean(ownsWorkspace && directPeerId));
  const mentionPresenceIds = mentionOpen && details && actionIsCurrent(detailsScope.current)
    ? details.members.map(member => member.id)
    : [];
  usePresencePolling(chat.workspace?.id, mentionPresenceIds, Boolean(ownsWorkspace && mentionOpen && mentionPresenceIds.length));
  useFocusEffect(useCallback(() => {
    setTypingFocused(true);
    return () => {
      receiptActivityRef.current = false;
      receiptControllerRef.current?.setEnabled(false);
      setTypingFocused(false);
    };
  }, []));
  const typing = useChatTyping({ owner: user, tenantId: chat.workspace?.id, conversationId: id,
    threadRootId: threadIsCurrent ? thread?.root.id : undefined, enabled: canCompose,
    focused: typingFocused });
  const stopTyping = typing.stop;

  useEffect(() => {
    setVoiceOpen(false);
    setLocalPreviews({});
    setAiMode(null);
    setAiAvailable(false);
    setForwardTarget(null);
    setUploading(false);
    setFeatureBusy(false);
    setAttachments([]);
    setEditing(null);
    setSavedOpen(false);
    setSavedMessages([]);
    setEmojiOpen(false);
    setNewMessages(false);
    setLocalArrivalBoundary(null);
    localArrivalStateRef.current = emptyLocalArrivalState();
    setMentionTrigger(null);
    setMentionLoading(false);
    setDraftMentionState({ key: "", items: [] });
    setDraftAllMentionState({ key: "" });
    mentionDetailsRequest.current = null;
    detailsScope.current = null;
    setDetailsOpen(false);
    setDetails(null);
    setDetailsError(null);
    setDetailsLoading(false);
    channelMeetingRequestRef.current = null;
    setChannelMeetingCapability(null);
    setChannelMeetingBusy(false);
    setMeetingInvitations([]);
    meetingStartRef.current = null;
    setChannelMeetingOpen(false);
    setChannelMeetingScope(null);
    setChannelMeetingMembers([]);
    setChannelMeetingLoading(false);
    setChannelMeetingRosterError(null);
    setChannelMeetingCapabilityLoading(false);
    setChannelMeetingCapabilityError(null);
    setChannelMeetingError(null);
    setAttachmentOpen(false);
    atBottom.current = true;
    initialScroll.current = true;
    setSearchScope(null);
    setSearchText("");
    setSearchResult({ messages: [], hasMore: false });
    setReplyTo(null);
    stopTyping();
    setThread(null);
    setThreadScope(null);
    threadRequestRef.current = null;
    setThreadError(null);
    setActionError(null);
    setMenuOpen(false);
    setMessageMenuTarget(null);
    setReceiptCountState({ scope: null, counts: {} });
    receiptTargetScopeRef.current = null;
    setReceiptTarget(null);
    setReceiptRows([]);
    setReceiptError(null);
    setReceiptLoading(false);
    setSafetyOpen(false);
    setSafetyTarget(null);
    setSafetyConfirm(null);
    setSafetyError(null);
    setSafetyComment("");
  }, [user, id, tenantId, chat.workspace?.id, stopTyping]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", state => {
      const active = state === "active";
      if (!active) {
        receiptActivityRef.current = false;
        receiptControllerRef.current?.setEnabled(false);
      }
      setAppActive(active);
    });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    let current = true;
    setSearchResult({ messages: [], hasMore: false });
    setSearchError(null);
    if (!searching || searchText.trim().length < 2 || !canInteract) {
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    const timer = setTimeout(() => {
      if (!currentScope()) return;
      void chat
        .searchMessages(id, searchText.trim())
        .then((result) => {
          if (current && currentScope()) setSearchResult(result);
        })
        .catch((error) => {
          if (current && currentScope()) setSearchError(chatError(error));
        })
        .finally(() => {
          if (current && currentScope()) setSearchLoading(false);
        });
    }, 350);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [searching, searchText, id, user, chat.workspace?.id, canInteract]);
  useFocusEffect(
    useCallback(() => {
      chat.setUser(user?.id ?? null);
      if (
        !user ||
        !id ||
        (params.tenantId && (!Number.isSafeInteger(tenantId) || tenantId <= 0))
      )
        return;
      let mounted = true;
      let beganVisit = false;
      const refresh = async () => {
        if (
          !mounted ||
          getAuthSnapshot().user !== user ||
          AppState.currentState !== "active"
        )
          return;
        const state = useChatStore.getState();
        if (
          !state.workspace ||
          !state.channels.some((item) => item.id === id) ||
          (Number.isSafeInteger(tenantId) &&
            tenantId > 0 &&
            state.workspace.id !== tenantId)
        )
          await state.loadChannels(
            Number.isSafeInteger(tenantId) && tenantId > 0
              ? tenantId
              : undefined,
          );
        if (
          !mounted ||
          getAuthSnapshot().user !== user ||
          useChatStore.getState().userId !== user.id
        )
          return;
        if (
          params.tenantId &&
          useChatStore.getState().workspace?.id !== tenantId
        )
          return;
        if (!beganVisit) {
          useChatStore.getState().beginChannelVisit(id);
          beganVisit = true;
        }
        await useChatStore.getState().loadMessages(id);
        if (
          mounted &&
          getAuthSnapshot().user === user &&
          AppState.currentState === "active" &&
          atBottom.current &&
          !searching
        )
          await useChatStore.getState().markAsRead(id);
      };
      void refresh();
      const interval = setInterval(() => void refresh(), 5000);
      const subscription = AppState.addEventListener("change", (state) => {
        if (state === "active") void refresh();
      });
      return () => {
        mounted = false;
        clearInterval(interval);
        subscription.remove();
      };
    }, [user, id, tenantId, searching]),
  );
  const refreshThread = async (
    state: ReturnType<typeof currentScope>,
    request: ThreadAction,
    parentMessageId: string,
  ) => {
    if (!state || threadRequestRef.current !== request) return;
    try {
      const result = await state.loadThread(id, parentMessageId);
      if (
        currentScope() &&
        threadRequestRef.current === request &&
        actionIsCurrent(request)
      )
        setThread((previous) =>
          previous?.root.id === result.root.id
            ? {
                ...result,
                replies: [
                  ...new Map(
                    [...previous.replies, ...result.replies].map((m) => [
                      m.id,
                      m,
                    ]),
                  ).values(),
                ].sort((a, b) => a.sequence - b.sequence),
                hasMore: previous.hasMore || result.hasMore,
              }
            : result,
        );
    } catch (error) {
      if (
        currentScope() &&
        threadRequestRef.current === request &&
        actionIsCurrent(request)
      ) {
        setThreadError(chatError(error));
      }
    }
  };
  const send = async () => {
    const state = currentScope(), rawContent = state?.drafts[draftKey] || "",
      leadingWhitespace = rawContent.length - rawContent.trimStart().length,
      content = rawContent.trim();
    if (
      actionIsCurrent(sendingRef.current) ||
      !state?.workspace ||
      !state.channels.some((item) => item.id === id) ||
      (!content && !attachments.length) ||
      uploading ||
      content.length > 4000
    )
      return;
    typing.stop();
    atBottom.current = true;
    const action = { owner: user, workspaceId: state.workspace.id, roomId: id };
    const activeThread =
      threadIsCurrent && thread
        ? { request: threadScope!, rootId: thread.root.id }
        : null;
    sendingRef.current = action;
    setSendingAction(action);
    const parentMessageId = activeThread
      ? replyTo?.id || activeThread.rootId
      : replyTo?.id;
    setReplyTo(null);
    try {
      const mentions = activeDraftMentions.map(item => ({ ...item, start: item.start - leadingWhitespace }))
        .filter(item => item.start >= 0 && content.slice(item.start, item.start + item.length) === `@${item.name}`)
        .map(({ userId, start, length }) => ({ userId, start, length }));
      const allMention = activeAllMention ? { ...activeAllMention, start: activeAllMention.start - leadingWhitespace } : undefined;
      const validAllMention = allMention && isExactAllMention(content, allMention) ? allMention : undefined;
      if (validAllMention)
        await state.sendMessage(id, content, parentMessageId, attachments, mentions, validAllMention);
      else if (attachments.length || mentions.length)
        await state.sendMessage(id, content, parentMessageId, attachments, mentions);
      else await state.sendMessage(id, content, parentMessageId);
      if (currentScope()) setAttachments([]);
      if (currentScope()) setDraftMentionState({ key: draftKey, items: [] });
      if (currentScope()) setDraftAllMentionState({ key: draftKey });
      if (activeThread)
        await refreshThread(state, activeThread.request, activeThread.rootId);
    } finally {
      if (sendingRef.current === action) {
        sendingRef.current = null;
        setSendingAction(null);
      }
    }
  };
  const openDetails = async () => {
    const state = currentScope();
    if (!state) return;
    const action = { owner: user, workspaceId: state.workspace!.id, roomId: id };
    setDetailsOpen(true); setDetailsLoading(true); setDetailsError(null);
    try { const value = await state.loadDetails(id); if (actionIsCurrent(action)) { detailsScope.current = action; setDetails(value); } }
    catch (error) { if (actionIsCurrent(action)) setDetailsError(chatError(error)); }
    finally { if (actionIsCurrent(action)) setDetailsLoading(false); }
  };
  const openChannelMeetingPicker = async () => {
    const state = currentScope();
    if (!state?.workspace || !channel || (channel.kind !== "channel" && channel.kind !== "group")) return;
    const action = { owner: user, workspaceId: state.workspace.id, roomId: id };
    channelMeetingRequestRef.current = action;
    setChannelMeetingScope(action);
    setChannelMeetingMembers([]);
    setChannelMeetingRosterError(null);
    setChannelMeetingError(null);
    setChannelMeetingLoading(true);
    setChannelMeetingCapability(null);
    setChannelMeetingCapabilityLoading(true);
    setChannelMeetingCapabilityError(null);
    setChannelMeetingOpen(true);
    const requestIsCurrent = () => actionIsCurrent(action) && channelMeetingRequestRef.current === action;
    const rosterRequest = state.loadDetails(id).then(value => {
      if (requestIsCurrent()) setChannelMeetingMembers(value.members);
    }).catch(error => {
      if (requestIsCurrent()) setChannelMeetingRosterError(chatError(error));
    }).finally(() => {
      if (requestIsCurrent()) setChannelMeetingLoading(false);
    });
    const capabilityRequest = messageApi.channelMeetingCapabilities(action.workspaceId, id).then(capability => {
      if (requestIsCurrent()) setChannelMeetingCapability(capability);
    }).catch(error => {
      if (requestIsCurrent()) setChannelMeetingCapabilityError(chatError(error));
    }).finally(() => {
      if (requestIsCurrent()) setChannelMeetingCapabilityLoading(false);
    });
    await Promise.allSettled([rosterRequest, capabilityRequest]);
  };
  const closeChannelMeetingPicker = () => {
    channelMeetingRequestRef.current = null;
    setChannelMeetingOpen(false);
    setChannelMeetingScope(null);
    setChannelMeetingMembers([]);
    setChannelMeetingLoading(false);
    setChannelMeetingRosterError(null);
    setChannelMeetingCapabilityLoading(false);
    setChannelMeetingCapabilityError(null);
    setChannelMeetingError(null);
  };
  const startChannelMeeting = async (memberIds: number[]) => {
    const action = channelMeetingScope;
    if (!action || !actionIsCurrent(action) || !channelMeetingCapability?.canStart || meetingStartRef.current?.busy) return;
    const selected = [...new Set(memberIds)].sort((a, b) => a - b);
    const key = `${user?.id}:${action.workspaceId}:${action.roomId}:${selected.join(",")}`;
    // Retain the same request after an uncertain network result; it is not an authorization token.
    const attempt = meetingStartRef.current?.key === key ? meetingStartRef.current : {
      key, busy: false, requestId: "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
        const n = Math.floor(Math.random() * 16); return (c === "x" ? n : (n & 3) | 8).toString(16);
      }),
    };
    attempt.busy = true;
    meetingStartRef.current = attempt;
    setChannelMeetingBusy(true);
    setChannelMeetingError(null);
    try {
      const result = await messageApi.startChannelMeeting(action.workspaceId, action.roomId, selected, attempt.requestId);
      if (!actionIsCurrent(action) || channelMeetingRequestRef.current !== action) return;
      closeChannelMeetingPicker();
      meetingStartRef.current = null;
      router.push({ pathname: "/conference", params: { meetingId: result.meetingId } });
    } catch {
      if (actionIsCurrent(action) && channelMeetingRequestRef.current === action)
        setChannelMeetingError("Could not confirm the meeting. Try again with the same selection to recover it safely.");
    } finally {
      attempt.busy = false;
      if (actionIsCurrent(action)) setChannelMeetingBusy(false);
    }
  };
  useFocusEffect(useCallback(() => {
    if (!user || !chat.workspace || !channel || !["channel", "group"].includes(channel.kind)) return;
    const action = { owner: user, workspaceId: chat.workspace.id, roomId: id };
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const items = await messageApi.channelMeetingInvitations(action.workspaceId, id);
        if (!stopped && actionIsCurrent(action)) { meetingInvitationScope.current = action; setMeetingInvitations(items.filter(item => item.expiresAt > Date.now())); }
      } catch {
        if (!stopped && actionIsCurrent(action)) setMeetingInvitations([]);
      } finally {
        if (!stopped) timer = setTimeout(refresh, 15000);
      }
    };
    void refresh();
    return () => { stopped = true; clearTimeout(timer); };
  }, [user, chat.workspace?.id, id, channel?.kind]));
  const ensureMentionMembers = async () => {
    const state = currentScope();
    if (!state) return;
    // The directory covers a workspace; mentions must be selected from this
    // exact conversation's current member list.
    if (details && actionIsCurrent(detailsScope.current)) return;
    if (actionIsCurrent(mentionDetailsRequest.current)) return;
    const action = { owner: user, workspaceId: state.workspace!.id, roomId: id };
    mentionDetailsRequest.current = action;
    setMentionLoading(true);
    try {
      const value = await state.loadDetails(id);
      if (!actionIsCurrent(action) || mentionDetailsRequest.current !== action) return;
      detailsScope.current = action;
      setDetails(value);
    } catch (error) {
      if (actionIsCurrent(action)) {
        setActionError(chatError(error));
        setMentionTrigger(null);
      }
    } finally {
      if (mentionDetailsRequest.current === action) {
        mentionDetailsRequest.current = null;
        if (actionIsCurrent(action)) setMentionLoading(false);
      }
    }
  };
  const syncMentionTrigger = (value: string, selection: ComposerSelection, mentions: ChatMention[], allMention = activeAllMention) => {
    const trigger = canCompose && (channel?.kind === "group" || channel?.kind === "channel")
      ? findMentionTrigger(value, selection, mentions, allMention ? [allMention] : [])
      : null;
    setMentionTrigger(trigger);
    if (trigger) void ensureMentionMembers();
  };
  const applyComposerChange = (value: string, selection = selectionAfterEdit(draft, value, composerSelection.current)) => {
    const mentions = reconcileMentions(draft, value, activeDraftMentions);
    const allMention = reconcileAllMention(draft, value, activeAllMention);
    composerSelection.current = selection;
    setDraft(value, mentions, allMention);
    typing.onUserEdit(value);
    syncMentionTrigger(value, selection, mentions, allMention);
  };
  const focusComposerAt = (selection: ComposerSelection) => {
    composerSelection.current = selection;
    requestAnimationFrame(() => {
      composerInput.current?.focus();
      composerInput.current?.setNativeProps?.({ selection });
    });
  };
  const returnToComposerFromVoiceNote = () => {
    setVoiceOpen(false);
    if (canCompose) focusComposerAt(composerSelection.current);
  };
  const openMentions = () => {
    if (!canCompose || (channel?.kind !== "group" && channel?.kind !== "channel")) return;
    const selection = composerSelection.current;
    const nextValue = draft.slice(0, selection.start) + "@" + draft.slice(selection.end);
    const nextSelection = { start: selection.start + 1, end: selection.start + 1 };
    const mentions = reconcileMentions(draft, nextValue, activeDraftMentions);
    const allMention = reconcileAllMention(draft, nextValue, activeAllMention);
    setDraft(nextValue, mentions, allMention);
    typing.onUserEdit(nextValue);
    syncMentionTrigger(nextValue, nextSelection, mentions, allMention);
    focusComposerAt(nextSelection);
  };
  const pickMention = (person: ChatConversationDetails["members"][number]) => {
    if (!mentionTrigger || activeDraftMentions.length >= 20) {
      if (activeDraftMentions.length >= 20) setActionError("A message can mention up to 20 people.");
      setMentionTrigger(null);
      return;
    }
    const result = insertMention(draft, mentionTrigger, person, activeDraftMentions);
    setDraft(result.value, result.mentions);
    typing.onUserEdit(result.value);
    setMentionTrigger(null);
    focusComposerAt(result.selection);
  };
  const pickAllMention = () => {
    if (!mentionTrigger || !details?.canMentionAll || activeAllMention) return;
    const result = insertAllMention(draft, mentionTrigger, activeAllMention);
    const mentions = reconcileMentions(draft, result.value, activeDraftMentions);
    setDraft(result.value, mentions, result.allMention);
    typing.onUserEdit(result.value);
    setMentionTrigger(null);
    focusComposerAt(result.selection);
  };
  const openThread = async (item: ChatMessage) => {
    const state = currentScope();
    if (!state?.workspace || item.status !== "sent") return;
    if (attachments.length || uploading) {
      setActionError("Send or remove your attachment before opening replies.");
      return;
    }
    const rootId = item.parent?.id || item.id;
    const action = {
      owner: user,
      workspaceId: state.workspace.id,
      roomId: id,
      parentMessageId: rootId,
    };
    threadRequestRef.current = action;
    setMenuOpen(false);
    setMessageMenuTarget(null);
    setSearchScope(null);
    setSafetyOpen(false);
    setThreadScope(action);
    setThread(null);
    setThreadError(null);
    setThreadLoading(true);
    try {
      const result = await state.loadThread(id, rootId);
      if (
        currentScope() &&
        threadRequestRef.current === action &&
        actionIsCurrent(action)
      ) {
        setThread(result);
        setReplyTo(result.root);
      }
    } catch (error) {
      if (
        currentScope() &&
        threadRequestRef.current === action &&
        actionIsCurrent(action)
      )
        setThreadError(chatError(error));
    } finally {
      if (threadRequestRef.current === action && actionIsCurrent(action))
        setThreadLoading(false);
    }
  };
  const loadEarlierThread = async () => {
    const state = currentScope(),
      action = threadScope;
    if (
      !state ||
      !action ||
      !thread ||
      !thread.hasMore ||
      threadLoading ||
      !threadIsCurrent
    )
      return;
    const sequences = thread.replies
      .filter((item) => item.status === "sent")
      .map((item) => item.sequence);
    if (!sequences.length) return;
    const request = { ...action };
    threadRequestRef.current = request;
    setThreadLoading(true);
    try {
      const result = await state.loadThread(
        id,
        action.parentMessageId,
        Math.min(...sequences),
      );
      if (
        currentScope() &&
        threadRequestRef.current === request &&
        actionIsCurrent(request)
      ) {
        setThread((previous) =>
          previous && previous.root.id === result.root.id
            ? {
                root: result.root,
                replies: [
                  ...new Map(
                    [...result.replies, ...previous.replies].map((item) => [
                      item.id,
                      item,
                    ]),
                  ).values(),
                ].sort((a, b) => a.sequence - b.sequence),
                hasMore: result.hasMore,
              }
            : result,
        );
        threadRequestRef.current = action;
      }
    } catch (error) {
      if (
        currentScope() &&
        threadRequestRef.current === request &&
        actionIsCurrent(request)
      ) {
        setThreadError(chatError(error));
        threadRequestRef.current = action;
      }
    } finally {
      if (
        (threadRequestRef.current === request ||
          threadRequestRef.current === action) &&
        actionIsCurrent(action)
      )
        setThreadLoading(false);
    }
  };
  const closeThread = () => {
    if (attachments.length || uploading) {
      setActionError("Send or remove your attachment before leaving replies.");
      return;
    }
    threadRequestRef.current = null;
    setThread(null);
    setThreadScope(null);
    setThreadError(null);
    setReplyTo(null);
  };
  const clearSearch = () => {
    setSearchScope(null);
    setSearchText("");
    setSearchResult({ messages: [], hasMore: false });
  };
  const openSearch = () => {
    const state = currentScope();
    if (!state?.workspace) return;
    setMenuOpen(false);
    setMessageMenuTarget(null);
    setSafetyOpen(false);
    setSafetyConfirm(null);
    setSafetyError(null);
    closeThread();
    setSearchText("");
    setSearchResult({ messages: [], hasMore: false });
    setSearchScope({
      owner: user,
      workspaceId: state.workspace.id,
      roomId: id,
    });
  };
  const closeSearch = () => {
    clearSearch();
  };
  const openSafety = (
    target: ChatMessage | null,
    confirmation: "report" | "block" | "unblock" | null = null,
  ) => {
    if (!currentScope()) return;
    setMenuOpen(false);
    setMessageMenuTarget(null);
    clearSearch();
    closeThread();
    setSafetyTarget(target);
    setSafetyConfirm(confirmation);
    setSafetyError(null);
    setSafetyOpen(true);
  };
  const submitSafety = async () => {
    const state = currentScope();
    if (!state || !safetyConfirm) return;
    setSafetyLoading(true);
    setSafetyError(null);
    try {
      if (safetyConfirm === "report")
        await state.reportMessage(
          id,
          safetyCategory,
          safetyComment.trim() || undefined,
          safetyTarget?.id,
        );
      if (
        safetyConfirm === "block" &&
        directPeerId &&
        directPeerId !== user?.id
      )
        await state.blockMember(directPeerId);
      if (safetyConfirm === "unblock" && directPeerId)
        await state.unblockMember(directPeerId);
      if (currentScope()) {
        setSafetyConfirm(null);
        setSafetyOpen(false);
        setSafetyTarget(null);
        setSafetyComment("");
      }
    } catch (error) {
      if (currentScope()) setSafetyError(chatError(error));
    } finally {
      if (currentScope()) setSafetyLoading(false);
    }
  };
  const selectReply = (item: ChatMessage) => {
    if (
      currentScope()?.channels.some((channel) => channel.id === id) &&
      canCompose
    ) {
      setMessageMenuTarget(null);
      // The service returns only direct replies for a thread. Keep replies made
      // from this view attached to its root, so the composer never promises a
      // nested reply that would disappear from the current Replies screen.
      setReplyTo(threadIsCurrent && thread ? thread.root : item);
    }
  };
  const copyMessage = async (item: ChatMessage) => {
    if (!currentScope()) return;
    try {
      await Clipboard.setStringAsync(item.content);
    } catch {
      if (currentScope()) setActionError("Could not copy this message.");
    } finally {
      if (currentScope()) setMessageMenuTarget(null);
    }
  };
  const openMessageActions = (item: ChatMessage) => {
    if (item.status === "sent" && currentScope()) setMessageMenuTarget(item);
  };
  const reload = async () => {
    if (
      !user ||
      getAuthSnapshot().user !== user ||
      (params.tenantId && (!Number.isSafeInteger(tenantId) || tenantId <= 0))
    )
      return;
    await useChatStore
      .getState()
      .loadChannels(params.tenantId ? tenantId : chat.workspace?.id);
    if (
      getAuthSnapshot().user === user &&
      (!params.tenantId || useChatStore.getState().workspace?.id === tenantId)
    )
      await useChatStore.getState().loadMessages(id);
  };
  const retryThreadMessage = async (item: ChatMessage) => {
    const state = currentScope();
    if (!state?.channels.some((channel) => channel.id === id)) return;
    const activeThread =
      threadIsCurrent && thread
        ? { request: threadScope!, rootId: thread.root.id }
        : null;
    await state.retryMessage(id, item.clientId);
    if (activeThread)
      await refreshThread(state, activeThread.request, activeThread.rootId);
  };
  const threadMessages =
    threadIsCurrent && thread
      ? (() => {
          const key = (item: ChatMessage) =>
            `${item.senderId}:${item.clientId}`;
          const serverKeys = new Set(thread.replies.map(key));
          const local = messages.filter(
            (item) =>
              item.parent?.id === thread.root.id && !serverKeys.has(key(item)),
          );
          return [
            thread.root,
            ...[...thread.replies, ...local].sort((a, b) =>
              a.status === "sent" && b.status === "sent"
                ? a.sequence - b.sequence
                : a.status === "sent"
                  ? -1
                  : b.status === "sent"
                    ? 1
                    : a.timestamp - b.timestamp,
            ),
          ];
        })()
      : null;
  const displayedMessages = searching
    ? canInteract
      ? searchResult.messages
      : []
    : threadMessages
      ? threadMessages
      : messages.filter((item) => !item.parent);
  const initialReadSequence = chat.initialReadSequences?.[id];
  const firstUnread = !threadOpen && !searching && initialReadSequence !== undefined
    ? displayedMessages.find(message => message.sequence > initialReadSequence && message.senderId !== user?.id && message.status === "sent")
    : undefined;
  const activeReceiptThreadRootId = threadIsCurrent ? thread?.root.id : undefined;
  const receiptScopeRef = useRef<ReceiptScope | null>(null);
  receiptScopeRef.current = ownsWorkspace && user && chat.workspace ? {
    owner: user,
    workspaceId: chat.workspace.id,
    roomId: id,
    ...(activeReceiptThreadRootId ? { threadRootId: activeReceiptThreadRootId } : {}),
  } : null;
  const receiptCounts = sameReceiptScope(receiptCountState.scope, receiptScopeRef.current) ? receiptCountState.counts : {};
  const receiptTargetScopeRef = useRef<ReceiptScope | null>(null);
  const receiptTargetIsCurrent = !!receiptTarget && sameReceiptScope(receiptTargetScopeRef.current, receiptScopeRef.current);
  const receiptObscured = !!(receiptTargetIsCurrent || messageMenuTarget || menuOpen || safetyOpen || detailsOpen || savedOpen ||
    voiceOpen || forwardTarget || attachmentOpen || editing || aiMode || mentionOpen || emojiOpen);
  const receiptCanObserve = Boolean(ownsWorkspace && typingFocused && appActive && !receiptObscured && !searching);
  const receiptActivityRef = useRef(receiptCanObserve);
  receiptActivityRef.current = receiptCanObserve;
  const receiptSearchRef = useRef(searching);
  receiptSearchRef.current = searching;
  const visibleReceiptsRef = useRef<{ scope: ReceiptScope; incomingIds: string[]; ownIds: string[] } | null>(null);
  const receiptControllerRef = useRef<ReturnType<typeof createReadReceiptController<ReceiptScope>> | null>(null);
  if (!receiptControllerRef.current) receiptControllerRef.current = createReadReceiptController<ReceiptScope>({
    capture: () => receiptScopeRef.current,
    current: captured => {
      const scope = receiptScopeRef.current;
      const state = useChatStore.getState();
      return receiptActivityRef.current && sameReceiptScope(scope, captured) && getAuthSnapshot().user === captured.owner &&
        state.userId === captured.owner?.id && state.workspace?.id === captured.workspaceId && captured.roomId === liveScopeRef.current?.roomId;
    },
    send: async (messageIds, scope) => {
      return messageApi.publishReadReceipts(scope.workspaceId, scope.roomId, messageIds, scope.threadRootId);
    },
  });
  const receiptSummaryLoaderRef = useRef<ReturnType<typeof createReadReceiptSummaryLoader<ReceiptScope, { messageId: string; count: number }>> | null>(null);
  if (!receiptSummaryLoaderRef.current) receiptSummaryLoaderRef.current = createReadReceiptSummaryLoader({
    load: (scope, ids) => messageApi.readReceiptSummaries(scope.workspaceId, scope.roomId, ids, scope.threadRootId),
    current: scope => receiptActivityRef.current && sameReceiptScope(receiptScopeRef.current, scope) && getAuthSnapshot().user === scope.owner,
    apply: (scope, rows) => setReceiptCountState(previous => ({ scope, counts: {
      ...(sameReceiptScope(previous.scope, scope) ? previous.counts : {}),
      ...Object.fromEntries(rows.map(row => [row.messageId, row.count])),
    } })),
    clear: (scope, ids) => setReceiptCountState(previous => {
      const counts = { ...(sameReceiptScope(previous.scope, scope) ? previous.counts : {}) };
      ids.forEach(messageId => delete counts[messageId]);
      return { scope, counts };
    }),
    latest: () => {
      const visible = visibleReceiptsRef.current;
      return visible && receiptActivityRef.current && sameReceiptScope(receiptScopeRef.current, visible.scope)
        ? { scope: visible.scope, ids: visible.ownIds } : null;
    },
    sameScope: (left, right) => sameReceiptScope(left, right),
  });
  useEffect(() => {
    receiptControllerRef.current?.replaceScope();
    receiptSummaryLoaderRef.current?.replaceScope();
  }, [user, chat.workspace?.id, id, activeReceiptThreadRootId]);
  useEffect(() => {
    receiptControllerRef.current?.setEnabled(receiptCanObserve);
    const visible = visibleReceiptsRef.current;
    if (receiptCanObserve && sameReceiptScope(receiptScopeRef.current, visible?.scope || null)) {
      receiptControllerRef.current?.visible(visible?.incomingIds || []);
      refreshReceiptSummariesRef.current(visible!.scope, visible!.ownIds);
    }
  }, [receiptCanObserve, user, chat.workspace?.id, id, activeReceiptThreadRootId]);
  useEffect(() => { if (searching) visibleReceiptsRef.current = null; }, [searching]);
  useEffect(() => () => receiptControllerRef.current?.dispose(), []);
  const refreshReceiptSummariesRef = useRef<(scope: ReceiptScope, ids: string[]) => void>(() => undefined);
  refreshReceiptSummariesRef.current = (scope, ids) => receiptSummaryLoaderRef.current?.request(scope, ids);
  useEffect(() => {
    if (!receiptCanObserve) return;
    const refresh = () => {
      const visible = visibleReceiptsRef.current;
      const scope = receiptScopeRef.current;
      if (!scope || !visible || !sameReceiptScope(scope, visible.scope) || !visible.ownIds.length) return;
      refreshReceiptSummariesRef.current(scope, visible.ownIds);
    };
    refresh();
    const timer = setInterval(refresh, 5_000);
    return () => clearInterval(timer);
  }, [receiptCanObserve, user, chat.workspace?.id, id, activeReceiptThreadRootId]);
  const receiptViewabilityConfig = useRef({
    viewAreaCoveragePercentThreshold: READ_RECEIPT_VIEW_AREA_PERCENT,
  }).current;
  const onReceiptViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken<ChatMessage>[] }) => {
    const scope = receiptScopeRef.current;
    const state = useChatStore.getState();
    if (!scope || getAuthSnapshot().user !== scope.owner || state.workspace?.id !== scope.workspaceId) return;
    if (receiptSearchRef.current) { visibleReceiptsRef.current = null; return; }
    const visible = viewableItems.map(token => token.item).filter(Boolean);
    const incomingIds = visible.filter(item => item.status === "sent" && !item.deletedAt && item.senderId !== scope.owner?.id).map(item => item.id);
    const ownIds = visible.filter(item => item.status === "sent" && !item.deletedAt && item.senderId === scope.owner?.id).map(item => item.id).slice(0, 50);
    visibleReceiptsRef.current = { scope, incomingIds, ownIds };
    if (!receiptActivityRef.current) return;
    receiptControllerRef.current?.visible(incomingIds);
    refreshReceiptSummariesRef.current(scope, ownIds);
  }).current;
  const receiptTargetRef = useRef<ChatMessage | null>(receiptTarget);
  receiptTargetRef.current = receiptTarget;
  const receiptDetailGuardRef = useRef<ReturnType<typeof createReadReceiptRequestGuard<ReceiptScope>> | null>(null);
  if (!receiptDetailGuardRef.current) receiptDetailGuardRef.current = createReadReceiptRequestGuard<ReceiptScope>({
    currentScope: () => receiptScopeRef.current,
    currentTarget: () => receiptTargetRef.current?.id || null,
    sameScope: sameReceiptScope,
  });
  useEffect(() => {
    if (!receiptTarget || !receiptTargetIsCurrent || !typingFocused || !appActive || !ownsWorkspace) return;
    const scope = receiptScopeRef.current;
    if (!scope || receiptTarget.senderId !== scope.owner?.id) return;
    let active = true, inFlight = false, first = true;
    const targetId = receiptTarget.id;
    const request = receiptDetailGuardRef.current!.begin(scope, targetId);
    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const rows = await messageApi.readReceiptDetails(scope.workspaceId, scope.roomId, targetId, scope.threadRootId);
        if (active && receiptDetailGuardRef.current?.current(request) && getAuthSnapshot().user === scope.owner) {
          setReceiptRows(rows); setReceiptError(null);
        }
      } catch {
        if (active && receiptDetailGuardRef.current?.current(request) && getAuthSnapshot().user === scope.owner)
          setReceiptError("Read receipts are unavailable. Try again later.");
      } finally {
        inFlight = false;
        if (active && receiptDetailGuardRef.current?.current(request) && first) { first = false; setReceiptLoading(false); }
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 5_000);
    return () => { active = false; clearInterval(timer); };
  }, [receiptTarget, receiptTargetIsCurrent, typingFocused, appActive, ownsWorkspace, user, chat.workspace?.id, id, activeReceiptThreadRootId]);
  const openReadReceipts = (item: ChatMessage) => {
    const scope = receiptScopeRef.current;
    if (!scope || item.senderId !== scope.owner?.id || item.status !== "sent") return;
    receiptDetailGuardRef.current?.invalidate();
    receiptTargetRef.current = item;
    receiptTargetScopeRef.current = scope;
    setMessageMenuTarget(null); setReceiptRows([]); setReceiptError(null); setReceiptLoading(true); setReceiptTarget(item);
  };
  const closeReadReceipts = () => {
    receiptDetailGuardRef.current?.invalidate();
    receiptTargetRef.current = null;
    receiptTargetScopeRef.current = null;
    setReceiptTarget(null);
  };
  const safetySubject =
    safetyTarget?.senderName || channel?.name || "this conversation";
  const closeSafety = () => {
    if (!safetyLoading) {
      setSafetyOpen(false);
      setSafetyConfirm(null);
      setSafetyError(null);
    }
  };

  useFocusEffect(
    useCallback(() => {
      if (!threadIsCurrent || !threadScope || !thread) return;
      let running = false;
      const refresh = async () => {
        if (
          running ||
          AppState.currentState !== "active" ||
          threadRequestRef.current !== threadScope
        )
          return;
        running = true;
        try {
          await refreshThread(currentScope(), threadScope, thread.root.id);
        } finally {
          running = false;
        }
      };
      const timer = setInterval(() => void refresh(), 5000);
      return () => clearInterval(timer);
    }, [threadScope, threadIsCurrent, user, id]),
  );
  const localArrivalScopeKey =
    !searching && canInteract && chat.workspace
      ? threadIsCurrent && thread
        ? `${chat.workspace.id}:${id}:thread:${thread.root.id}`
        : `${chat.workspace.id}:${id}:messages`
      : null;
  const localArrivalKind = threadIsCurrent && thread ? "replies" : "messages";
  const displayedMessageKey = displayedMessages
    .map((message) => `${chatMessageKey(message)}:${message.sequence}:${message.status}`)
    .join("|");
  useEffect(() => {
    if (!localArrivalScopeKey || !user) return;
    const previousScope = localArrivalStateRef.current.scopeKey;
    const observed = observeLocalArrivals(
      localArrivalStateRef.current,
      localArrivalScopeKey,
      localArrivalKind,
      displayedMessages,
      user.id,
    );
    localArrivalStateRef.current = observed.state;
    if (previousScope !== localArrivalScopeKey) {
      setNewMessages(false);
      setLocalArrivalBoundary(null);
      return;
    }
    if (!atBottom.current && observed.boundary) {
      setNewMessages(true);
      setLocalArrivalBoundary((current) =>
        current?.scopeKey === localArrivalScopeKey
          ? current
          : { scopeKey: localArrivalScopeKey, boundary: observed.boundary! },
      );
    }
  }, [displayedMessageKey, localArrivalKind, localArrivalScopeKey, user?.id]);

  useEffect(() => {
    let active = true;
    setAiAvailable(false);
    if (ownsWorkspace && chat.workspace)
      void messageApi
        .intelligenceCapability(chat.workspace.id)
        .then((value) => {
          if (active && currentScope()) setAiAvailable(value.available);
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [user, id, chat.workspace?.id, ownsWorkspace]);
  const openCollection = async (kind: "saved" | "pinned") => {
    const state = currentScope();
    if (!state?.workspace) return;
    setMenuOpen(false);
    setCollectionTitle(kind === "saved" ? "Saved messages" : "Pinned messages");
    setSavedMessages([]);
    setSavedOpen(true);
    setFeatureBusy(true);
    try {
      const rows = await (kind === "saved"
        ? messageApi.savedMessages(state.workspace.id, id)
        : messageApi.pinnedMessages(state.workspace.id, id));
      if (currentScope()) setSavedMessages(rows);
    } catch {
      if (currentScope())
        setActionError("Unable to load messages. Please retry.");
    } finally {
      if (currentScope()) setFeatureBusy(false);
    }
  };

  const runFeature = async (operation: () => Promise<unknown>) => {
    const scope = currentScope();
    if (!scope?.workspace || featureBusy) return;
    const action = { owner: user, workspaceId: scope.workspace.id, roomId: id };
    setFeatureBusy(true);
    setActionError(null);
    try {
      await operation();
      if (!currentScope() || !actionIsCurrent(action)) return;
      setMessageMenuTarget(null);
      await scope.loadMessages(id);
      if (threadIsCurrent && threadScope && thread)
        await refreshThread(scope, threadScope, thread.root.id);
    } catch {
      if (currentScope() && actionIsCurrent(action))
        setActionError("Could not save this change. Please try again.");
    } finally {
      if (currentScope() && actionIsCurrent(action)) setFeatureBusy(false);
    }
  };
  const chooseAttachment = async (kind: "photo" | "file" | "camera") => {
    const state = currentScope();
    if (!state?.workspace || uploading || attachments.length >= 10) return;
    const action = { owner: user, workspaceId: state.workspace.id, roomId: id };
    setAttachmentOpen(false);
    setActionError(null);
    setUploading(true);
    try {
      let input: ChatUpload | null = null;
      if (kind === "photo" || kind === "camera") {
        const picker = await import("expo-image-picker");
        if (
          kind === "camera" &&
          !(await picker.requestCameraPermissionsAsync()).granted
        )
          throw new Error("Allow camera access to take a photo.");
        const result =
          kind === "camera"
            ? await picker.launchCameraAsync({
                mediaTypes: ["images"],
                quality: 0.85,
              })
            : await picker.launchImageLibraryAsync({
                mediaTypes: ["images", "videos"],
                quality: 0.85,
              });
        if (!result.canceled) {
          const a = result.assets[0];
          input = {
            uri: a.uri,
            filename: a.fileName || "Photo.jpg",
            mimeType: a.mimeType || "image/jpeg",
            sizeBytes: a.fileSize,
            file: a.file,
          };
        }
      } else {
        const picker = await import("expo-document-picker");
        const result = await picker.getDocumentAsync({
          copyToCacheDirectory: true,
          multiple: false,
        });
        if (!result.canceled) {
          const a = result.assets[0];
          input = {
            uri: a.uri,
            filename: a.name,
            mimeType: a.mimeType || "application/octet-stream",
            sizeBytes: a.size,
            file: a.file,
          };
        }
      }
      if (input && currentScope() && actionIsCurrent(action)) {
        const attachment = await uploadChatMedia(
          state.workspace.id,
          id,
          input,
          newUploadId(),
        );
        if (currentScope() && actionIsCurrent(action)) {
          setAttachments((items) => [...items, attachment]);
          if (attachment.mimeType.startsWith("image/"))
            setLocalPreviews((items) => ({
              ...items,
              [attachment.id]: input!.uri,
            }));
        }
      }
    } catch (error) {
      if (currentScope() && actionIsCurrent(action))
        setActionError(
          error instanceof Error
            ? error.message
            : "Unable to upload attachment.",
        );
    } finally {
      if (currentScope() && actionIsCurrent(action)) setUploading(false);
    }
  };

  const attachVoice = async (
    input: ChatUpload,
    delivery?: { signal: AbortSignal; commit: () => boolean },
  ) => {
    const cancelled = () => {
      const error = new Error("Voice note cancelled.");
      error.name = "AbortError";
      return error;
    };
    if (delivery?.signal.aborted) throw cancelled();
    const state = currentScope();
    if (!state?.workspace)
      throw new Error("Open the conversation workspace again.");
    if (uploading) throw new Error("Another attachment is still uploading.");
    const action = { owner: user, workspaceId: state.workspace.id, roomId: id };
    const preservedDraftKey = draftKey;
    const preservedDraft = state.drafts[preservedDraftKey] || "";
    let handedToChat = false;
    const restorePreservedDraft = () => {
      const current = currentScope();
      if (
        preservedDraft &&
        current &&
        actionIsCurrent(action) &&
        current.drafts[preservedDraftKey] === ""
      )
        current.setDraft(preservedDraftKey, preservedDraft);
    };
    setUploading(true);
    setActionError(null);
    try {
      const attachment = await uploadChatMedia(
        state.workspace.id,
        id,
        input,
        newUploadId(),
        delivery?.signal,
      );
      if (delivery?.signal.aborted) throw cancelled();
      const current = currentScope();
      if (!current || !actionIsCurrent(action))
        throw new Error(
          "Your account or workspace changed. Open the conversation again.",
        );
      const activeThread =
        threadIsCurrent && thread
          ? { request: threadScope!, rootId: thread.root.id }
          : null;
      const parentMessageId = activeThread
        ? replyTo?.id || activeThread.rootId
        : replyTo?.id;
      if (delivery && !delivery.commit()) throw cancelled();
      // Once the attachment is handed to the chat store, its optimistic
      // message owns delivery retries. Repeating the voice upload here could
      // create a second attachment/message when delivery already failed.
      handedToChat = true;
      await current.sendMessage(id, "", parentMessageId, [attachment]);
      if (!currentScope() || !actionIsCurrent(action))
        throw new Error(
          "Your account or workspace changed. Open the conversation again.",
        );
      restorePreservedDraft();
      setReplyTo(null);
      if (activeThread)
        await refreshThread(state, activeThread.request, activeThread.rootId);
    } catch (error) {
      restorePreservedDraft();
      if (
        !delivery?.signal.aborted &&
        currentScope() &&
        actionIsCurrent(action)
      )
        setActionError(
          error instanceof Error
            ? error.message
            : "Unable to upload voice note.",
        );
      if (handedToChat) return;
      throw error;
    } finally {
      if (currentScope() && actionIsCurrent(action)) setUploading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      testID="chat-room-keyboard-avoiding"
      style={styles.keyboardRoot}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={0}
    >
      <ScreenContainer edges={["top", "left", "right", "bottom"]}>
        <View style={{ flex: 1, flexDirection: "row" }}>
          <ConversationRail selected={id} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={[styles.header, { borderBottomColor: colors.border }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  threadOpen ? "Back to conversation" : "Back to conversations"
                }
                accessibilityHint={threadOpen ? "Closes Replies" : undefined}
                onPress={() =>
                  threadOpen
                    ? closeThread()
                    : router.canGoBack()
                      ? router.back()
                      : router.replace("/(tabs)/teamchat")
                }
                style={styles.back}
              >
                <MaterialIcons
                  name="arrow-back-ios"
                  size={18}
                  color={colors.primary}
                />
              </Pressable>
              {!threadOpen && (
                <ProfileAvatar
                  name={directPeer?.name ?? channel?.name}
                  photoUrl={directPeerPhotoUrl}
                  tenantId={chat.workspace?.id}
                  userId={directPeerId}
                  size={34}
                  rounded
                  accessibilityLabel={`${directPeer?.name ?? channel?.name ?? "Conversation"} profile photo`}
                />
              )}
              <Pressable accessibilityRole="button" accessibilityLabel="Open conversation details" disabled={threadOpen || !canInteract} onPress={() => void openDetails()} style={styles.headerTitleBlock}>
                <Text
                  numberOfLines={1}
                  style={[styles.title, { color: colors.foreground }]}
                >
                  {threadOpen ? "Replies" : channel?.name || "Conversation"}
                </Text>
                {!threadOpen && directPeerId ? <PresenceIndicator tenantId={chat.workspace?.id} userId={directPeerId} /> : <Text
                  numberOfLines={1}
                  style={[styles.memberContext, { color: colors.muted }]}
                >{memberContext}</Text>}
              </Pressable>
              {!threadOpen && directPeerId && chat.workspace && (
                <ChatMeetingAction />
              )}
              {!threadOpen &&
                (channel?.kind === "channel" || channel?.kind === "group") &&
                chat.workspace && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Start channel meeting"
                    accessibilityHint="Choose members to invite to a video meeting."
                    disabled={!canInteract || channelMeetingLoading}
                    onPress={() => void openChannelMeetingPicker()}
                    style={styles.overflow}
                  >
                    <MaterialIcons
                      name="videocam"
                      size={23}
                      color={channelMeetingLoading ? colors.muted : colors.primary}
                    />
                  </Pressable>
                )}
              {!threadOpen && directPeerId && chat.workspace && (
                <ChatPeerCall
                  peerId={directPeerId}
                  tenantId={chat.workspace.id}
                  person={directPeer}
                  directoryOwner={directory.owner}
                  sharedDirectory
                />
              )}
              {aiAvailable && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    threadIsCurrent
                      ? "Summarize thread"
                      : "AI writing assistant"
                  }
                  onPress={() =>
                    setAiMode(
                      threadIsCurrent
                        ? { mode: "summary", messageId: thread!.root.id }
                        : { mode: draft.trim() ? "refine" : "compose" },
                    )
                  }
                  style={styles.overflow}
                >
                  <MaterialIcons
                    name="auto-awesome"
                    size={23}
                    color={colors.primary}
                  />
                </Pressable>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Conversation menu"
                accessibilityHint="Opens search and safety actions"
                disabled={!canInteract}
                onPress={() => {
                  setSafetyOpen(false);
                  setMessageMenuTarget(null);
                  setMenuOpen((open) => !open);
                }}
                style={styles.overflow}
              >
                <MaterialIcons
                  name="more-horiz"
                  size={24}
                  color={colors.primary}
                />
              </Pressable>
            </View>
            {searching && (
              <View
                style={[styles.search, { borderBottomColor: colors.border }]}
              >
                <TextInput
                  accessibilityLabel="Search messages"
                  value={searchText}
                  onChangeText={setSearchText}
                  maxLength={100}
                  autoFocus
                  placeholder="Search messages in this chat"
                  placeholderTextColor={colors.muted}
                  style={[
                    styles.input,
                    {
                      flex: 0,
                      backgroundColor: colors.surface,
                      color: colors.foreground,
                    },
                  ]}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close message search"
                  onPress={closeSearch}
                  style={styles.searchClose}
                >
                  <Text style={{ color: colors.primary }}>Close</Text>
                </Pressable>
                <Text
                  style={{ color: colors.muted, fontSize: 12, width: "100%" }}
                >
                  {searchResult.hasMore
                    ? "Showing the latest 50 matches. Narrow your search for older results."
                    : "Search messages with at least two characters."}
                </Text>
              </View>
            )}
            {!user ? (
              <View style={styles.empty}>
                <Text style={{ color: colors.foreground }}>
                  Sign in again to open this conversation.
                </Text>
              </View>
            ) : (
              <View style={{ flex: 1 }}>
                {(chat.error || chat.roomErrors[id] || chat.storageError) && (
                  <Pressable
                    accessibilityRole="button"
                    onPress={reload}
                    style={styles.notice}
                  >
                    <Text style={{ color: colors.error }}>
                      {chat.storageError || chat.roomErrors[id] || chat.error}{" "}
                      Tap to retry.
                    </Text>
                  </Pressable>
                )}
                {actionError && (
                  <Text
                    accessibilityLiveRegion="polite"
                    style={styles.noticeText}
                  >
                    {actionError}
                  </Text>
                )}
                {!threadOpen && canInteract && actionIsCurrent(meetingInvitationScope.current) && meetingInvitations.filter(item => item.expiresAt > Date.now()).map(invitation => (
                  <Pressable key={invitation.invitationId} accessibilityRole="button" accessibilityLabel="Join channel meeting"
                    onPress={() => router.push({ pathname: "/conference", params: { meetingId: invitation.meetingId } })}
                    style={[styles.notice, { flexDirection: "row", alignItems: "center", gap: 10 }]}>
                    <MaterialIcons name="videocam" size={24} color={colors.primary} />
                    <Text style={{ color: colors.primary }}>Meeting invitation · Join</Text>
                  </Pressable>
                ))}
                <FlatList
                  ref={list}
                  data={displayedMessages}
                  keyExtractor={(item) => `${item.senderId}:${item.clientId}`}
                  contentContainerStyle={styles.messages}
                  keyboardDismissMode={
                    Platform.OS === "ios" ? "interactive" : "on-drag"
                  }
                  keyboardShouldPersistTaps="handled"
                  maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
                  viewabilityConfig={receiptViewabilityConfig}
                  onViewableItemsChanged={onReceiptViewableItemsChanged}
                  onLayout={() => {
                    if (
                      !searching &&
                      atBottom.current &&
                      displayedMessages.length
                    )
                      list.current?.scrollToEnd({ animated: false });
                  }}
                  onScroll={(event) => {
                    const { contentOffset, contentSize, layoutMeasurement } =
                      event.nativeEvent;
                    const wasAtBottom = atBottom.current;
                    atBottom.current =
                      contentOffset.y + layoutMeasurement.height >=
                      contentSize.height - 60;
                    if (atBottom.current) {
                      setNewMessages(false);
                      setLocalArrivalBoundary(null);
                    }
                    if (!searching && !wasAtBottom && atBottom.current)
                      void currentScope()?.markAsRead(id);
                  }}
                  scrollEventThrottle={150}
                  onContentSizeChange={() => {
                    if (
                      !searching &&
                      (initialScroll.current || atBottom.current) &&
                      messages.length
                    ) {
                      list.current?.scrollToEnd({
                        animated: !initialScroll.current,
                      });
                      initialScroll.current = false;
                    }
                  }}
                  ListHeaderComponent={
                    threadOpen && thread?.hasMore ? (
                      <Pressable
                        accessibilityRole="button"
                        disabled={threadLoading}
                        onPress={() => void loadEarlierThread()}
                        style={styles.older}
                      >
                        <Text style={{ color: colors.primary }}>
                          {threadLoading ? "Loading…" : "Load earlier replies"}
                        </Text>
                      </Pressable>
                    ) : !searching &&
                      !threadOpen &&
                      canInteract &&
                      chat.hasMore[id] ? (
                      <Pressable
                        accessibilityRole="button"
                        disabled={chat.roomLoading[id]}
                        onPress={() => {
                          atBottom.current = false;
                          void currentScope()?.loadMessages(id, true);
                        }}
                        style={styles.older}
                      >
                        <Text style={{ color: colors.primary }}>
                          {chat.roomLoading[id]
                            ? "Loading…"
                            : "Load earlier messages"}
                        </Text>
                      </Pressable>
                    ) : null
                  }
                  renderItem={({ item, index }) => {
                    const previous = displayedMessages[index - 1];
                    const isPersistedUnreadBoundary = firstUnread?.id === item.id;
                    const isLocalArrivalBoundary =
                      localArrivalBoundary?.scopeKey === localArrivalScopeKey &&
                      localArrivalBoundary.boundary.messageKey === chatMessageKey(item);
                    const newDay =
                      !previous ||
                      new Date(previous.timestamp).toDateString() !==
                        new Date(item.timestamp).toDateString();
                    return (
                      <View>
                        {(isPersistedUnreadBoundary || (!firstUnread && isLocalArrivalBoundary)) && (
                          <UnreadMessageDivider
                            kind={isPersistedUnreadBoundary ? "messages" : localArrivalBoundary?.boundary.kind}
                          />
                        )}
                        {newDay && (
                          <View style={styles.daySeparator}>
                            <View
                              style={[
                                styles.dayLine,
                                { backgroundColor: colors.border },
                              ]}
                            />
                            <Text style={{ color: colors.muted, fontSize: 12 }}>
                              {dayLabel(item.timestamp)}
                            </Text>
                            <View
                              style={[
                                styles.dayLine,
                                { backgroundColor: colors.border },
                              ]}
                            />
                          </View>
                        )}
                        <ChatMessageRow
                          message={item}
                          own={item.senderId === user.id}
                          grouped={
                            !newDay &&
                            previous?.senderId === item.senderId &&
                            item.timestamp - previous.timestamp < 300000 &&
                            !item.editedAt
                          }
                          root={threadIsCurrent && index === 0}
                          onActions={() => openMessageActions(item)}
                          onReplies={() => void openThread(item)}
                          onReaction={(emoji, selected) =>
                            void runFeature(() =>
                              messageApi.setReaction(
                                chat.workspace!.id,
                                id,
                                item.id,
                                emoji,
                                selected,
                              ),
                            )
                          }
                          onRetry={() => void retryThreadMessage(item)}
                          receiptLabel={receiptCounts[item.id] > 0 ? (channel?.kind === "direct" ? "Read" : `Read by ${receiptCounts[item.id]}`) : undefined}
                          onReadReceipts={() => void openReadReceipts(item)}
                          ownName={user.name}
                          ownPhotoUrl={ownProfile?.photoUrl}
                          ownPhotoVersion={ownProfile?.photoVersion}
                          tenantId={chat.workspace?.id}
                        />
                      </View>
                    );
                  }}
                  ListEmptyComponent={
                    <View style={styles.empty}>
                      {threadLoading ? (
                        <ActivityIndicator color={colors.primary} />
                      ) : threadError ? (
                        <Text style={{ color: colors.error }}>
                          {threadError}
                        </Text>
                      ) : searching ? (
                        searchLoading ? (
                          <ActivityIndicator color={colors.primary} />
                        ) : (
                          <Text
                            style={{
                              color: searchError ? colors.error : colors.muted,
                            }}
                          >
                            {searchError ||
                              (searchText.trim().length < 2
                                ? "Enter a word or phrase to search this conversation."
                                : "No saved messages match your search.")}
                          </Text>
                        )
                      ) : chat.roomLoading[id] || chat.loading ? (
                        <ActivityIndicator color={colors.primary} />
                      ) : (
                        <>
                          <Text
                            style={[
                              styles.emptyTitle,
                              { color: colors.foreground },
                            ]}
                          >
                            {channel
                              ? "Start the conversation"
                              : "Conversation unavailable"}
                          </Text>
                          <Text
                            style={{ color: colors.muted, textAlign: "center" }}
                          >
                            {channel
                              ? "Messages are saved to your workspace when sent."
                              : "Refresh Team Chat to check your access."}
                          </Text>
                        </>
                      )}
                    </View>
                  }
                />
                {newMessages && !searching && (
                  <NewMessagesJump
                    kind={
                      localArrivalBoundary?.scopeKey === localArrivalScopeKey
                        ? localArrivalBoundary.boundary.kind
                        : localArrivalKind
                    }
                    onPress={() => {
                      atBottom.current = true;
                      setNewMessages(false);
                      setLocalArrivalBoundary(null);
                      list.current?.scrollToEnd({ animated: true });
                      void currentScope()?.markAsRead(id);
                    }}
                  />
                )}
                {!searching && (
                  <View
                    style={[
                      styles.composer,
                      {
                        borderTopColor: colors.border,
                        backgroundColor: colors.background,
                      },
                    ]}
                  >
                    {channel?.blocked && (
                      <Text style={{ width: "100%", color: colors.error }}>
                        Direct messages are blocked. Saved messages remain
                        available.
                      </Text>
                    )}
                    {replyTo &&
                      !(threadIsCurrent && replyTo.id === thread?.root.id) && (
                        <View
                          style={[
                            styles.replyPreview,
                            {
                              backgroundColor: colors.surface,
                              borderColor: colors.border,
                            },
                          ]}
                        >
                          <View style={{ flex: 1 }}>
                            <Text
                              style={{
                                color: colors.primary,
                                fontSize: 12,
                                fontWeight: "700",
                              }}
                            >
                              {threadOpen
                                ? "Replying in this thread"
                                : `Replying to ${replyTo.senderName}`}
                            </Text>
                            <Text
                              numberOfLines={2}
                              style={{ color: colors.foreground, fontSize: 13 }}
                            >
                              {replyTo.content}
                            </Text>
                          </View>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Cancel reply"
                            onPress={() =>
                              setReplyTo(
                                threadIsCurrent ? thread?.root || null : null,
                              )
                            }
                            style={styles.cancelReply}
                          >
                            <Text
                              style={{ color: colors.primary, fontSize: 18 }}
                            >
                              ×
                            </Text>
                          </Pressable>
                        </View>
                      )}
                    {uploading && (
                      <View
                        style={{
                          flexDirection: "row",
                          gap: 8,
                          alignItems: "center",
                        }}
                      >
                        <ActivityIndicator color={colors.primary} />
                        <Text style={{ color: colors.muted }}>
                          Uploading attachment…
                        </Text>
                      </View>
                    )}
                    {attachments.map((a) => (
                      <View
                        key={a.id}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        {localPreviews[a.id] ? (
                          <Image
                            source={{ uri: localPreviews[a.id] }}
                            style={{ width: 52, height: 52, borderRadius: 8 }}
                          />
                        ) : (
                          <MaterialIcons
                            name="attach-file"
                            size={20}
                            color={colors.primary}
                          />
                        )}
                        <Text
                          numberOfLines={1}
                          style={{ flex: 1, color: colors.foreground }}
                        >
                          {a.filename}
                        </Text>
                        <Pressable
                          accessibilityLabel={`Remove ${a.filename}`}
                          accessibilityRole="button"
                          onPress={() =>
                            setAttachments((items) =>
                              items.filter((item) => item.id !== a.id),
                            )
                          }
                          style={{
                            minWidth: 44,
                            minHeight: 44,
                            justifyContent: "center",
                            alignItems: "center",
                          }}
                        >
                          <MaterialIcons
                            name="close"
                            size={20}
                            color={colors.muted}
                          />
                        </Pressable>
                      </View>
                    ))}
                    {emojiOpen && (
                      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                        {QUICK_EMOJI.map((emoji) => (
                          <Pressable
                            key={emoji}
                            accessibilityLabel={`Insert ${emoji}`}
                            accessibilityRole="button"
                            onPress={() => {
                              const nextDraft = draft + emoji;
                              setDraft(nextDraft);
                              typing.onUserEdit(nextDraft);
                              setEmojiOpen(false);
                            }}
                            style={{
                              minWidth: 44,
                              minHeight: 44,
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <Text style={{ fontSize: 26 }}>{emoji}</Text>
                          </Pressable>
                        ))}
                      </View>
                    )}
                    {mentionOpen && (
                      <MentionPicker
                        people={details && actionIsCurrent(detailsScope.current) ? details.members : []}
                        query={mentionTrigger?.query || ""}
                        tenantId={chat.workspace?.id}
                        canMentionAll={details?.canMentionAll === true && !activeAllMention}
                        loading={mentionLoading}
                        onPick={pickMention}
                        onPickAll={pickAllMention}
                      />
                    )}
                    <TypingIndicator names={typing.names} />
                    <View style={styles.composerRow}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Add attachment"
                        disabled={!canCompose || uploading}
                        onPress={() => setAttachmentOpen(true)}
                        style={styles.overflow}
                      >
                        <MaterialIcons
                          name="add"
                          size={26}
                          color={colors.muted}
                        />
                      </Pressable>
                      <TextInput
                        ref={composerInput}
                        accessibilityLabel="Message"
                        value={draft}
                        onChangeText={applyComposerChange}
                        onSelectionChange={(event) => {
                          const selection = event.nativeEvent.selection;
                          composerSelection.current = selection;
                          syncMentionTrigger(composerDraft.current, selection, composerMentionList.current, composerAllMention.current);
                        }}
                        onBlur={() => { setMentionTrigger(null); void typing.stop(); }}
                        editable={canCompose}
                        multiline
                        scrollEnabled
                        maxLength={4000}
                        textAlignVertical="top"
                        placeholder={
                          canCompose
                            ? threadOpen
                              ? "Reply…"
                              : `Message ${channel?.name || ""}`
                            : "Connect to chat to send"
                        }
                        placeholderTextColor={colors.muted}
                        style={[
                          styles.input,
                          {
                            color: colors.foreground,
                            backgroundColor: colors.surface,
                          },
                        ]}
                      />
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Emoji"
                        onPress={() => setEmojiOpen(!emojiOpen)}
                        style={styles.overflow}
                      >
                        <MaterialIcons
                          name="sentiment-satisfied-alt"
                          size={24}
                          color={colors.muted}
                        />
                      </Pressable>
                      {!draft.trim() && !attachments.length ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Record voice note"
                          disabled={!canCompose || uploading}
                          onPress={() => setVoiceOpen(true)}
                          style={styles.overflow}
                        >
                          <MaterialIcons
                            name="mic-none"
                            size={26}
                            color={colors.muted}
                          />
                        </Pressable>
                      ) : (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Send message"
                          disabled={
                            sending ||
                            uploading ||
                            !canCompose ||
                            (!draft.trim() && !attachments.length)
                          }
                          onPress={send}
                          style={[
                            styles.send,
                            {
                              backgroundColor: colors.primary,
                              opacity:
                                !sending &&
                                !uploading &&
                                canCompose &&
                                (draft.trim() || attachments.length)
                                  ? 1
                                  : 0.4,
                            },
                          ]}
                        >
                          {sending ? (
                            <Text style={{ color: "white", fontWeight: "700" }}>
                              Sending…
                            </Text>
                          ) : (
                            <MaterialIcons
                              name="arrow-upward"
                              size={22}
                              color="white"
                            />
                          )}
                        </Pressable>
                      )}
                    </View>
                  </View>
                )}
              </View>
            )}
            {aiMode && ownsWorkspace && chat.workspace && (
              <ChatAssistantSheet
                key={`${user?.id}:${chat.workspace.id}:${id}:${aiMode.mode}:${aiMode.messageId || ""}`}
                mode={aiMode.mode}
                tenantId={chat.workspace.id}
                roomId={id}
                messageId={aiMode.messageId}
                draft={draft}
                onClose={() => setAiMode(null)}
                onDraft={setDraft}
              />
            )}
            <Modal
              visible={savedOpen}
              animationType="slide"
              onRequestClose={() => setSavedOpen(false)}
            >
              <ScreenContainer>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    padding: 16,
                  }}
                >
                  <Text
                    style={{
                      flex: 1,
                      fontSize: 20,
                      fontWeight: "700",
                      color: colors.foreground,
                    }}
                  >
                    {collectionTitle}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Close saved messages"
                    onPress={() => setSavedOpen(false)}
                    style={styles.overflow}
                  >
                    <Text style={{ color: colors.primary }}>Close</Text>
                  </Pressable>
                </View>
                <ScrollView contentContainerStyle={{ padding: 16 }}>
                  {featureBusy ? (
                    <ActivityIndicator color={colors.primary} />
                  ) : !savedMessages.length ? (
                    <Text style={{ color: colors.muted }}>
                      No messages here yet.
                    </Text>
                  ) : (
                    savedMessages.map((item) => (
                      <Pressable
                        key={item.id}
                        accessibilityRole="button"
                        accessibilityLabel={`Open saved message from ${item.senderName}`}
                        onPress={() => {
                          setSavedOpen(false);
                          void openThread(item);
                        }}
                        style={{
                          padding: 16,
                          borderBottomWidth: 1,
                          borderBottomColor: colors.border,
                          gap: 6,
                        }}
                      >
                        <Text style={{ color: colors.muted, fontSize: 12 }}>
                          {item.senderName} · {formatChatTime(item.timestamp)}
                        </Text>
                        <Text
                          numberOfLines={4}
                          style={{ color: colors.foreground, fontSize: 16 }}
                        >
                          {item.content ||
                            item.attachments?.map((a) => a.filename).join(", ")}
                        </Text>
                      </Pressable>
                    ))
                  )}
                </ScrollView>
              </ScreenContainer>
            </Modal>
            <Modal
              visible={voiceOpen && ownsWorkspace}
              transparent
              animationType="slide"
              onRequestClose={() => setVoiceOpen(false)}
            >
              <View style={styles.modalBackdrop}>
                <View
                  accessibilityViewIsModal
                  style={[styles.voiceSheet, { backgroundColor: colors.background }]}
                >
                  {voiceOpen && ownsWorkspace && (
                    <VoiceNote
                      onReady={attachVoice}
                      onClose={() => setVoiceOpen(false)}
                      onReturnToKeyboard={returnToComposerFromVoiceNote}
                    />
                  )}
                </View>
              </View>
            </Modal>
            <Modal
              visible={!!forwardTarget}
              transparent
              animationType="slide"
              onRequestClose={() => setForwardTarget(null)}
            >
              <View style={styles.modalBackdrop}>
                <View
                  style={[
                    styles.sheet,
                    { backgroundColor: colors.background, maxHeight: "75%" },
                  ]}
                >
                  <Text
                    style={[styles.sheetTitle, { color: colors.foreground }]}
                  >
                    Forward to
                  </Text>
                  {actionError && (
                    <Text
                      accessibilityRole="alert"
                      style={{ color: colors.error }}
                    >
                      {actionError}
                    </Text>
                  )}
                  <ScrollView>
                    {chat.channels
                      .filter((room) => room.id !== id && !room.blocked)
                      .map((room) => (
                        <Pressable
                          key={room.id}
                          accessibilityRole="button"
                          accessibilityLabel={`Forward to ${room.name}`}
                          disabled={featureBusy}
                          style={styles.sheetAction}
                          onPress={() => {
                            const target = forwardTarget;
                            if (target)
                              void runFeature(async () => {
                                await messageApi.forward(
                                  chat.workspace!.id,
                                  room.id,
                                  id,
                                  target.id,
                                  forwardId.current,
                                );
                                if (currentScope()) setForwardTarget(null);
                              });
                          }}
                        >
                          <Text style={{ color: colors.foreground }}>
                            {room.name}
                          </Text>
                        </Pressable>
                      ))}
                  </ScrollView>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Cancel forwarding"
                    style={styles.sheetAction}
                    onPress={() => setForwardTarget(null)}
                  >
                    <Text style={{ color: colors.primary }}>Cancel</Text>
                  </Pressable>
                </View>
              </View>
            </Modal>
            <Modal
              visible={attachmentOpen}
              transparent
              animationType="slide"
              onRequestClose={() => setAttachmentOpen(false)}
            >
              <Pressable
                style={styles.modalBackdrop}
                onPress={() => setAttachmentOpen(false)}
              >
                <View
                  style={[styles.sheet, { backgroundColor: colors.background }]}
                >
                  <Text
                    style={[styles.sheetTitle, { color: colors.foreground }]}
                  >
                    Add to message
                  </Text>
                  {(["photo", "camera", "file"] as const).map((kind) => (
                    <Pressable
                      key={kind}
                      accessibilityRole="button"
                      accessibilityLabel={
                        kind === "photo"
                          ? "Choose photo or video"
                          : kind === "camera"
                            ? "Take photo"
                            : "Choose file"
                      }
                      style={styles.sheetAction}
                      onPress={() => void chooseAttachment(kind)}
                    >
                      <Text style={{ color: colors.foreground }}>
                        {kind === "photo"
                          ? "Photos and videos"
                          : kind === "camera"
                            ? "Camera"
                            : "Files"}
                      </Text>
                    </Pressable>
                  ))}
                  {(channel?.kind === "group" || channel?.kind === "channel") && (
                    <Pressable accessibilityRole="button" accessibilityLabel="Mention a person" style={styles.sheetAction}
                      onPress={() => { setAttachmentOpen(false); openMentions(); }}>
                      <Text style={{ color: colors.foreground }}>Mention a person</Text>
                    </Pressable>
                  )}
                  <Text style={{ color: colors.muted }}>
                    Up to 10 MB per file
                  </Text>
                </View>
              </Pressable>
            </Modal>
            <Modal
              visible={!!editing}
              transparent
              animationType="slide"
              onRequestClose={() => setEditing(null)}
            >
              <KeyboardAvoidingView
                behavior={Platform.OS === "ios" ? "padding" : undefined}
                style={styles.modalBackdrop}
              >
                <View
                  style={[styles.sheet, { backgroundColor: colors.background }]}
                >
                  <Text
                    style={[styles.sheetTitle, { color: colors.foreground }]}
                  >
                    Edit message
                  </Text>
                  {actionError && (
                    <Text
                      accessibilityRole="alert"
                      style={{ color: colors.error }}
                    >
                      {actionError}
                    </Text>
                  )}
                  <TextInput
                    accessibilityLabel="Edit message text"
                    value={editText}
                    onChangeText={setEditText}
                    multiline
                    maxLength={4000}
                    style={[
                      styles.input,
                      {
                        flex: 0,
                        color: colors.foreground,
                        backgroundColor: colors.surface,
                      },
                    ]}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Save edited message"
                    disabled={featureBusy || !editText.trim()}
                    onPress={() => {
                      if (editing)
                        void runFeature(async () => {
                          await messageApi.edit(
                            chat.workspace!.id,
                            id,
                            editing.id,
                            editText,
                          );
                          if (currentScope()) setEditing(null);
                        });
                    }}
                    style={styles.sheetAction}
                  >
                    <Text style={{ color: colors.primary }}>Save</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Cancel editing"
                    onPress={() => setEditing(null)}
                    style={styles.sheetAction}
                  >
                    <Text style={{ color: colors.muted }}>Cancel</Text>
                  </Pressable>
                </View>
              </KeyboardAvoidingView>
            </Modal>
            <Modal
              visible={menuOpen && !searching}
              transparent
              animationType="fade"
              onRequestClose={() => setMenuOpen(false)}
            >
              <View style={styles.menuBackdrop}>
                <Pressable
                  style={styles.menuDismiss}
                  accessibilityRole="button"
                  accessibilityLabel="Close conversation menu"
                  onPress={() => setMenuOpen(false)}
                />
                <View
                  style={[
                    styles.overflowMenu,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                    },
                  ]}
                  accessibilityRole="menu"
                >
                  <Pressable
                    accessibilityRole="menuitem"
                    accessibilityLabel="Saved messages"
                    onPress={() => void openCollection("saved")}
                    style={styles.menuItem}
                  >
                    <Text style={{ color: colors.foreground }}>
                      Saved messages
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="menuitem"
                    accessibilityLabel="Pinned messages"
                    onPress={() => void openCollection("pinned")}
                    style={styles.menuItem}
                  >
                    <Text style={{ color: colors.foreground }}>
                      Pinned messages
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="menuitem"
                    accessibilityLabel="Mute conversation"
                    onPress={() =>
                      void runFeature(async () => {
                        await messageApi.setNotificationMute(
                          chat.workspace!.id,
                          id,
                          !channel?.notificationsMuted,
                        );
                        await currentScope()?.loadChannels();
                        setMenuOpen(false);
                      })
                    }
                    style={styles.menuItem}
                  >
                    <Text style={{ color: colors.foreground }}>
                      {channel?.notificationsMuted
                        ? "Unmute notifications"
                        : "Mute notifications"}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="menuitem"
                    accessibilityLabel="Search messages"
                    onPress={openSearch}
                    style={styles.menuItem}
                  >
                    <Text style={{ color: colors.foreground }}>
                      Search messages
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="menuitem"
                    accessibilityLabel="Report conversation"
                    onPress={() => openSafety(null)}
                    style={styles.menuItem}
                  >
                    <Text style={{ color: colors.foreground }}>
                      Report conversation
                    </Text>
                  </Pressable>
                  {channel?.kind === "direct" &&
                    directPeerId &&
                    (channel.blocked ? (
                      <Pressable
                        accessibilityRole="menuitem"
                        accessibilityLabel="Unblock direct messages"
                        onPress={() => openSafety(null, "unblock")}
                        style={styles.menuItem}
                      >
                        <Text style={{ color: colors.primary }}>
                          Unblock direct messages
                        </Text>
                      </Pressable>
                    ) : (
                      <Pressable
                        accessibilityRole="menuitem"
                        accessibilityLabel={`Block ${channel.name}`}
                        onPress={() => openSafety(null, "block")}
                        style={styles.menuItem}
                      >
                        <Text style={{ color: colors.error }}>
                          Block {channel.name}
                        </Text>
                      </Pressable>
                    ))}
                </View>
              </View>
            </Modal>
            <Modal
              visible={!!messageMenuTarget}
              transparent
              animationType="fade"
              onRequestClose={() => setMessageMenuTarget(null)}
            >
              <Pressable
                style={styles.modalBackdrop}
                accessibilityRole="button"
                accessibilityLabel="Close message actions"
                onPress={() => setMessageMenuTarget(null)}
              >
                <Pressable
                  style={[
                    styles.sheet,
                    { backgroundColor: colors.background, maxHeight: "80%" },
                  ]}
                  accessibilityViewIsModal
                  onPress={() => undefined}
                >
                  <View style={styles.sheetHeader}>
                    <Text
                      style={[styles.sheetTitle, { color: colors.foreground }]}
                    >
                      Message actions
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Done with message actions"
                      onPress={() => setMessageMenuTarget(null)}
                      style={styles.closeSheet}
                    >
                      <Text style={{ color: colors.primary }}>Done</Text>
                    </Pressable>
                  </View>
                  <ScrollView
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={{ paddingBottom: 12 }}
                  >
                    <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                      {QUICK_EMOJI.map((emoji) => (
                        <Pressable
                          key={emoji}
                          accessibilityRole="button"
                          accessibilityLabel={`React ${emoji}`}
                          disabled={
                            featureBusy || !!messageMenuTarget?.deletedAt
                          }
                          onPress={() =>
                            messageMenuTarget &&
                            void runFeature(() =>
                              messageApi.setReaction(
                                chat.workspace!.id,
                                id,
                                messageMenuTarget.id,
                                emoji,
                                !messageMenuTarget.reactions?.some(
                                  (r) => r.emoji === emoji && r.reacted,
                                ),
                              ),
                            )
                          }
                          style={{
                            minWidth: 44,
                            minHeight: 44,
                            justifyContent: "center",
                            alignItems: "center",
                          }}
                        >
                          <Text style={{ fontSize: 26 }}>{emoji}</Text>
                        </Pressable>
                      ))}
                    </View>
                    {messageMenuTarget?.reactions?.map((r) => (
                      <Text
                        key={r.emoji}
                        style={{
                          color: colors.muted,
                          fontSize: 13,
                          paddingVertical: 4,
                        }}
                      >
                        {r.emoji}{" "}
                        {r.users.map((person) => person.name).join(", ")}
                      </Text>
                    ))}
                    {messageMenuTarget && (
                      <>
                        {aiAvailable && !messageMenuTarget.deletedAt && (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Translate message"
                            style={styles.sheetAction}
                            onPress={() => {
                              setAiMode({
                                mode: "translation",
                                messageId: messageMenuTarget.id,
                              });
                              setMessageMenuTarget(null);
                            }}
                          >
                            <Text style={{ color: colors.foreground }}>
                              Translate…
                            </Text>
                          </Pressable>
                        )}
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Forward message"
                          disabled={!!messageMenuTarget.deletedAt}
                          style={styles.sheetAction}
                          onPress={() => {
                            forwardId.current = newUploadId();
                            setForwardTarget(messageMenuTarget);
                            setMessageMenuTarget(null);
                          }}
                        >
                          <Text style={{ color: colors.foreground }}>
                            Forward…
                          </Text>
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Save message"
                          disabled={featureBusy}
                          style={styles.sheetAction}
                          onPress={() =>
                            void runFeature(() =>
                              messageApi.setBookmark(
                                chat.workspace!.id,
                                id,
                                messageMenuTarget.id,
                                !messageMenuTarget.isBookmarked,
                              ),
                            )
                          }
                        >
                          <Text style={{ color: colors.foreground }}>
                            {messageMenuTarget.isBookmarked
                              ? "Remove from saved"
                              : "Save for me"}
                          </Text>
                        </Pressable>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Pin message"
                          disabled={featureBusy}
                          style={styles.sheetAction}
                          onPress={() =>
                            void runFeature(() =>
                              messageApi.setPin(
                                chat.workspace!.id,
                                id,
                                messageMenuTarget.id,
                                !messageMenuTarget.isPinned,
                              ),
                            )
                          }
                        >
                          <Text style={{ color: colors.foreground }}>
                            {messageMenuTarget.isPinned
                              ? "Unpin"
                              : "Pin for everyone"}
                          </Text>
                        </Pressable>
                        {messageMenuTarget.senderId === user?.id &&
                          !messageMenuTarget.deletedAt && (
                            <>
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Edit message"
                                onPress={() => {
                                  setEditing(messageMenuTarget);
                                  setEditText(messageMenuTarget.content);
                                  setMessageMenuTarget(null);
                                }}
                                style={styles.sheetAction}
                              >
                                <Text style={{ color: colors.foreground }}>
                                  Edit
                                </Text>
                              </Pressable>
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Delete message"
                                disabled={featureBusy}
                                onPress={() => {
                                  const target = messageMenuTarget;
                                  Alert.alert(
                                    "Delete message?",
                                    "This removes the message for everyone. Replies remain.",
                                    [
                                      { text: "Cancel", style: "cancel" },
                                      {
                                        text: "Delete",
                                        style: "destructive",
                                        onPress: () =>
                                          void runFeature(() =>
                                            messageApi.deleteMessage(
                                              chat.workspace!.id,
                                              id,
                                              target.id,
                                            ),
                                          ),
                                      },
                                    ],
                                  );
                                }}
                                style={styles.sheetAction}
                              >
                                <Text style={{ color: colors.error }}>
                                  Delete for everyone
                                </Text>
                              </Pressable>
                            </>
                          )}
                        {messageMenuTarget.senderId === user?.id && messageMenuTarget.status === "sent" && (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Message details"
                            style={styles.sheetAction}
                            onPress={() => void openReadReceipts(messageMenuTarget)}
                          >
                            <Text style={{ color: colors.foreground }}>Message details</Text>
                          </Pressable>
                        )}
                      </>
                    )}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Reply"
                      disabled={!canCompose}
                      onPress={() =>
                        messageMenuTarget && selectReply(messageMenuTarget)
                      }
                      style={styles.sheetAction}
                    >
                      <Text style={{ color: colors.foreground }}>Reply</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="View replies"
                      disabled={!canInteract}
                      onPress={() =>
                        messageMenuTarget && void openThread(messageMenuTarget)
                      }
                      style={styles.sheetAction}
                    >
                      <Text style={{ color: colors.foreground }}>
                        View replies
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Copy message"
                      onPress={() =>
                        messageMenuTarget && void copyMessage(messageMenuTarget)
                      }
                      style={styles.sheetAction}
                    >
                      <Text style={{ color: colors.foreground }}>Copy</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Report message"
                      onPress={() =>
                        messageMenuTarget && openSafety(messageMenuTarget)
                      }
                      style={styles.sheetAction}
                    >
                      <Text style={{ color: colors.error }}>Report</Text>
                    </Pressable>
                  </ScrollView>
                </Pressable>
              </Pressable>
            </Modal>
            <ReadReceiptSheet visible={receiptTargetIsCurrent} loading={receiptLoading} rows={receiptRows} error={receiptError} onClose={closeReadReceipts} />
            <Modal
              visible={safetyOpen && !searching}
              transparent
              animationType="slide"
              onRequestClose={closeSafety}
            >
              <KeyboardAvoidingView
                testID="report-keyboard-avoiding"
                style={styles.modalBackdrop}
                behavior={Platform.OS === "ios" ? "padding" : undefined}
              >
                <ScrollView
                  contentContainerStyle={styles.reportScroll}
                  keyboardShouldPersistTaps="handled"
                >
                  <View
                    style={[
                      styles.sheet,
                      { backgroundColor: colors.background },
                    ]}
                    accessibilityViewIsModal
                  >
                    <View style={styles.sheetHeader}>
                      <Text
                        style={[
                          styles.sheetTitle,
                          { color: colors.foreground },
                        ]}
                      >
                        {safetyConfirm === "block"
                          ? `Block ${safetySubject}`
                          : safetyConfirm === "unblock"
                            ? "Unblock direct messages"
                            : safetyTarget
                              ? `Report ${safetyTarget.senderName}'s message`
                              : "Report conversation"}
                      </Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Close report form"
                        disabled={safetyLoading}
                        onPress={closeSafety}
                        style={styles.closeSheet}
                      >
                        <Text style={{ color: colors.primary, fontSize: 20 }}>
                          ×
                        </Text>
                      </Pressable>
                    </View>
                    {!safetyConfirm && (
                      <>
                        <Text style={{ color: colors.muted }}>
                          Choose a category and add details if they help the
                          review.
                        </Text>
                        <View style={styles.safetyCategories}>
                          {(
                            [
                              "spam",
                              "harassment",
                              "safety",
                              "other",
                            ] as SafetyCategory[]
                          ).map((category) => (
                            <Pressable
                              key={category}
                              accessibilityRole="button"
                              accessibilityLabel={`Report category ${category}`}
                              onPress={() => setSafetyCategory(category)}
                              style={[
                                styles.category,
                                {
                                  borderColor: colors.border,
                                  backgroundColor:
                                    safetyCategory === category
                                      ? colors.primary
                                      : colors.surface,
                                },
                              ]}
                            >
                              <Text
                                style={{
                                  color:
                                    safetyCategory === category
                                      ? "white"
                                      : colors.foreground,
                                  textTransform: "capitalize",
                                }}
                              >
                                {category}
                              </Text>
                            </Pressable>
                          ))}
                        </View>
                        <TextInput
                          accessibilityLabel="Safety report comment"
                          value={safetyComment}
                          onChangeText={setSafetyComment}
                          maxLength={500}
                          multiline
                          placeholder="Optional comment"
                          placeholderTextColor={colors.muted}
                          style={[
                            styles.reportInput,
                            {
                              color: colors.foreground,
                              backgroundColor: colors.surface,
                              borderColor: colors.border,
                            },
                          ]}
                        />
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={
                            safetyTarget
                              ? "Submit message report"
                              : "Submit conversation report"
                          }
                          onPress={() => setSafetyConfirm("report")}
                          style={[
                            styles.primaryAction,
                            { backgroundColor: colors.primary },
                          ]}
                        >
                          <Text style={{ color: "white", fontWeight: "700" }}>
                            Continue
                          </Text>
                        </Pressable>
                      </>
                    )}
                    {safetyConfirm && (
                      <>
                        <Text style={{ color: colors.muted }}>
                          {safetyConfirm === "block"
                            ? `Block ${safetySubject}? New direct messages will stop for both people.`
                            : safetyConfirm === "unblock"
                              ? "Unblock your direct-message policy for this person? Their own block, if any, still applies."
                              : `Send this ${safetyTarget ? "message" : "conversation"} report? The other member will not see who reported it.`}
                        </Text>
                        <View style={styles.confirmActions}>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Cancel safety action"
                            disabled={safetyLoading}
                            onPress={() => setSafetyConfirm(null)}
                            style={styles.sheetAction}
                          >
                            <Text style={{ color: colors.primary }}>
                              Cancel
                            </Text>
                          </Pressable>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Confirm safety action"
                            disabled={safetyLoading}
                            onPress={() => void submitSafety()}
                            style={styles.sheetAction}
                          >
                            <Text style={{ color: colors.error }}>
                              {safetyLoading ? "Saving…" : "Confirm"}
                            </Text>
                          </Pressable>
                        </View>
                      </>
                    )}
                    {safetyError && (
                      <Text
                        accessibilityLiveRegion="polite"
                        style={{ color: colors.error }}
                      >
                        {safetyError}
                      </Text>
                    )}
                  </View>
                </ScrollView>
              </KeyboardAvoidingView>
            </Modal>
            <ConversationDetails visible={detailsOpen && ownsWorkspace} loading={detailsLoading} details={details} error={detailsError} onRetry={() => void openDetails()} onClose={() => setDetailsOpen(false)} />
            <ChannelMeetingPicker
              visible={channelMeetingOpen && actionIsCurrent(channelMeetingScope)}
              tenantId={chat.workspace?.id || 0}
              channelId={id}
              channelName={channel?.name || "Channel"}
              hostId={user?.id || 0}
              members={channelMeetingMembers}
              loading={channelMeetingLoading}
              rosterError={channelMeetingRosterError}
              error={channelMeetingError}
              busy={channelMeetingBusy}
              startAvailable={channelMeetingCapability?.available === true && channelMeetingCapability.canStart}
              maxSelectedMembers={channelMeetingCapability?.maxSelectedMembers}
              unavailableReason={channelMeetingCapabilityLoading
                ? "Checking meeting permissions…"
                : channelMeetingCapabilityError
                  ? "Meeting permissions could not be checked. Close and reopen the picker to try again."
                  : "Starting meetings is not enabled for your account in this channel."}
              onCancel={closeChannelMeetingPicker}
              onStart={memberIds => void startChannelMeeting(memberIds)}
            />
          </View>
        </View>
      </ScreenContainer>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardRoot: { flex: 1 },
  header: {
    width: "100%",
    maxWidth: 860,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    minHeight: 58,
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  back: {
    width: 44,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingLeft: 8,
  },
  headerTitleBlock: { flex: 1, minWidth: 0, justifyContent: "center", gap: 1 },
  title: {
    minWidth: 0,
    fontSize: 17,
    lineHeight: 21,
    fontWeight: "700",
    letterSpacing: -0.15,
  },
  memberContext: { fontSize: 12, lineHeight: 15 },
  overflow: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  menuBackdrop: {
    flex: 1,
    alignItems: "flex-end",
    paddingTop: 70,
    paddingRight: 12,
  },
  menuDismiss: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  overflowMenu: {
    minWidth: 230,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    overflow: "hidden",
    elevation: 4,
  },
  menuItem: { minHeight: 46, justifyContent: "center", paddingHorizontal: 16 },
  search: {
    width: "100%",
    maxWidth: 860,
    alignSelf: "center",
    padding: 12,
    gap: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchClose: {
    minWidth: 52,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
  },
  messages: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexGrow: 1,
    width: "100%",
    maxWidth: 860,
    alignSelf: "center",
  },
  message: { maxWidth: "86%", marginBottom: 14 },
  groupedMessage: { marginTop: -9 },
  senderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
  },
  messageAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  bubble: {
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
  },
  threadRoot: { borderWidth: 1.5 },
  quote: { borderLeftWidth: 3, paddingLeft: 8, marginBottom: 8, gap: 2 },
  messageMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
  },
  retry: { paddingVertical: 8, alignSelf: "flex-end" },
  parentLabel: {
    fontSize: 11,
    fontWeight: "700",
    marginBottom: 5,
    textTransform: "uppercase",
  },
  daySeparator: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginVertical: 12,
  },
  dayLine: { flex: 1, height: StyleSheet.hairlineWidth },
  notice: { padding: 12 },
  noticeText: { paddingHorizontal: 12, paddingBottom: 8, color: "#B42318" },
  older: { padding: 12, alignItems: "center" },
  empty: {
    padding: 30,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  emptyTitle: { fontSize: 20, fontWeight: "600" },
  composer: {
    width: "100%",
    maxWidth: 860,
    alignSelf: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  composerRow: {
    width: "100%",
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-end",
  },
  replyPreview: {
    width: "100%",
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  cancelReply: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 42,
    maxHeight: 118,
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderRadius: 18,
    fontSize: 16,
    lineHeight: 20,
  },
  send: {
    minHeight: 42,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 16,
    paddingHorizontal: 15,
  },
  sendLabel: { color: "white", fontSize: 15, fontWeight: "700" },
  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  reportScroll: { flexGrow: 1, justifyContent: "flex-end", paddingTop: 24 },
  sheet: {
    marginHorizontal: 8,
    marginBottom: 8,
    borderRadius: 18,
    padding: 16,
    gap: 10,
    maxWidth: 560,
    alignSelf: "center",
    width: "96%",
  },
  voiceSheet: {
    marginHorizontal: 8,
    marginBottom: 8,
    borderRadius: 24,
    padding: 18,
    maxWidth: 560,
    alignSelf: "center",
    width: "96%",
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sheetTitle: { fontSize: 17, fontWeight: "700" },
  closeSheet: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetAction: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  safetyCategories: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  category: {
    minHeight: 44,
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 10,
  },
  reportInput: {
    minHeight: 96,
    maxHeight: 160,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
    textAlignVertical: "top",
  },
  primaryAction: {
    minHeight: 44,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  confirmActions: { flexDirection: "row", justifyContent: "flex-end", gap: 10 },
});
