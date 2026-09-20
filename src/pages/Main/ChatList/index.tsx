import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { SearchBar, Badge, Toast, Button, SwipeAction, Popup, Picker } from 'antd-mobile';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '../../../store/useChatStore';
import { useContactStore } from '../../../store/useContactStore';
import { useOnlineStore } from '../../../store/useOnlineStore';
import { AI_ASSISTANT } from '../../../types';
import { formatConversationPreview } from '../../../utils/messagePreview';
import { aiApi, messageApi } from '../../../api';
import { createSession, getModels, type HermesModel } from '../../../api/hermes';
import { resolveFileUrl } from '../../../utils/fileUrl';
import type { Conversation } from '../../../types';
import { avatarTint } from '../../../utils/avatarColor';
import styles from './index.module.css';

const ChatList = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const conversations = useChatStore((s) => s.conversations);
  const friends = useContactStore((s) => s.friends);
  const groups = useContactStore((s) => s.groups);
  const onlineUsers = useOnlineStore((s) => s.onlineUsers);
  const [aiSessions, setAiSessions] = useState<{ sessionId: string; title: string | null }[]>([]);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [sessionTitle, setSessionTitle] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [models, setModels] = useState<HermesModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [showModelPicker, setShowModelPicker] = useState(false);

  const formatPreview = (content: string) => formatConversationPreview(content, t);

  useEffect(() => {
    loadAiSessions();
  }, []);

  const loadAiSessions = async () => {
    try {
      const res = await aiApi.getSessions();
      if (res.code === 200) {
        setAiSessions(res.data || []);
      }
    } catch (e) {
      console.error('Failed to load AI sessions:', e);
    }
  };

  const getTargetInfo = (targetId: string, chatType: number) => {
    if (targetId === String(AI_ASSISTANT.ID)) {
      return { name: AI_ASSISTANT.NAME, avatar: AI_ASSISTANT.AVATAR, isOnline: true, isAi: true };
    }
    if (chatType === 1) {
      const group = groups.find((g) => g.id === targetId);
      return { name: group?.name || t('common.unknownGroup'), avatar: group?.avatar, isOnline: false, isAi: false };
    }
    const friend = friends.find((f) => f.userId === targetId);
    const isOnline = onlineUsers.has(String(targetId));
    return { name: friend?.nickname || friend?.username || t('common.unknown'), avatar: friend?.avatar, isOnline, isAi: false };
  };

  const handleConversationClick = (targetId: string, chatType: number) => {
    navigate(`/chat/${targetId}?type=${chatType}`);
  };

  const handleDeleteConversation = async (conv: Conversation) => {
    try {
      const res = await messageApi.deleteConversation(conv.targetId, conv.chatType);
      if (res.code === 200) {
        useChatStore.getState().removeConversation(`${conv.targetId}_${conv.chatType}`);
        Toast.show({ content: t('common.success') });
      } else {
        Toast.show({ content: res.message || t('common.error') });
      }
    } catch (e) {
      Toast.show({ content: t('common.error') });
    }
  };

  const handleAiSessionClick = (sessionId: string) => {
    navigate(`/chat/0?type=0&session=${sessionId}`);
  };

  const handleNewAiSession = () => {
    setSessionTitle('');
    setSystemPrompt('');
    setSelectedModel(null);
    setShowCreateDialog(true);
    getModels().then((list) => setModels(list)).catch(() => setModels([]));
  };

  const handleCreateAiSession = async () => {
    const newSessionId = `ai_${Date.now()}`;
    try {
      await createSession(newSessionId, {
        title: sessionTitle.trim() || undefined,
        systemPrompt: systemPrompt.trim() || undefined,
        model: selectedModel || undefined,
      });
      setShowCreateDialog(false);
      navigate(`/chat/0?type=0&session=${newSessionId}`);
    } catch (e) {
      Toast.show({ content: t('common.error') });
    }
  };

  const selectedModelName = models.find((m) => m.id === selectedModel)?.name || t('ai.defaultModel');

  const handleDeleteAiSession = async (sessionId: string) => {
    try {
      const res = await aiApi.deleteSession(sessionId);
      if (res.code === 200) {
        Toast.show({ content: t('chat.sessionDeleted') });
        loadAiSessions();
      } else {
        Toast.show({ content: res.message || t('common.error') });
      }
    } catch (e) {
      Toast.show({ content: t('common.error') });
    }
  };

  const formatTime = (time: string) => {
    if (!time) return '';
    const date = new Date(time);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    
    if (isToday) {
      return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    }
    
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
      return t('common.yesterday');
    }
    
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };

  const sortedConversations = [...conversations].sort((a, b) => {
    return new Date(b.lastMsgTime).getTime() - new Date(a.lastMsgTime).getTime();
  });

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2 className={styles.title}>{t('tab.chats')}</h2>
        <SearchBar placeholder={t('common.search')} className={styles.search} />
      </div>

      <div className={styles.list}>
        {/* AI Sessions Section */}
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>{t('chat.aiTitle')}</span>
          <Button size="small" color="primary" onClick={handleNewAiSession}>
            {t('chat.newSession')}
          </Button>
        </div>

        {aiSessions.length === 0 ? (
          <div className={styles.emptySession}>
            <span>{t('chat.noSessions')}</span>
          </div>
        ) : (
          aiSessions.map((session) => (
            <SwipeAction
              key={session.sessionId}
              className={styles.swipeItem}
              rightActions={[
                {
                  key: 'delete',
                  text: t('common.delete'),
                  color: 'danger',
                  onClick: () => handleDeleteAiSession(session.sessionId),
                },
              ]}
            >
              <div
                className={styles.item}
                onClick={() => handleAiSessionClick(session.sessionId)}
              >
                <div className={styles.avatarWrapper}>
                  <div className={styles.aiAvatar}>
                    <span>AI</span>
                  </div>
                </div>
                <div className={styles.info}>
                  <div className={styles.nameRow}>
                    <span className={styles.name}>{session.title || AI_ASSISTANT.NAME}</span>
                  </div>
                  <div className={styles.msgRow}>
                    <span className={styles.msg}>{t('chat.clickToChatAI')}</span>
                  </div>
                </div>
              </div>
            </SwipeAction>
          ))
        )}

        {/* Regular Conversations Section */}
        {sortedConversations.length > 0 && (
          <div className={styles.sectionHeader}>
            <span className={styles.sectionTitle}>{t('chat.title')}</span>
          </div>
        )}

        {sortedConversations.map((conv) => {
          const info = getTargetInfo(conv.targetId, conv.chatType);
          const convKey = `${conv.targetId}_${conv.chatType}`;
          return (
            <SwipeAction
              key={convKey}
              className={styles.swipeItem}
              rightActions={[
                {
                  key: 'delete',
                  text: t('common.delete'),
                  color: 'danger',
                  onClick: () => handleDeleteConversation(conv),
                },
              ]}
            >
              <div
                className={styles.item}
                onClick={() => handleConversationClick(conv.targetId, conv.chatType)}
              >
                <div className={styles.avatarWrapper}>
                  {info.isAi ? (
                    <div className={styles.aiAvatar}>
                      <span>AI</span>
                    </div>
                  ) : (
                    <>
                      {info.avatar ? (
                        <img src={resolveFileUrl(info.avatar)} alt={info.name} className={styles.avatar} />
                      ) : (
                        <div className={styles.avatar} style={{ background: avatarTint(info.name || conv.targetId) }}>
                          {info.name?.charAt(0)}
                        </div>
                      )}
                      {conv.chatType === 0 && info.isOnline && (
                        <div className={styles.onlineDot} />
                      )}
                    </>
                  )}
                </div>
                <div className={styles.info}>
                  <div className={styles.nameRow}>
                    <span className={styles.name}>{info.name}</span>
                    <span className={styles.time}>
                      {formatTime(conv.lastMsgTime)}
                    </span>
                  </div>
                  <div className={styles.msgRow}>
                    {conv.mentioned ? (
                      <span className={styles.mentionedTag}>{t('chat.mentionedMe')}</span>
                    ) : null}
                    <span className={styles.msg}>{formatPreview(conv.lastMsgContent)}</span>
                    {conv.unreadCount > 0 && (
                      <Badge
                        content={conv.unreadCount > 99 ? '99+' : String(conv.unreadCount)}
                        color="var(--c-primary)"
                        className={styles.badge}
                      />
                    )}
                  </div>
                </div>
              </div>
            </SwipeAction>
          );
        })}
      </div>

      {/* 新建 AI 会话弹窗 */}
      <Popup
        visible={showCreateDialog}
        onMaskClick={() => setShowCreateDialog(false)}
        bodyStyle={{ borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: '20px 16px 32px' }}
      >
        <div className={styles.createDialog}>
          <div className={styles.createTitle}>{t('chat.newSession')}</div>

          <div className={styles.createField}>
            <label className={styles.createLabel}>{t('ai.sessionTitle')}</label>
            <input
              className={styles.createInput}
              value={sessionTitle}
              onChange={(e) => setSessionTitle(e.target.value)}
              placeholder={t('ai.sessionTitlePlaceholder')}
            />
          </div>

          <div className={styles.createField}>
            <label className={styles.createLabel}>{t('ai.model')}</label>
            <div
              className={styles.createInput}
              onClick={() => models.length > 0 && setShowModelPicker(true)}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <span style={{ color: selectedModel ? '#111' : '#999' }}>{selectedModelName}</span>
              <span style={{ color: '#999' }}>›</span>
            </div>
          </div>

          <div className={styles.createField}>
            <label className={styles.createLabel}>{t('ai.systemPrompt')}</label>
            <textarea
              className={styles.createTextarea}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder={t('ai.systemPromptPlaceholder')}
              rows={3}
            />
          </div>

          <Button block color="primary" size="large" onClick={handleCreateAiSession} className={styles.createConfirmBtn}>
            {t('common.confirm')}
          </Button>
          <Button block fill="none" onClick={() => setShowCreateDialog(false)}>
            {t('common.cancel')}
          </Button>
        </div>
      </Popup>

      <Picker
        columns={[models.map((m) => ({ label: m.name, value: m.id }))]}
        visible={showModelPicker}
        onClose={() => setShowModelPicker(false)}
        value={selectedModel ? [selectedModel] : []}
        onConfirm={(val) => {
          if (val && val.length > 0) setSelectedModel(val[0] as string);
          setShowModelPicker(false);
        }}
      />
    </div>
  );
};

export default ChatList;
