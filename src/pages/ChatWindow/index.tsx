import { useEffect, useRef, useState, Fragment } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { Input, Button, Popup, Toast, SpinLoading, ImageViewer, Picker } from 'antd-mobile';
import { SoundOutline, SmileOutline, AddOutline, PicturesOutline, CameraOutline, VideoOutline, FolderOutline } from 'antd-mobile-icons';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '../../store/useChatStore';
import { useContactStore } from '../../store/useContactStore';
import { useAuthStore } from '../../store/useAuthStore';
import { useOnlineStore } from '../../store/useOnlineStore';
import { useAiChatStore } from '../../stores/aiChatStore';
import { messageApi, fileApi, contactApi } from '../../api';
import { getModels, lockModel, type HermesModel } from '../../api/hermes';
import { downloadFile } from '../../utils/download';
import { fileToBase64 } from '../../services/aiChat';
import wsService from '../../services/websocket';
import { startRecording, stopRecording } from '../../services/recorder';
import MessageBubble from '../../components/MessageBubble';
import type { Message, ChatMessage, GroupMember } from '../../types';
import { AI_ASSISTANT } from '../../types';
import styles from './index.module.css';

const ChatWindow = () => {
  const { t } = useTranslation();
  const { targetId } = useParams<{ targetId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const chatType = parseInt(searchParams.get('type') || '0');
  const sessionId = searchParams.get('session');
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
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<{ type: 'image' | 'file'; file: File; preview: string }[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [imageViewerVisible, setImageViewerVisible] = useState(false);
  const [imageViewerSrc, setImageViewerSrc] = useState('');
  const [contextMenuVisible, setContextMenuVisible] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [models, setModels] = useState<HermesModel[]>([]);
  const [currentModel, setCurrentModel] = useState<string | null>(null);
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

  useEffect(() => {
    loadHistory();
    markAsRead();
    if (chatType === 1) {
      loadGroupMembers();
    }
  }, [targetId, chatType, sessionId]);

  useEffect(() => {
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
    });
  }, [conversationMessages]);

  useEffect(() => {
    const pendingCard = sessionStorage.getItem('pending_card');
    if (pendingCard && targetId && user) {
      sessionStorage.removeItem('pending_card');
      try {
        const card = JSON.parse(pendingCard);
        const cardMsg: ChatMessage = {
          type: 'CONTACT_CARD',
          from: String(user.userId),
          to: targetId,
          group: chatType === 1,
          content: JSON.stringify(card),
        };
        wsService.send(cardMsg);
        const localMsg: Message = {
          id: Date.now().toString(),
          msgId: Date.now().toString(),
          senderId: user.userId,
          receiverId: targetId,
          chatType,
          msgType: 'CONTACT_CARD',
          content: JSON.stringify(card),
          createdAt: new Date().toISOString(),
        };
        addMessage(conversationKey, localMsg);
        updateConversation(conversationKey, '[个人名片]', new Date().toISOString(), false);
      } catch (e) {
        console.error('Failed to send contact card:', e);
      }
    }
  }, [targetId]);

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
        const res = await messageApi.getHistory(targetId!, chatType);
        if (res.code === 200) {
          const data = res.data || [];
          setHasMore(data.length >= 20);
          useChatStore.getState().setMessages(conversationKey, [...data].reverse());
        }
      }
    } catch (e) {
      console.error('Failed to load history:', e);
    }
  };

  const loadMore = async () => {
    if (!targetId || isAiChat || loadingMore || !hasMore) return;
    setLoadingMore(true);
    const listEl = messageListRef.current;
    const prevScrollHeight = listEl?.scrollHeight || 0;
    try {
      const nextPage = page + 1;
      const res = await messageApi.getHistory(targetId, chatType, nextPage, 20);
      if (res.code === 200) {
        const older = [...(res.data || [])].reverse();
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
    if (!user) {
      Toast.show({ content: t('common.error') });
      return;
    }
    if (!targetId) {
      Toast.show({ content: t('common.error') });
      return;
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      msgId: Date.now().toString(),
      senderId: user.userId,
      receiverId: targetId,
      chatType: chatType,
      msgType: pendingAttachments.length > 0 && pendingAttachments[0].type === 'image' ? 'IMAGE' : 'TEXT',
      content: pendingAttachments.length > 0 ? pendingAttachments[0].preview : inputText.trim(),
      createdAt: new Date().toISOString(),
    };

    addMessage(conversationKey, userMessage);
    const textToSend = inputText.trim();
    const attachmentsToSend = [...pendingAttachments];
    setInputText('');
    setPendingAttachments([]);

    if (isAiChat) {
      const currentSessionId = sessionId || `ai_${user.userId}`;

      if (attachmentsToSend.length > 0) {
        // 有附件：构造多模态消息
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
        // 纯文本
        await aiSendMessage(currentSessionId, textToSend, String(user.userId));
      }
    } else {
      const wsMessage: ChatMessage = {
        type: 'TEXT',
        from: String(user.userId),
        to: targetId,
        group: chatType === 1,
        content: inputText.trim(),
      };
      wsService.send(wsMessage);
      updateConversation(
        conversationKey,
        inputText.trim().length > 30 ? inputText.trim().substring(0, 30) + '...' : inputText.trim(),
        new Date().toISOString(),
        false
      );
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !targetId || !user) return;

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
      // 普通聊天：原有上传逻辑
      // ...existing code...
    }

    // 清空 input
    [fileInputRef.current, albumInputRef.current, cameraInputRef.current, videoInputRef.current, docInputRef.current].forEach(input => {
      if (input) input.value = '';
    });
  };

  const handleRecordStart = async () => {
    try {
      await startRecording();
      setIsRecording(true);
    } catch (e) {
      Toast.show({ content: t('chat.failedRecord') });
    }
  };

  const handleRecordEnd = async () => {
    if (!isRecording || !targetId || !user) return;

    try {
      const { blob, duration } = await stopRecording();
      setIsRecording(false);

      const file = new File([blob], `voice_${Date.now()}.webm`, { type: 'audio/webm' });
      const fileResult = await fileApi.upload(file);

      const message: ChatMessage = {
        type: 'VOICE',
        from: String(user.userId),
        to: targetId,
        group: chatType === 1,
        content: fileResult.url,
        headers: {
          duration: String(duration),
          format: 'webm',
        },
      };

      wsService.send(message);
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

  const getChatTitle = () => {
    if (isAiChat) return AI_ASSISTANT.NAME;
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
    setContextMenuVisible(true);
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

  const handleEditMessage = () => {
    if (selectedMessage) {
      setEditingMessageId(selectedMessage.msgId);
      setEditText(selectedMessage.content);
      setContextMenuVisible(false);
    }
  };

  const handleRegenerate = async () => {
    if (selectedMessage && isAiChat && sessionId && user) {
      await useAiChatStore.getState().regenerateMessage(sessionId, selectedMessage.msgId, String(user.userId));
    }
    setContextMenuVisible(false);
  };

  const handleResendMessage = async () => {
    if (selectedMessage && isAiChat && sessionId && user) {
      setContextMenuVisible(false);
      await useAiChatStore.getState().resendMessage(sessionId, selectedMessage.msgId, String(user.userId));
    } else {
      setContextMenuVisible(false);
    }
  };

  const handleSaveEdit = async () => {
    if (editingMessageId && isAiChat && sessionId && user) {
      try {
        await useAiChatStore.getState().editMessage(
          sessionId, editingMessageId, editText, String(user.userId)
        );
        setEditingMessageId(null);
        setEditText('');
      } catch (e) {
        Toast.show({ content: t('common.error') });
      }
    }
  };

  const handleCancelEdit = () => {
    setEditingMessageId(null);
    setEditText('');
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

  const handleSelectModel = async (modelId: string) => {
    setShowModelPicker(false);
    const sid = sessionId || `ai_${user?.userId}`;
    if (!sid) return;
    try {
      await lockModel(sid, modelId);
      setCurrentModel(modelId);
      Toast.show({ content: `${t('ai.modelLocked')}: ${modelId}` });
    } catch (e) {
      Toast.show({ content: t('common.error') });
    }
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
        columns={[models.map((m) => ({ label: m.name, value: m.id }))]}
        visible={showModelPicker}
        onClose={() => setShowModelPicker(false)}
        value={currentModel ? [currentModel] : []}
        onConfirm={(val) => {
          if (val && val.length > 0) handleSelectModel(val[0] as string);
          else setShowModelPicker(false);
        }}
      />

      <div className={styles.messageList} ref={messageListRef} onScroll={handleScroll}>
        {loadingMore && (
          <div className={styles.loadingMore}>{t('common.loading')}</div>
        )}
        {!isAiChat && !hasMore && conversationMessages.length > 0 && (
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
          return (
            <Fragment key={msg.msgId || msg.id}>
              {showTime && (
                <div className={styles.timeBar}>
                  <span>{formatMessageTime(msg.createdAt)}</span>
                </div>
              )}
              <MessageBubble
                message={msg}
                isSelf={msg.senderId === user?.userId}
                senderName={getSenderNameFor(msg.senderId)}
                senderAvatar={getSenderAvatar(msg.senderId)}
                showSenderName={chatType === 1}
                onAvatarClick={msg.senderId !== String(AI_ASSISTANT.ID) && msg.senderId !== user?.userId
                  ? () => navigate(`/contacts/${msg.senderId}`)
                  : undefined}
                onImageClick={(src) => {
                  setImageViewerSrc(src);
                  setImageViewerVisible(true);
                }}
                onLongPress={() => handleLongPress(msg)}
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
        <div className={styles.recordingBanner}>
          录制中...
        </div>
      )}

      <div className={styles.inputArea}>
        <div className={styles.inputRow}>
          <div
            className={styles.iconBtn}
            onTouchStart={handleRecordStart}
            onTouchEnd={handleRecordEnd}
            onMouseDown={handleRecordStart}
            onMouseUp={handleRecordEnd}
          >
            <SoundOutline />
          </div>

          <Input
            value={inputText}
            onChange={setInputText}
            onEnterPress={sendTextMessage}
            placeholder={t('chat.messagePlaceholder')}
            className={styles.input}
          />

          <div className={styles.iconBtn}>
            <SmileOutline />
          </div>

          <div className={styles.iconBtn} onClick={() => setShowActions(true)}>
            <AddOutline />
          </div>
        </div>

        {isStreaming ? (
          <Button color="danger" block size="small" onClick={aiStopStreaming} className={styles.sendBtn}>
            {t('chat.stopGeneration')}
          </Button>
        ) : (inputText.trim() || pendingAttachments.length > 0) ? (
          <Button color="primary" block size="small" onClick={sendTextMessage} className={styles.sendBtn}>
            {t('common.send')}
          </Button>
        ) : null}
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

      <Popup visible={showActions} onMaskClick={() => setShowActions(false)} position="bottom">
        <div className={styles.actionPanel}>
          <div className={styles.actionGrid}>
            <div className={styles.actionItem} onClick={() => albumInputRef.current?.click()}>
              <div className={`${styles.actionIcon}`} style={{ background: '#5b9bd5' }}>
                <PicturesOutline />
              </div>
              <span>{t('chat.album')}</span>
            </div>
            <div className={styles.actionItem} onClick={() => cameraInputRef.current?.click()}>
              <div className={styles.actionIcon} style={{ background: '#6fb648' }}>
                <CameraOutline />
              </div>
              <span>{t('chat.camera')}</span>
            </div>
            <div className={styles.actionItem} onClick={() => videoInputRef.current?.click()}>
              <div className={styles.actionIcon} style={{ background: '#fa9d3b' }}>
                <VideoOutline />
              </div>
              <span>{t('chat.video')}</span>
            </div>
            <div className={styles.actionItem} onClick={() => docInputRef.current?.click()}>
              <div className={styles.actionIcon} style={{ background: '#7c6ee6' }}>
                <FolderOutline />
              </div>
              <span>{t('chat.file')}</span>
            </div>
          </div>
        </div>
      </Popup>

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
        <div className={styles.downloadBtn} onClick={() => downloadFile(imageViewerSrc)}>
          {t('chat.saveMedia')}
        </div>
      )}

      {/* Context Menu */}
      <Popup
        visible={contextMenuVisible}
        onMaskClick={() => setContextMenuVisible(false)}
        bodyStyle={{
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          padding: '8px 0 32px',
        }}
      >
        <div className={styles.menuItem} onClick={handleCopyMessage}>
          {t('chat.copyMessage')}
        </div>
        {isAiChat && selectedMessage?.senderId === '0' && (
          <div className={styles.menuItem} onClick={handleRegenerate}>
            {t('chat.regenerate')}
          </div>
        )}
        {selectedMessage?.senderId === String(user?.userId) && (
          <div className={styles.menuItem} onClick={handleEditMessage}>
            {t('chat.editMessage')}
          </div>
        )}
        {isAiChat && selectedMessage?.senderId === String(user?.userId) && (
          <div className={styles.menuItem} onClick={handleResendMessage}>
            {t('chat.resendMessage')}
          </div>
        )}
        <div className={`${styles.menuItem} ${styles.dangerItem}`} onClick={handleDeleteMessage}>
          {t('common.delete')}
        </div>
        <div className={styles.menuItem} onClick={() => setContextMenuVisible(false)}>
          {t('common.cancel')}
        </div>
      </Popup>

      {/* Edit Dialog */}
      <Popup
        visible={!!editingMessageId}
        onMaskClick={handleCancelEdit}
        bodyStyle={{
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          padding: '16px',
        }}
      >
        <div className={styles.editDialog}>
          <textarea
            className={styles.editTextarea}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            rows={6}
            autoFocus
          />
          <div className={styles.editActions}>
            <Button onClick={handleCancelEdit}>{t('common.cancel')}</Button>
            <Button color="primary" onClick={handleSaveEdit}>{t('common.save')}</Button>
          </div>
        </div>
      </Popup>
    </div>
  );
};

export default ChatWindow;
