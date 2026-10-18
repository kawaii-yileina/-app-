import { useEffect, useLayoutEffect, useRef, useState, Fragment, type ReactNode } from 'react';
import { useParams, useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { Input, Button, Popup, Toast, SpinLoading, ImageViewer, Picker, SearchBar, Dialog } from 'antd-mobile';
import { Smile, Plus, Image, Camera, Video, Film, Folder, Trash2, Mic, Keyboard, Copy, Quote, Forward, Undo2, Download, Phone } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '../../store/useChatStore';
import { useContactStore } from '../../store/useContactStore';
import { useAuthStore } from '../../store/useAuthStore';
import { useOnlineStore } from '../../store/useOnlineStore';
import { useAiChatStore } from '../../stores/aiChatStore';
import { messageApi, fileApi, contactApi, emojiApi, MAX_UPLOAD_BYTES } from '../../api';
import { uploadResumable } from '../../services/upload';
import { getModels, getSessionDetail, lockModel, type HermesModel } from '../../api/hermes';
import { downloadFile } from '../../utils/download';
import { uploadErrorMessage } from '../../utils/uploadError';
import { resolveFileUrl } from '../../utils/fileUrl';
import {
  truncatePreview,
  buildForwardPayload,
  buildReplyInfo,
  normalizeServerMessage,
  pruneMentions,
  PENDING_OUTGOING_KEY,
  PENDING_FORWARD_KEY,
  REPLY_HEADER_KEY,
  MENTIONS_HEADER_KEY,
  MENTION_ALL,
  type PendingOutgoing,
} from '../../utils/messagePreview';
import { fileToBase64 } from '../../services/aiChat';
import { syncConversation } from '../../services/messageSync';
import wsService from '../../services/websocket';
import { startRecording, stopRecording, cancelRecording, isRecordingSupported, isRecordingActive } from '../../services/recorder';
import MessageBubble from '../../components/MessageBubble';
import SharedAvatar from '../../components/SharedAvatar';
import type { Message, ChatMessage, GroupMember, MentionInfo, EmojiSticker } from '../../types';
import { AI_ASSISTANT } from '../../types';
import { useBackGuard } from '../../hooks/useBackGuard';
import styles from './index.module.css';
import callManager from '../../services/call';

/** 内置 Emoji（C1 第一批，后续可扩展分类面板） */
const EMOJIS = [
  '😀', '😄', '😁', '😆', '😅', '😂', '🙂', '😉',
  '😊', '😍', '😘', '😜', '🤔', '😎', '😢', '😭',
  '😡', '🥰', '😴', '🤗', '👍', '👎', '👌', '🙏',
  '👏', '💪', '🎉', '❤️', '💔', '🔥', '✨', '🌟',
  '🍀', '🌈', '☀️', '🌙', '🍎', '🍕', '☕', '🎁',
];

const ChatWindow = () => {
  const { t } = useTranslation();
  const { targetId } = useParams<{ targetId: string }>();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const chatType = parseInt(searchParams.get('type') || '0');
  const sessionId = searchParams.get('session');
  const aroundSeq = Number(searchParams.get('aroundSeq') || 0);
  const focusMsgId = searchParams.get('msgId') || '';
  const isAiChat = String(targetId) === String(AI_ASSISTANT.ID);

  const user = useAuthStore((s) => s.user);
  const messages = useChatStore((s) => s.messages);
  const addMessage = useChatStore((s) => s.addMessage);
  const updateConversation = useChatStore((s) => s.updateConversation);
  const friends = useContactStore((s) => s.friends);
  const groups = useContactStore((s) => s.groups);
  const onlineUsers = useOnlineStore((s) => s.onlineUsers);

  // AI 聊天 store
  const aiMessages = useAiChatStore((s) => s.messages[sessionId || ''] || []);
  const isStreaming = useAiChatStore((s) => s.isStreaming);
  const streamingText = useAiChatStore((s) => s.streamingText);
  const toolCalls = useAiChatStore((s) => s.toolCalls);
  const aiSendMessage = useAiChatStore((s) => s.sendMessage);
  const aiStopStreaming = useAiChatStore((s) => s.stopStreaming);
  const aiLoadMessages = useAiChatStore((s) => s.loadMessages);

  const [inputText, setInputText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  /** 输入区模式：文字输入 / 语音（按住说话） */
  const [inputMode, setInputMode] = useState<'text' | 'voice'>('text');
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<{ type: 'image' | 'file'; file: File; preview: string }[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [imageViewerVisible, setImageViewerVisible] = useState(false);
  const [imageViewerSrc, setImageViewerSrc] = useState('');
  const [imageViewerRaw, setImageViewerRaw] = useState('');
  const [imageViewerName, setImageViewerName] = useState('');
  const [contextMenuVisible, setContextMenuVisible] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  /** 长按消息时记录的锚点矩形，用于把菜单浮动定位到气泡附近 */
  const [menuAnchor, setMenuAnchor] = useState<{ top: number; bottom: number; left: number; right: number } | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; arrow: number; below: boolean } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [models, setModels] = useState<HermesModel[]>([]);
  const [currentModel, setCurrentModel] = useState<string | null>(null);
  const [aiSessionTitle, setAiSessionTitle] = useState<string | null>(null);
  const [quotingMessage, setQuotingMessage] = useState<Message | null>(null);
  const [mentions, setMentions] = useState<MentionInfo[]>([]);
  const [mentionPickerVisible, setMentionPickerVisible] = useState(false);
  const [mentionKeyword, setMentionKeyword] = useState('');

  useBackGuard(imageViewerVisible, () => setImageViewerVisible(false));
  useBackGuard(showModelPicker, () => setShowModelPicker(false));
  useBackGuard(mentionPickerVisible, () => {
    setMentionPickerVisible(false);
    setMentionKeyword('');
  });
  useBackGuard(contextMenuVisible, () => {
    setContextMenuVisible(false);
    setSelectedMessage(null);
  });
  const [peerTyping, setPeerTyping] = useState(false);
  const [emojiTab, setEmojiTab] = useState<'emoji' | 'sticker'>('emoji');
  const [stickers, setStickers] = useState<EmojiSticker[]>([]);
  const stickerInputRef = useRef<HTMLInputElement>(null);
  const lastTypingSentRef = useRef(0);
  /** 用户是否按住了录音键（用于处理授权期间松手的情况） */
  const recordingRef = useRef(false);
  /** 录音起点 Y，用于上滑取消判断 */
  const recordStartYRef = useRef(0);
  const recordCancelArmedRef = useRef(false);
  const [recordCancelArmed, setRecordCancelArmed] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const handleRecordEndRef = useRef<() => void>(() => {});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const albumInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);

  const conversationKey = isAiChat 
    ? (sessionId || `ai_${user?.userId}`) 
    : `${targetId}_${chatType}`;
  const conversationMessages = isAiChat ? aiMessages : (messages[conversationKey] || []);
  const [aroundActive, setAroundActive] = useState(aroundSeq > 0);

  const targetFriend = !isAiChat && chatType === 0
    ? friends.find((f) => f.userId === targetId)
    : undefined;
  const targetDeleted = !!targetFriend?.deleted;

  const typingAt = useChatStore((s) => s.typing[conversationKey] || 0);

  useEffect(() => {
    if (!typingAt) {
      setPeerTyping(false);
      return;
    }
    setPeerTyping(true);
    const timer = setTimeout(() => setPeerTyping(false), 5000);
    return () => clearTimeout(timer);
  }, [typingAt]);

  useEffect(() => {
    if (showEmoji && emojiTab === 'sticker') {
      emojiApi.list()
        .then((res) => { if (res.code === 200) setStickers(res.data); })
        .catch(() => {});
    }
  }, [showEmoji, emojiTab]);

  useEffect(() => {
    loadHistory();
    markAsRead();
    if (chatType === 1) {
      loadGroupMembers();
    }
    if (isAiChat && sessionId) {
      // 回显当前锁定模型与会话标题
      getSessionDetail(sessionId)
        .then((d) => {
          if (d.model) setCurrentModel(d.model);
          if (d.title) setAiSessionTitle(d.title);
        })
        .catch(() => {});
    }
  }, [targetId, chatType, sessionId, aroundSeq]);

  useEffect(() => {
    if (aroundActive) return;
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
    });
  }, [conversationMessages]);

  useEffect(() => {
    const pending = sessionStorage.getItem(PENDING_OUTGOING_KEY);
    if (pending && targetId && user) {
      sessionStorage.removeItem(PENDING_OUTGOING_KEY);
      try {
        const payload = JSON.parse(pending) as PendingOutgoing;
        sendPendingOutgoing(payload);
      } catch (e) {
        console.error('Failed to send pending outgoing message:', e);
      }
    }
  }, [targetId, location.key]);

  /** 发送 WS 消息；连接未就绪时立即置该消息为失败并提示，避免静默丢包 */
  const sendViaWs = (message: ChatMessage, clientMsgId: string): boolean => {
    if (wsService.send(message)) return true;
    useChatStore.getState().clearPending(clientMsgId);
    useChatStore.getState().updateMessage(conversationKey, clientMsgId, { status: 'failed' });
    Toast.show({ content: t('chat.connectionLost') });
    return false;
  };

  /**
   * 发送经 sessionStorage 传递的待发消息（转发、名片）。
   * 统一走「乐观插入 → WS 发送 → ACK 超时置失败」流程。
   */
  const sendPendingOutgoing = (payload: PendingOutgoing) => {
    if (!user || !targetId) return;
    const clientMsgId = Date.now().toString();
    const headers = { ...(payload.headers || {}), clientMsgId };

    addMessage(conversationKey, {
      id: clientMsgId,
      msgId: clientMsgId,
      senderId: user.userId,
      receiverId: targetId,
      chatType,
      msgType: payload.msgType,
      content: payload.content,
      createdAt: new Date().toISOString(),
      status: 'sending',
      headers,
    });

    if (!sendViaWs({
      type: payload.msgType,
      from: String(user.userId),
      to: targetId,
      group: chatType === 1,
      content: payload.content,
      headers,
    }, clientMsgId)) {
      return;
    }

    const ackTimer = setTimeout(() => {
      const currentMessages = useChatStore.getState().messages[conversationKey] || [];
      const msg = currentMessages.find(m => m.msgId === clientMsgId);
      if (msg && msg.status === 'sending') {
        useChatStore.getState().updateMessage(conversationKey, clientMsgId, { status: 'failed' });
      }
      useChatStore.getState().clearPending(clientMsgId);
    }, 2000);
    useChatStore.getState().registerPending(clientMsgId, ackTimer);

    updateConversation(
      conversationKey,
      payload.preview || truncatePreview(payload.content, payload.msgType, payload.headers),
      new Date().toISOString(),
      false
    );

    if (payload.successToast) {
      Toast.show({ content: payload.successToast, position: 'center' });
    }
  };

  const loadHistory = async () => {
    if (!targetId) return;
    setPage(1);
    setHasMore(true);
    try {
      if (isAiChat) {
        if (sessionId) {
          await aiLoadMessages(sessionId);
        }
      } else {
        if (aroundSeq > 0) {
          setAroundActive(true);
          const aroundRes = await messageApi.getAround(targetId!, chatType, aroundSeq, 30);
          if (aroundRes.code === 200) {
            const data = aroundRes.data || [];
            useChatStore.getState().setMessages(
              conversationKey, data.map(normalizeServerMessage));
            setHasMore(false);
            const maxSeq = data.reduce((m, x) => Math.max(m, Number(x.seq) || 0), 0);
            if (maxSeq > 0) {
              useChatStore.getState().setSyncCursor(conversationKey, maxSeq);
            }
            syncConversation(targetId!, chatType).catch((e) => console.warn('sync after around failed:', targetId, e));
            if (focusMsgId) {
              const tryScroll = (attempt = 0) => {
                if (scrollToMessage(focusMsgId)) {
                  setAroundActive(false);
                  return;
                }
                if (attempt < 2) {
                  window.setTimeout(() => tryScroll(attempt + 1), 150);
                } else {
                  setAroundActive(false);
                  Toast.show({ content: t('chat.quoteNotLoaded') });
                }
              };
              window.setTimeout(tryScroll, 120);
            } else {
              setAroundActive(false);
            }
          } else {
            setAroundActive(false);
          }
          return;
        }

        const res = await messageApi.getHistory(targetId!, chatType);
        if (res.code === 200) {
          const data = res.data || [];
          setHasMore(data.length >= 20);
          useChatStore.getState().setMessages(conversationKey, [...data].reverse().map(normalizeServerMessage));
          // 初始化增量同步游标（本页最大 seq），并补拉之后的新消息（离线 / 其他设备期间到达）
          const maxSeq = data.reduce((m, x) => Math.max(m, Number(x.seq) || 0), 0);
          if (maxSeq > 0) {
            useChatStore.getState().setSyncCursor(conversationKey, maxSeq);
          }
          syncConversation(targetId!, chatType).catch((e) => console.warn('sync on open failed:', targetId, e));
        }
      }
    } catch (e) {
      console.error('Failed to load history:', e);
      setAroundActive(false);
    }
  };

  const loadMore = async () => {
    if (!targetId || isAiChat || loadingMore || !hasMore || aroundActive) return;
    setLoadingMore(true);
    const listEl = messageListRef.current;
    const prevScrollHeight = listEl?.scrollHeight || 0;
    try {
      const nextPage = page + 1;
      const res = await messageApi.getHistory(targetId, chatType, nextPage, 20);
      if (res.code === 200) {
        const older = [...(res.data || [])].reverse().map(normalizeServerMessage);
        setHasMore((res.data || []).length >= 20);
        setPage(nextPage);
        if (older.length > 0) {
          const current = useChatStore.getState().messages[conversationKey] || [];
          useChatStore.getState().setMessages(conversationKey, [...older, ...current]);
          requestAnimationFrame(() => {
            if (listEl) {
              listEl.scrollTop = listEl.scrollHeight - prevScrollHeight;
            }
          });
        }
      }
    } catch (e) {
      console.error('Failed to load more history:', e);
    } finally {
      setLoadingMore(false);
    }
  };

  const handleScroll = () => {
    const el = messageListRef.current;
    if (el && el.scrollTop <= 10) {
      loadMore();
    }
  };

  const markAsRead = async () => {
    if (!targetId) return;
    try {
      await messageApi.markAsRead(targetId!, chatType);
      useChatStore.getState().clearUnread(conversationKey);
    } catch (e) {
      console.error('Failed to mark as read:', e);
    }
  };

  const loadGroupMembers = async () => {
    if (!targetId || chatType !== 1) return;
    try {
      const res = await contactApi.getGroupMembers(targetId!);
      if (res.code === 200) {
        setGroupMembers(res.data);
      }
    } catch (e) {
      console.error('Failed to load group members:', e);
    }
  };

  const getSenderAvatar = (senderId: string) => {
    if (senderId === String(AI_ASSISTANT.ID)) return '';
    if (senderId === user?.userId) return user.avatar || '';
    const member = groupMembers.find((m) => m.userId === senderId);
    if (member) return member.avatar || '';
    const friend = friends.find((f) => f.userId === senderId);
    return friend?.avatar || '';
  };

  const getSenderNameFor = (senderId: string) => {
    if (senderId === String(AI_ASSISTANT.ID)) return AI_ASSISTANT.NAME;
    if (senderId === user?.userId) return user?.nickname || user?.username || '';
    const member = groupMembers.find((m) => m.userId === senderId);
    if (member) return member.nickname || member.username || '';
    const friend = friends.find((f) => f.userId === senderId);
    return friend?.nickname || friend?.username || t('common.unknown');
  };

  const formatMessageTime = (time: string) => {
    if (!time) return '';
    const date = new Date(time);
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const hhmm = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    const isToday = date.toDateString() === now.toDateString();
    if (isToday) return hhmm;
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return t('common.yesterday') + ' ' + hhmm;
    return `${date.getMonth() + 1}月${date.getDate()}日 ${hhmm}`;
  };

  const sendTextMessage = async () => {
    if (!inputText.trim() && pendingAttachments.length === 0) return;
    if (targetDeleted) {
      Toast.show({ content: t('chat.userDeleted') });
      return;
    }
    if (!user) {
      Toast.show({ content: t('common.error') });
      return;
    }
    if (!targetId) {
      Toast.show({ content: t('common.error') });
      return;
    }

    const clientMsgId = Date.now().toString();
    const textToSend = inputText.trim();
    const replyInfo = !isAiChat && quotingMessage ? buildReplyInfo(quotingMessage) : undefined;
    // 仅保留正文中仍存在的 @提及（用户可能删除了 token）
    const activeMentions = chatType === 1 && !isAiChat ? pruneMentions(textToSend, mentions) : [];

    const outHeaders: Record<string, string> = { clientMsgId };
    if (replyInfo) {
      outHeaders[REPLY_HEADER_KEY] = JSON.stringify(replyInfo);
    }
    if (activeMentions.length > 0) {
      outHeaders[MENTIONS_HEADER_KEY] = JSON.stringify(activeMentions);
    }

    const userMessage: Message = {
      id: clientMsgId,
      msgId: clientMsgId,
      senderId: user.userId,
      receiverId: targetId,
      chatType: chatType,
      msgType: pendingAttachments.length > 0 && pendingAttachments[0].type === 'image' ? 'IMAGE' : 'TEXT',
      content: pendingAttachments.length > 0 ? pendingAttachments[0].preview : textToSend,
      createdAt: new Date().toISOString(),
      status: isAiChat ? undefined : 'sending',
      headers: isAiChat ? undefined : outHeaders,
      replyTo: replyInfo,
      mentions: activeMentions.length > 0 ? activeMentions : undefined,
    };

    addMessage(conversationKey, userMessage);
    const attachmentsToSend = [...pendingAttachments];
    setInputText('');
    setPendingAttachments([]);
    setQuotingMessage(null);
    setMentions([]);
    setShowActions(false);
    setShowEmoji(false);

    if (isAiChat) {
      const currentSessionId = sessionId || `ai_${user.userId}`;

      if (attachmentsToSend.length > 0) {
        const attachment = attachmentsToSend[0];
        if (attachment.type === 'image') {
          const base64 = await fileToBase64(attachment.file);
          await aiSendMessage(
            currentSessionId,
            [
              { type: 'text', text: textToSend || '请分析这张图片' },
              { type: 'image_url', image_url: { url: `data:${attachment.file.type};base64,${base64}` } },
            ],
            String(user.userId)
          );
        } else if (attachment.type === 'file') {
          const fileContent = await attachment.file.text();
          const message = `[文件: ${attachment.file.name}]\n\n${fileContent}${textToSend ? '\n\n' + textToSend : ''}`;
          await aiSendMessage(currentSessionId, message, String(user.userId));
        }
      } else {
        await aiSendMessage(currentSessionId, textToSend, String(user.userId));
      }
    } else {
      const wsMessage: ChatMessage = {
        type: 'TEXT',
        from: String(user.userId),
        to: targetId,
        group: chatType === 1,
        content: inputText.trim(),
        headers: outHeaders,
      };
      if (!sendViaWs(wsMessage, clientMsgId)) return;

      const ackTimer = setTimeout(() => {
        const currentMessages = useChatStore.getState().messages[conversationKey] || [];
        const msg = currentMessages.find(m => m.msgId === clientMsgId);
        if (msg && msg.status === 'sending') {
          useChatStore.getState().updateMessage(conversationKey, clientMsgId, { status: 'failed' });
        }
        useChatStore.getState().clearPending(clientMsgId);
      }, 2000);
      useChatStore.getState().registerPending(clientMsgId, ackTimer);

      updateConversation(
        conversationKey,
        inputText.trim().length > 30 ? inputText.trim().substring(0, 30) + '...' : inputText.trim(),
        new Date().toISOString(),
        false
      );
    }
  };

  const resetFileInputs = () => {
    [fileInputRef.current, albumInputRef.current, cameraInputRef.current, videoInputRef.current, docInputRef.current].forEach(input => {
      if (input) input.value = '';
    });
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !targetId || !user) return;

    if (file.size > MAX_UPLOAD_BYTES) {
      Toast.show({ content: t('chat.fileTooLarge') });
      setShowActions(false);
      resetFileInputs();
      return;
    }

    if (isAiChat) {
      // AI 聊天：添加到待发送列表
      if (file.type.startsWith('image/')) {
        const preview = URL.createObjectURL(file);
        setPendingAttachments(prev => [...prev, { type: 'image', file, preview }]);
      } else if (file.type.startsWith('text/') || file.name.match(/\.(txt|md|json|js|ts|py|java|c|cpp|html|css|xml|yaml|yml|csv|log|sql|sh)$/i)) {
        setPendingAttachments(prev => [...prev, { type: 'file', file, preview: file.name }]);
      } else {
        Toast.show({ content: t('chat.fileNotSupported') });
      }
    } else {
      // 普通聊天：上传后通过 WS 发送（乐观插入 → 上传进度 → ACK 超时置失败）
      const isImage = file.type.startsWith('image/');
      const isVideo = file.type.startsWith('video/');
      const msgType = isImage ? 'IMAGE' : isVideo ? 'VIDEO' : 'FILE';
      const clientMsgId = Date.now().toString();
      const headers: Record<string, string> = { clientMsgId };
      if (msgType === 'FILE') {
        headers.originalName = file.name;
        headers.size = String(file.size);
      } else if (msgType === 'VIDEO') {
        headers.size = String(file.size);
      }

      const localPreview = isImage || isVideo ? URL.createObjectURL(file) : '';
      addMessage(conversationKey, {
        id: clientMsgId,
        msgId: clientMsgId,
        senderId: user.userId,
        receiverId: targetId,
        chatType,
        msgType,
        content: localPreview,
        createdAt: new Date().toISOString(),
        status: 'sending',
        progress: 0,
        headers,
      });
      updateConversation(
        conversationKey,
        truncatePreview('', msgType, headers),
        new Date().toISOString(),
        false
      );

      try {
        const result = await uploadResumable(file, (percent) => {
          useChatStore.getState().updateMessage(conversationKey, clientMsgId, { progress: percent });
        });
        useChatStore.getState().updateMessage(conversationKey, clientMsgId, {
          content: result.url,
          progress: 100,
        });
        // 延迟释放本地预览：避免 <video> 在切换到服务端地址前仍持有 blob URL 触发加载失败
        if (localPreview) setTimeout(() => URL.revokeObjectURL(localPreview), 1000);

        if (!sendViaWs({
          type: msgType,
          from: String(user.userId),
          to: targetId,
          group: chatType === 1,
          content: result.url,
          headers,
        }, clientMsgId)) return;

        const ackTimer = setTimeout(() => {
          const currentMessages = useChatStore.getState().messages[conversationKey] || [];
          const msg = currentMessages.find(m => m.msgId === clientMsgId);
          if (msg && msg.status === 'sending') {
            useChatStore.getState().updateMessage(conversationKey, clientMsgId, { status: 'failed' });
          }
          useChatStore.getState().clearPending(clientMsgId);
        }, 8000);
        useChatStore.getState().registerPending(clientMsgId, ackTimer);
      } catch (e) {
        console.error('Failed to upload/send media:', e);
        useChatStore.getState().updateMessage(conversationKey, clientMsgId, { status: 'failed' });
        Toast.show({ content: uploadErrorMessage(e, 'chat.sendFailed') });
      }
    }

    setShowActions(false);

    // 清空 input
    resetFileInputs();
  };

  const handleRecordStart = async (e: React.PointerEvent) => {
    if (recordingRef.current) return;
    recordingRef.current = true;
    recordStartYRef.current = e.clientY;
    recordCancelArmedRef.current = false;
    setRecordCancelArmed(false);
    setRecordSeconds(0);

    if (!isRecordingSupported()) {
      recordingRef.current = false;
      Toast.show({ content: t('chat.recordNotSupported') });
      return;
    }
    try {
      await startRecording();
      // 授权过程中用户已松手：直接取消，避免一直录下去
      if (!recordingRef.current) {
        cancelRecording();
        return;
      }
      setIsRecording(true);
    } catch (e) {
      recordingRef.current = false;
      Toast.show({ content: t('chat.failedRecord') });
    }
  };

  /** 上滑超过阈值（80px）进入取消态 */
  const handleRecordMove = (e: React.PointerEvent) => {
    if (!recordingRef.current) return;
    const armed = recordStartYRef.current - e.clientY > 80;
    if (armed !== recordCancelArmedRef.current) {
      recordCancelArmedRef.current = armed;
      setRecordCancelArmed(armed);
    }
  };

  const handleRecordEnd = async () => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    setIsRecording(false);
    const wasCancel = recordCancelArmedRef.current;
    recordCancelArmedRef.current = false;
    setRecordCancelArmed(false);
    // 尚未真正开始录音（授权中），startRecording 完成后会自行取消
    if (!isRecordingActive()) return;

    if (wasCancel) {
      cancelRecording();
      Toast.show({ content: t('chat.recordCanceled') });
      return;
    }
    if (!targetId || !user) {
      cancelRecording();
      return;
    }

    try {
      const { blob, duration, mimeType, format, ext } = await stopRecording();
      if (duration < 0.8) {
        Toast.show({ content: t('chat.recordTooShort') });
        return;
      }

      const file = new File([blob], `voice_${Date.now()}.${ext}`, { type: mimeType });
      const fileResult = await fileApi.upload(file);

      const clientMsgId = Date.now().toString();
      const voiceHeaders = { duration: String(duration), format };
      const message: ChatMessage = {
        type: 'VOICE',
        from: String(user.userId),
        to: targetId,
        group: chatType === 1,
        content: fileResult.url,
        headers: { ...voiceHeaders, clientMsgId },
      };

      const localMsg: Message = {
        id: clientMsgId,
        msgId: clientMsgId,
        senderId: user.userId,
        receiverId: targetId,
        chatType,
        msgType: 'VOICE',
        content: fileResult.url,
        createdAt: new Date().toISOString(),
        status: 'sending',
        headers: voiceHeaders,
      };
      addMessage(conversationKey, localMsg);
      if (!sendViaWs(message, clientMsgId)) return;
      const ackTimer = setTimeout(() => {
        const currentMessages = useChatStore.getState().messages[conversationKey] || [];
        const msg = currentMessages.find(m => m.msgId === clientMsgId);
        if (msg && msg.status === 'sending') {
          useChatStore.getState().updateMessage(conversationKey, clientMsgId, { status: 'failed' });
        }
        useChatStore.getState().clearPending(clientMsgId);
      }, 8000);
      useChatStore.getState().registerPending(clientMsgId, ackTimer);

      updateConversation(
        conversationKey,
        `[语音] ${Math.round(duration)}"`,
        new Date().toISOString(),
        false
      );
    } catch (e) {
      Toast.show({ content: t('chat.failedSendVoice') });
    }
  };
  handleRecordEndRef.current = handleRecordEnd;

  /** 录音计时 + 60 秒自动发送上限 */
  useEffect(() => {
    if (!isRecording) return;
    const timer = setInterval(() => {
      setRecordSeconds((prev) => {
        const next = prev + 0.1;
        if (next >= 60) {
          clearInterval(timer);
          handleRecordEndRef.current();
          return 60;
        }
        return next;
      });
    }, 100);
    return () => clearInterval(timer);
  }, [isRecording]);

  const getChatTitle = () => {
    if (isAiChat) return aiSessionTitle || AI_ASSISTANT.NAME;
    if (chatType === 1) {
      const group = groups.find((g) => g.id === String(targetId));
      return group?.name || t('common.unknownGroup');
    }
    const friend = friends.find((f) => f.userId === String(targetId));
    return friend?.nickname || friend?.username || t('chat.title');
  };

  const isTargetOnline = chatType === 0 && onlineUsers.has(targetId || '');

  const handleLongPress = (msg: Message) => {
    setSelectedMessage(msg);
    const el = msg.msgId
      ? (document.querySelector(`[data-msg-id="${CSS.escape(msg.msgId)}"]`) as HTMLElement | null)
      : null;
    const rect = el?.getBoundingClientRect();
    setMenuAnchor(
      rect
        ? { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }
        : {
            top: window.innerHeight / 2,
            bottom: window.innerHeight / 2,
            left: window.innerWidth / 2,
            right: window.innerWidth / 2,
          },
    );
    setContextMenuVisible(true);
  };

  // 菜单浮动定位：优先显示在气泡上方，空间不足则移到下方；箭头对准气泡中心
  useLayoutEffect(() => {
    if (!contextMenuVisible || !menuAnchor || !menuRef.current) {
      setMenuPos(null);
      return;
    }
    const panel = menuRef.current.getBoundingClientRect();
    const gap = 14;
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const centerX = (menuAnchor.left + menuAnchor.right) / 2;
    const left = Math.max(margin, Math.min(centerX - panel.width / 2, vw - panel.width - margin));
    let below = false;
    let top = menuAnchor.top - panel.height - gap;
    if (top < margin) {
      below = true;
      top = menuAnchor.bottom + gap;
    }
    if (top + panel.height > vh - margin) {
      top = Math.max(margin, vh - panel.height - margin);
    }
    const arrow = Math.max(16, Math.min(centerX - left, panel.width - 16));
    setMenuPos({ top, left, arrow, below });
  }, [contextMenuVisible, menuAnchor, selectedMessage]);

  /** 撤回时限（毫秒），与后端保持一致 */
  const RECALL_TIMEOUT_MS = 2 * 60 * 1000;

  /** 是否可撤回：非 AI 会话、本人消息、未撤回、已发送（有服务端 msgId）、2 分钟内 */
  const canRecall = (msg: Message | null): boolean => {
    if (!msg || isAiChat) return false;
    if (msg.senderId !== String(user?.userId)) return false;
    if (msg.msgType === 'RECALL' || msg.msgType === 'CALL') return false;
    if (msg.status === 'sending' || msg.status === 'failed') return false;
    return Date.now() - new Date(msg.createdAt).getTime() <= RECALL_TIMEOUT_MS;
  };

  const handleRecallMessage = async () => {
    if (!selectedMessage) return;
    const msgId = selectedMessage.msgId;
    setContextMenuVisible(false);
    try {
      const res = await messageApi.recallMessage(msgId);
      if (res.code === 200) {
        useChatStore.getState().updateMessage(conversationKey, msgId, {
          msgType: 'RECALL',
          content: '',
        });
        // 撤回可能改变会话预览，以后端为准刷新列表
        const convRes = await messageApi.getConversations();
        if (convRes.code === 200) {
          useChatStore.getState().setConversations(convRes.data);
        }
      } else {
        Toast.show({ content: res.message || t('chat.recallFailed') });
      }
    } catch (e) {
      Toast.show({ content: t('chat.recallFailed') });
    }
  };

  /** 转发：把消息载荷暂存 sessionStorage，跳转目标选择页 */
  const handleForwardMessage = () => {
    if (!selectedMessage) return;
    sessionStorage.setItem(PENDING_FORWARD_KEY, JSON.stringify(buildForwardPayload(selectedMessage)));
    setContextMenuVisible(false);
    navigate('/select-target?action=forward');
  };

  /** 保存媒体消息（图片/视频/文件；语音不提供） */
  const handleSaveMessage = () => {
    if (selectedMessage) {
      downloadFile(selectedMessage.content);
    }
    setContextMenuVisible(false);
  };

  /** 引用：在输入区展示引用条；群聊中同时 @ 被引用消息的发送者（引用回复） */
  const handleQuoteMessage = () => {
    if (!selectedMessage) return;
    setQuotingMessage(selectedMessage);
    setContextMenuVisible(false);
    if (chatType === 1 && selectedMessage.senderId !== String(user?.userId)) {
      const nickname = getSenderNameFor(selectedMessage.senderId);
      if (nickname) {
        insertMention({ userId: selectedMessage.senderId, nickname });
      }
    }
  };

  /** 可 @ 的群成员（不含自己） */
  const mentionableMembers = groupMembers.filter((m) => m.userId !== String(user?.userId));

  /** 当前用户是否可 @所有人（群主或管理员） */
  const canMentionAll = (() => {
    const me = groupMembers.find((m) => m.userId === String(user?.userId));
    return !!me && me.role >= 1;
  })();

  /** 插入 Emoji 到输入框 */
  const insertEmoji = (emoji: string) => {
    setInputText((prev) => `${prev}${emoji}`);
  };

  /** 上传本地图片并加入表情包收藏 */
  const handleStickerFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      Toast.show({ content: t('chat.fileNotSupported') });
      return;
    }
    try {
      const uploaded = await fileApi.upload(file);
      const res = await emojiApi.add(uploaded.url);
      if (res.code === 200) {
        setStickers((prev) => [res.data, ...prev.filter((s) => s.url !== res.data.url)]);
        Toast.show({ content: t('chat.stickerAdded') });
      } else {
        Toast.show({ content: res.message || t('chat.stickerAddFailed') });
      }
    } catch (err) {
      console.error('Failed to add sticker:', err);
      Toast.show({ content: t('chat.stickerAddFailed') });
    }
  };

  const handleStickerDelete = (sticker: EmojiSticker) => {
    Dialog.confirm({
      content: t('chat.stickerDeleteConfirm'),
      onConfirm: async () => {
        try {
          const res = await emojiApi.remove(sticker.id);
          if (res.code === 200) {
            setStickers((prev) => prev.filter((s) => s.id !== sticker.id));
            Toast.show({ content: t('chat.stickerDeleted') });
          } else {
            Toast.show({ content: res.message || t('chat.stickerDeleteFailed') });
          }
        } catch (err) {
          console.error('Failed to delete sticker:', err);
          Toast.show({ content: t('chat.stickerDeleteFailed') });
        }
      },
    });
  };

  /** 点击表情包：以图片消息发送（AI 会话不支持） */
  const sendSticker = (sticker: EmojiSticker) => {
    if (isAiChat || !user || !targetId) return;
    const clientMsgId = Date.now().toString();
    const headers: Record<string, string> = { clientMsgId };

    addMessage(conversationKey, {
      id: clientMsgId,
      msgId: clientMsgId,
      senderId: user.userId,
      receiverId: targetId,
      chatType,
      msgType: 'IMAGE',
      content: sticker.url,
      createdAt: new Date().toISOString(),
      status: 'sending',
      headers,
    });
    updateConversation(
      conversationKey,
      truncatePreview('', 'IMAGE', headers),
      new Date().toISOString(),
      false
    );

    if (!sendViaWs({
      type: 'IMAGE',
      from: String(user.userId),
      to: targetId,
      group: chatType === 1,
      content: sticker.url,
      headers,
    }, clientMsgId)) return;

    const ackTimer = setTimeout(() => {
      const currentMessages = useChatStore.getState().messages[conversationKey] || [];
      const msg = currentMessages.find((m) => m.msgId === clientMsgId);
      if (msg && msg.status === 'sending') {
        useChatStore.getState().updateMessage(conversationKey, clientMsgId, { status: 'failed' });
      }
      useChatStore.getState().clearPending(clientMsgId);
    }, 8000);
    useChatStore.getState().registerPending(clientMsgId, ackTimer);

    setShowEmoji(false);
  };

  /** 插入 @提及 token 到输入框 */
  const insertMention = (member: MentionInfo) => {
    setInputText((prev) => `${prev}@${member.nickname} `);
    setMentions((prev) =>
      prev.some((m) => m.userId === member.userId) ? prev : [...prev, member]
    );
    setMentionPickerVisible(false);
    setMentionKeyword('');
  };

  /** 输入框变化：仅当用户主动输入 '@'（文本变长且以 '@' 结尾）时唤起成员选择浮层，删除字符导致的 '@' 结尾不触发 */
  const handleInputChange = (val: string) => {
    if (!isAiChat && chatType === 1 && val.endsWith('@') && val.length > inputText.length) {
      setInputText(val.slice(0, -1));
      setMentionPickerVisible(true);
      return;
    }
    setInputText(val);
    sendTyping();
  };

  /** 发送输入中状态（仅私聊），2s 节流，避免频繁推送 */
  const sendTyping = () => {
    if (isAiChat || chatType !== 0 || !user || !targetId) return;
    const now = Date.now();
    if (now - lastTypingSentRef.current < 2000) return;
    lastTypingSentRef.current = now;
    wsService.send({
      type: 'TYPING',
      from: String(user.userId),
      to: targetId,
      group: false,
      content: '',
    });
  };

  /** 退格时把 '@昵称'（含尾随空格）当作一个整体删除，避免逐字删 */
  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Backspace' || isAiChat || chatType !== 1 || mentions.length === 0) return;
    const el = e.currentTarget;
    const caret = el.selectionStart ?? 0;
    if (caret !== el.selectionEnd || caret === 0) return;

    const before = inputText.slice(0, caret);
    const token = mentions
      .map((m) => `@${m.nickname}`)
      .filter((t) => before.endsWith(t) || before.endsWith(`${t} `))
      .sort((a, b) => b.length - a.length)[0];
    if (!token) return;

    const tokenLength = before.endsWith(`${token} `) ? token.length + 1 : token.length;
    const start = caret - tokenLength;
    e.preventDefault();
    setInputText(inputText.slice(0, start) + inputText.slice(caret));
    setMentions((prev) => prev.filter((m) => `@${m.nickname}` !== token));
    requestAnimationFrame(() => el.setSelectionRange(start, start));
  };

  /** 定位并高亮消息（引用、搜索跳转共用） */
  const scrollToMessage = (msgId: string): boolean => {
    const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(msgId) : msgId;
    const el = messageListRef.current?.querySelector(`[data-msg-id="${escaped}"]`) as HTMLElement | null;
    if (!el) return false;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.animate(
      [{ backgroundColor: 'rgba(228, 88, 107, 0.26)' }, { backgroundColor: 'transparent' }],
      { duration: 2000, easing: 'ease-out' }
    );
    return true;
  };

  /** 点击引用块：定位并高亮原消息（不在已加载范围时提示） */
  const handleQuoteClick = (replyMsgId: string) => {
    if (!scrollToMessage(replyMsgId)) {
      Toast.show({ content: t('chat.quoteNotLoaded') });
    }
  };

  const handleResend = (msg: Message) => {
    if (!user || !targetId) return;
    const clientMsgId = Date.now().toString();
    const resendMessage: Message = {
      ...msg,
      id: clientMsgId,
      msgId: clientMsgId,
      status: 'sending',
      headers: { ...msg.headers, clientMsgId },
    };
    // 删除旧的失败消息，添加新的
    const currentMessages = useChatStore.getState().messages[conversationKey] || [];
    useChatStore.getState().setMessages(
      conversationKey,
      currentMessages.filter(m => m.msgId !== msg.msgId).concat(resendMessage)
    );
    const wsMessage: ChatMessage = {
      type: msg.msgType,
      from: String(user.userId),
      to: targetId,
      group: chatType === 1,
      content: msg.content,
      headers: { clientMsgId },
    };
    if (!sendViaWs(wsMessage, clientMsgId)) return;
    const ackTimer = setTimeout(() => {
      const msgs = useChatStore.getState().messages[conversationKey] || [];
      const m = msgs.find(x => x.msgId === clientMsgId);
      if (m && m.status === 'sending') {
        useChatStore.getState().updateMessage(conversationKey, clientMsgId, { status: 'failed' });
      }
      useChatStore.getState().clearPending(clientMsgId);
    }, 8000);
    useChatStore.getState().registerPending(clientMsgId, ackTimer);
  };

  const handleCopyMessage = () => {
    if (selectedMessage) {
      navigator.clipboard.writeText(selectedMessage.content);
      Toast.show({ content: t('common.success') });
    }
    setContextMenuVisible(false);
  };

  const handleDeleteMessage = () => {
    if (selectedMessage && isAiChat && sessionId) {
      const currentMessages = useAiChatStore.getState().messages[sessionId] || [];
      const filtered = currentMessages.filter(m => m.msgId !== selectedMessage.msgId);
      useAiChatStore.setState(state => ({
        messages: { ...state.messages, [sessionId]: filtered }
      }));
    }
    setContextMenuVisible(false);
  };

  const handleOpenModelPicker = () => {
    if (models.length === 0) {
      getModels().then((list) => {
        setModels(list);
        setShowModelPicker(true);
      }).catch(() => Toast.show({ content: t('common.error') }));
    } else {
      setShowModelPicker(true);
    }
  };

  const handleSelectModel = async (modelId: string, provider?: string) => {
    setShowModelPicker(false);
    const sid = sessionId || `ai_${user?.userId}`;
    if (!sid) return;
    try {
      // 必须同时锁定 provider（同一模型可能存在于多个渠道）；
      // reasoning_effort=low：强制思考型模型（如 glm-5.3 系列）必须指定档位，
      // 否则上游报 400 "cannot be disabled; please use low, high, or max"
      await lockModel(sid, modelId, provider, { reasoning_effort: 'low' });
      setCurrentModel(modelId);
      Toast.show({ content: `${t('ai.modelLocked')}: ${modelId}` });
    } catch (e) {
      Toast.show({ content: t('common.error') });
    }
  };

  // Picker 选项：provider · model 展示，value 用 provider/model 保证同模型不同渠道唯一
  const modelPickerKey = (m: HermesModel) => `${m.provider || ''}/${m.id}`;
  const modelPickerColumns = [models.map((m) => ({
    label: m.provider ? `${m.provider} · ${m.id}` : m.id,
    value: modelPickerKey(m),
  }))];
  const currentModelKey = (() => {
    const found = models.find((m) => m.id === currentModel);
    return found ? modelPickerKey(found) : '';
  })();

  // 长按菜单项（QQ 风格宫格，仅保留普通聊天可用的操作）
  const menuActions: { key: string; label: string; icon: ReactNode; danger?: boolean; onClick: () => void }[] = [];
  if (selectedMessage) {
    const isRecord = selectedMessage.msgType === 'RECALL' || selectedMessage.msgType === 'CALL';
    if (!isRecord) {
      menuActions.push({ key: 'copy', label: t('chat.copyMessage'), icon: <Copy size={18} strokeWidth={1.8} />, onClick: handleCopyMessage });
    }
    if (!isAiChat && !isRecord) {
      menuActions.push({ key: 'quote', label: t('chat.quote'), icon: <Quote size={18} strokeWidth={1.8} />, onClick: handleQuoteMessage });
      menuActions.push({ key: 'forward', label: t('chat.forward'), icon: <Forward size={18} strokeWidth={1.8} />, onClick: handleForwardMessage });
    }
    if (canRecall(selectedMessage)) {
      menuActions.push({ key: 'recall', label: t('chat.recall'), icon: <Undo2 size={18} strokeWidth={1.8} />, onClick: handleRecallMessage });
    }
    if (!isAiChat && ['IMAGE', 'VIDEO', 'FILE'].includes(selectedMessage.msgType)) {
      menuActions.push({ key: 'save', label: t('chat.saveMedia'), icon: <Download size={18} strokeWidth={1.8} />, onClick: handleSaveMessage });
    }
    menuActions.push({ key: 'delete', label: t('common.delete'), icon: <Trash2 size={18} strokeWidth={1.8} />, danger: true, onClick: handleDeleteMessage });
  }

  const startCall = (media: 'audio' | 'video') => {
    const friend = friends.find((f) => String(f.userId) === String(targetId));
    callManager.start(
      String(targetId),
      friend?.nickname || friend?.username || String(targetId),
      friend?.avatar,
      media,
    );
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerLeft} onClick={() => navigate(-1)}>
          <div className={styles.backArrow}>‹</div>
        </div>
        <div className={styles.headerTitle}>
          <span className={styles.titleText}>{getChatTitle()}</span>
          {chatType === 0 && (
            <span className={`${styles.statusDot} ${isTargetOnline ? styles.online : ''}`} />
          )}
        </div>
        <div className={styles.headerRight}>
          {isAiChat && (
            <span className={styles.modelBtn} onClick={handleOpenModelPicker}>
              {currentModel || t('ai.model')}
            </span>
          )}
          {chatType === 1 && (
            <span className={styles.memberCount} onClick={() => navigate(`/contacts/groups/${targetId}`)}>
              {groupMembers.length}人
            </span>
          )}
        </div>
      </div>

      <Picker
        columns={modelPickerColumns}
        visible={showModelPicker}
        onClose={() => setShowModelPicker(false)}
        value={currentModelKey ? [currentModelKey] : []}
        onConfirm={(val) => {
          if (val && val.length > 0) {
            const key = val[0] as string;
            const sep = key.indexOf('/');
            const provider = sep > 0 ? key.slice(0, sep) : undefined;
            const modelId = sep > 0 ? key.slice(sep + 1) : key;
            handleSelectModel(modelId, provider);
          } else {
            setShowModelPicker(false);
          }
        }}
      />

      <div className={styles.messageList} ref={messageListRef} onScroll={handleScroll}>
        {loadingMore && (
          <div className={styles.loadingMore}>{t('common.loading')}</div>
        )}
        {!isAiChat && aroundSeq === 0 && !hasMore && conversationMessages.length > 0 && (
          <div className={styles.noMore}>{t('chat.noMoreMessages')}</div>
        )}
        {isAiChat && conversationMessages.length === 0 && (
          <div className={styles.aiWelcome}>
            <div className={styles.aiWelcomeAvatar}>AI</div>
            <h3>{t('chat.aiTitle')}</h3>
            <p>{t('chat.aiWelcome')}</p>
          </div>
        )}
        {conversationMessages.map((msg, index) => {
          const prev = conversationMessages[index - 1];
          const gap = prev ? new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime() : Infinity;
          const showTime = gap > 5 * 60 * 1000;
          // 通话记录的展示主体是发起人（主叫实时副本 from=对方，故按 headers.caller 取）
          const ownerId = msg.msgType === 'CALL' ? String(msg.headers?.caller || msg.senderId) : msg.senderId;
          return (
            <Fragment key={msg.msgId || msg.id}>
              {showTime && (
                <div className={styles.timeBar}>
                  <span>{formatMessageTime(msg.createdAt)}</span>
                </div>
              )}
              <MessageBubble
                message={msg}
                isSelf={ownerId === user?.userId}
                senderName={getSenderNameFor(ownerId)}
                senderAvatar={getSenderAvatar(ownerId)}
                showSenderName={chatType === 1}
                onCallRecord={msg.msgType === 'CALL' ? (media) => startCall(media) : undefined}
                onAvatarClick={ownerId !== String(AI_ASSISTANT.ID) && ownerId !== user?.userId
                  ? () => navigate(`/contacts/${ownerId}`)
                  : undefined}
                onAvatarLongPress={chatType === 1 && !isAiChat && ownerId !== String(user?.userId)
                  ? () => insertMention({ userId: ownerId, nickname: getSenderNameFor(ownerId) })
                  : undefined}
                onMentionClick={(mentionUserId) => {
                  if (mentionUserId && mentionUserId !== MENTION_ALL) {
                    navigate(`/contacts/${mentionUserId}`);
                  }
                }}
                onImageClick={(src) => {
                  setImageViewerSrc(src);
                  setImageViewerRaw(msg.content);
                  setImageViewerName(msg.headers?.originalName || msg.content.split('/').pop()?.split('?')[0] || '');
                  setImageViewerVisible(true);
                }}
                onLongPress={() => handleLongPress(msg)}
                replySenderName={msg.replyTo ? getSenderNameFor(msg.replyTo.senderId) : undefined}
                onQuoteClick={msg.replyTo ? () => handleQuoteClick(msg.replyTo!.msgId) : undefined}
                onResend={msg.status === 'failed' ? () => handleResend(msg) : undefined}
              />
            </Fragment>
          );
        })}
        {isStreaming && (
          <div className={styles.streamingContainer}>
            {streamingText ? (
              <div className={styles.streamingBubble}>
                <div className={styles.streamingContent}>{streamingText}</div>
                {toolCalls.length > 0 && (
                  <div className={styles.toolCalls}>
                    {toolCalls.map((tc, i) => (
                      <div key={i} className={styles.toolCall}>
                        <span className={styles.toolName}>{tc.name}</span>
                        <span className={styles.toolStatus}>
                          {tc.status === 'running' ? '⏳' : tc.status === 'completed' ? '✅' : '❌'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className={styles.aiLoading}>
                <SpinLoading />
                <span>{t('chat.aiThinking')}</span>
              </div>
            )}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {isRecording && (
        <div className={styles.recordOverlay}>
          <div className={`${styles.recordPanel} ${recordCancelArmed ? styles.recordPanelCancel : ''}`}>
            <div className={styles.recordWave}>
              {Array.from({ length: 7 }).map((_, i) => (
                <span key={i} style={{ animationDelay: `${i * 0.1}s` }} />
              ))}
            </div>
            <div className={styles.recordTime}>{Math.floor(recordSeconds)}″</div>
            <div className={styles.recordHint}>
              {recordCancelArmed ? t('chat.releaseToCancel') : t('chat.slideUpToCancel')}
            </div>
          </div>
        </div>
      )}

      {peerTyping && !isAiChat && chatType === 0 && (
        <div className={styles.typingHint}>
          <span className={styles.typingDots}>
            <i />
            <i />
            <i />
          </span>
          {t('chat.typing')}
        </div>
      )}

      {targetDeleted && (
        <div className={styles.deletedBanner}>{t('chat.userDeleted')}</div>
      )}

      <div className={styles.inputArea} style={targetDeleted ? { display: 'none' } : undefined}>
        {quotingMessage && (
          <div className={styles.quoteBar}>
            <div className={styles.quoteBarContent}>
              <span className={styles.quoteBarSender}>{getSenderNameFor(quotingMessage.senderId)}</span>
              <span className={styles.quoteBarSummary}>
                {truncatePreview(quotingMessage.content, quotingMessage.msgType, quotingMessage.headers)}
              </span>
            </div>
            <span className={styles.quoteBarClose} title={t('chat.cancelQuote')} onClick={() => setQuotingMessage(null)}>✕</span>
          </div>
        )}
        <div className={styles.inputRow}>
          <div
            className={styles.iconBtn}
            onClick={() => {
              setInputMode((m) => (m === 'text' ? 'voice' : 'text'));
              setShowEmoji(false);
              setShowActions(false);
            }}
          >
            {inputMode === 'voice' ? <Keyboard size={20} strokeWidth={1.8} /> : <Mic size={20} strokeWidth={1.8} />}
          </div>

          {inputMode === 'voice' ? (
            <div
              className={`${styles.holdTalk} ${isRecording ? styles.holdTalkActive : ''}`}
              onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); handleRecordStart(e); }}
              onPointerMove={handleRecordMove}
              onPointerUp={handleRecordEnd}
              onPointerCancel={handleRecordEnd}
            >
              {t('chat.holdToTalk')}
            </div>
          ) : (
            <Input
              value={inputText}
              onChange={handleInputChange}
              onKeyDown={handleInputKeyDown}
              onEnterPress={sendTextMessage}
              onFocus={() => { setShowActions(false); setShowEmoji(false); }}
              placeholder={t('chat.messagePlaceholder')}
              className={styles.input}
            />
          )}

          <div
            className={`${styles.iconBtn} ${showEmoji ? styles.iconBtnActive : ''}`}
            onClick={() => { setShowEmoji((v) => !v); setShowActions(false); }}
          >
            <Smile size={20} strokeWidth={1.8} />
          </div>

          <div
            className={`${styles.iconBtn} ${showActions ? styles.iconBtnActive : ''}`}
            onClick={() => { setShowActions((v) => !v); setShowEmoji(false); }}
          >
            <Plus size={20} strokeWidth={1.8} />
          </div>
        </div>

        {isStreaming ? (
          <Button color="danger" block size="small" onClick={aiStopStreaming} className={styles.sendBtn}>
            {t('chat.stopGeneration')}
          </Button>
        ) : (inputMode === 'text' && (inputText.trim() || pendingAttachments.length > 0)) ? (
          <Button color="primary" block size="small" onClick={sendTextMessage} className={styles.sendBtn}>
            {t('common.send')}
          </Button>
        ) : null}

        {showActions && (
          <div className={styles.actionPanel}>
            <div className={styles.actionGrid}>
              <div className={styles.actionItem} onClick={() => albumInputRef.current?.click()}>
                <div className={`${styles.actionIcon} ${styles.actionAlbum}`}><Image size={26} strokeWidth={1.8} /></div>
                <span>{t('chat.album')}</span>
              </div>
              <div className={styles.actionItem} onClick={() => cameraInputRef.current?.click()}>
                <div className={`${styles.actionIcon} ${styles.actionCamera}`}><Camera size={26} strokeWidth={1.8} /></div>
                <span>{t('chat.camera')}</span>
              </div>
              <div className={styles.actionItem} onClick={() => videoInputRef.current?.click()}>
                <div className={`${styles.actionIcon} ${styles.actionVideo}`}><Film size={26} strokeWidth={1.8} /></div>
                <span>{t('chat.video')}</span>
              </div>
              <div className={styles.actionItem} onClick={() => docInputRef.current?.click()}>
                <div className={`${styles.actionIcon} ${styles.actionFile}`}><Folder size={26} strokeWidth={1.8} /></div>
                <span>{t('chat.file')}</span>
              </div>
              {chatType === 0 && !isAiChat && (
                <>
                  <div className={styles.actionItem} onClick={() => { if (!targetDeleted) { setShowActions(false); startCall('audio'); } }}>
                    <div className={`${styles.actionIcon} ${styles.actionCallVoice}`}><Phone size={26} strokeWidth={1.8} /></div>
                    <span>{t('call.voice')}</span>
                  </div>
                  <div className={styles.actionItem} onClick={() => { if (!targetDeleted) { setShowActions(false); startCall('video'); } }}>
                    <div className={`${styles.actionIcon} ${styles.actionCallVideo}`}><Video size={26} strokeWidth={1.8} /></div>
                    <span>{t('call.video')}</span>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {showEmoji && (
          <div className={styles.emojiPanelWrap}>
            <div className={styles.emojiTabs}>
              <button
                type="button"
                className={`${styles.emojiTab} ${emojiTab === 'emoji' ? styles.emojiTabActive : ''}`}
                onClick={() => setEmojiTab('emoji')}
              >
                {t('chat.stickerEmoji')}
              </button>
              {!isAiChat && (
                <button
                  type="button"
                  className={`${styles.emojiTab} ${emojiTab === 'sticker' ? styles.emojiTabActive : ''}`}
                  onClick={() => setEmojiTab('sticker')}
                >
                  {t('chat.sticker')}
                </button>
              )}
            </div>

            {emojiTab === 'emoji' || isAiChat ? (
              <div className={styles.emojiPanel}>
                {EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className={styles.emojiBtn}
                    onClick={() => insertEmoji(emoji)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            ) : (
              <div className={styles.stickerPanel}>
                <div className={styles.stickerGrid}>
                  <button
                    type="button"
                    className={styles.stickerAdd}
                    onClick={() => stickerInputRef.current?.click()}
                  >
                    <Plus size={20} strokeWidth={1.8} />
                    <span>{t('chat.stickerAdd')}</span>
                  </button>
                  {stickers.map((sticker) => (
                    <div key={sticker.id} className={styles.stickerItem}>
                      <img
                        src={resolveFileUrl(sticker.url)}
                        alt=""
                        className={styles.stickerImg}
                        onClick={() => sendSticker(sticker)}
                      />
                      <button
                        type="button"
                        className={styles.stickerDelete}
                        onClick={() => handleStickerDelete(sticker)}
                      >
                        <Trash2 size={16} strokeWidth={1.8} />
                      </button>
                    </div>
                  ))}
                </div>
                {stickers.length === 0 && (
                  <div className={styles.stickerEmpty}>{t('chat.stickerEmpty')}</div>
                )}
              </div>
            )}
          </div>
        )}

        <input
          ref={stickerInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleStickerFileSelect}
        />
      </div>

      {pendingAttachments.length > 0 && (
        <div className={styles.pendingAttachments}>
          {pendingAttachments.map((att, i) => (
            <div key={i} className={styles.pendingItem}>
              {att.type === 'image' ? (
                <img src={att.preview} alt="preview" className={styles.pendingImage} />
              ) : (
                <div className={styles.pendingFile}>
                  <span className={styles.pendingFileName}>{att.file.name}</span>
                </div>
              )}
              <div className={styles.pendingRemove} onClick={() => {
                setPendingAttachments(prev => prev.filter((_, idx) => idx !== i));
                if (att.type === 'image') URL.revokeObjectURL(att.preview);
              }}>×</div>
            </div>
          ))}
        </div>
      )}

      <input ref={albumInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handleFileSelect} />
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handleFileSelect} />
      <input ref={videoInputRef} type="file" accept="video/*" style={{ display: 'none' }} onChange={handleFileSelect} />
      <input ref={docInputRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.rar" style={{ display: 'none' }} onChange={handleFileSelect} />
      <ImageViewer
        image={imageViewerSrc}
        visible={imageViewerVisible}
        onClose={() => setImageViewerVisible(false)}
      />
      {imageViewerVisible && (
        <div className={styles.downloadBtn} onClick={() => downloadFile(imageViewerRaw || imageViewerSrc, imageViewerName || undefined)}>
          {t('chat.saveMedia')}
        </div>
      )}

      {/* 消息操作菜单（QQ 风格浮动宫格，主题色跟随应用） */}
      {contextMenuVisible && (
        <div className={styles.menuOverlay} onClick={() => setContextMenuVisible(false)}>
          <div
            ref={menuRef}
            className={styles.msgMenu}
            style={{
              top: menuPos?.top ?? -9999,
              left: menuPos?.left ?? -9999,
              visibility: menuPos ? 'visible' : 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.menuGrid}>
              {menuActions.map((action) => (
                <button
                  key={action.key}
                  type="button"
                  className={`${styles.menuCell} ${action.danger ? styles.menuCellDanger : ''}`}
                  onClick={action.onClick}
                >
                  <span className={styles.menuIcon}>{action.icon}</span>
                  <span className={styles.menuLabel}>{action.label}</span>
                </button>
              ))}
            </div>
            {menuPos && (
              <span
                className={`${styles.menuArrow} ${menuPos.below ? styles.menuArrowUp : styles.menuArrowDown}`}
                style={{ left: menuPos.arrow }}
              />
            )}
          </div>
        </div>
      )}

      {/* @提及成员选择浮层 */}
      <Popup
        visible={mentionPickerVisible}
        onMaskClick={() => { setMentionPickerVisible(false); setMentionKeyword(''); }}
        position="bottom"
        bodyStyle={{
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          padding: '12px 0 24px',
          maxHeight: '60vh',
        }}
      >
        <div className={styles.mentionPanel}>
          <div className={styles.mentionTitle}>{t('chat.mentionTitle')}</div>
          <div className={styles.mentionSearch}>
            <SearchBar
              placeholder={t('contacts.searchPlaceholder')}
              value={mentionKeyword}
              onChange={setMentionKeyword}
            />
          </div>
          <div className={styles.mentionList}>
            {canMentionAll && !mentionKeyword.trim() && (
              <div className={styles.mentionItem} onClick={() => insertMention({ userId: MENTION_ALL, nickname: t('chat.mentionAll') })}>
                <div className={styles.mentionAllAvatar}>@</div>
                <span className={styles.mentionName}>{t('chat.mentionAll')}</span>
              </div>
            )}
            {mentionableMembers
              .filter((m) => {
                const kw = mentionKeyword.trim().toLowerCase();
                if (!kw) return true;
                return (m.nickname || '').toLowerCase().includes(kw) || (m.username || '').toLowerCase().includes(kw);
              })
              .map((m) => (
                <div
                  key={m.userId}
                  className={styles.mentionItem}
                  onClick={() => insertMention({ userId: m.userId, nickname: m.nickname || m.username || '' })}
                >
                  <SharedAvatar name={m.nickname || m.username} src={m.avatar} size={36} />
                  <span className={styles.mentionName}>{m.nickname || m.username}</span>
                </div>
              ))}
            {mentionableMembers.length === 0 && (
              <div className={styles.mentionEmpty}>{t('common.noData')}</div>
            )}
          </div>
        </div>
      </Popup>
    </div>
  );
};

export default ChatWindow;
