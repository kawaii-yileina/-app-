import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import { ConfigProvider, Toast } from 'antd-mobile';
import zhCN from 'antd-mobile/es/locales/zh-CN';
import { useTranslation } from 'react-i18next';
import { App as CapApp } from '@capacitor/app';
import { useAuthStore } from './store/useAuthStore';
import { useChatStore } from './store/useChatStore';
import { useOnlineStore } from './store/useOnlineStore';
import { useContactStore } from './store/useContactStore';
import { contactApi, messageApi } from './api';
import wsService from './services/websocket';
import callManager from './services/call';
import { useCallRingtone } from './hooks/useCallRingtone';
import { syncConversations } from './services/messageSync';
import CallOverlay from './components/CallOverlay';
import type { ChatMessage, Message } from './types';
import { CALL_SIGNAL_TYPES } from './types/call';
import { SystemEventType, parseSystemEventType } from './types';
import { truncatePreview, parseReplyInfo, parseMentions, toFiniteNumber } from './utils/messagePreview';
import Login from './pages/Login';
import ResetPassword from './pages/Login/ResetPassword';
import Main from './pages/Main';
import ChatList from './pages/Main/ChatList';
import Contacts from './pages/Main/Contacts';
import Profile from './pages/Main/Profile';
import ChatWindow from './pages/ChatWindow';
import AddFriend from './pages/Contacts/AddFriend';
import Groups from './pages/Contacts/Groups';
import GroupDetail from './pages/Contacts/GroupDetail';
import FriendDetail from './pages/Contacts/FriendDetail';
import FriendRequests from './pages/Contacts/FriendRequests';
import AiConfig from './pages/Profile/AiConfig';
import MyInfo from './pages/Profile/MyInfo';
import Settings from './pages/Profile/Settings';
import ChangePassword from './pages/Profile/Settings/ChangePassword';
import DeleteAccount from './pages/Profile/Settings/DeleteAccount';
import SelectTarget from './pages/Chat/SelectTarget';
import SearchPage from './pages/Search';
import { installBackGuard, runBackGuard } from './services/backGuard';

const isVisibleElement = (el: HTMLElement): boolean => {
  const style = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return style.display !== 'none'
    && style.visibility !== 'hidden'
    && Number(style.opacity) > 0
    && rect.width > 0
    && rect.height > 0;
};

const BackButtonHandler = () => {
  const { t } = useTranslation();
  useEffect(() => {
    const uninstall = installBackGuard();
    let lastBackAt = 0;

    const subscription = CapApp.addListener('backButton', ({ canGoBack }) => {
      if (runBackGuard()) return;

      // antd-mobile 浮层兜底：优先点关闭按钮，其次点击最上层遮罩
      const closeButton = document.querySelector('.adm-image-viewer-close') as HTMLElement | null;
      if (closeButton && isVisibleElement(closeButton)) {
        closeButton.click();
        return;
      }
      const masks = Array.from(document.querySelectorAll<HTMLElement>('.adm-mask'))
        .filter(isVisibleElement);
      if (masks.length > 0) {
        masks[masks.length - 1].click();
        return;
      }

      const homePaths = ['/', '/chat', '/contacts', '/profile'];
      const path = window.location.pathname;
      const isHome = homePaths.includes(path);

      if (isHome) {
        const now = Date.now();
        if (now - lastBackAt < 2000) {
          CapApp.exitApp();
        } else {
          lastBackAt = now;
          Toast.show({ content: t('common.pressAgainToExit') });
        }
      } else if (canGoBack) {
        window.history.back();
      } else {
        CapApp.exitApp();
      }
    });

    return () => {
      subscription.then((sub) => sub.remove());
      uninstall();
    };
  }, [t]);

  return null;
};

const PrivateRoute = ({ children }: { children: React.ReactNode }) => {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" />;
};

const SessionRestore = () => {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const restoreUser = useAuthStore((s) => s.restoreUser);

  useEffect(() => {
    if (token && !user) {
      restoreUser(token);
    }
  }, [token, user, restoreUser]);

  useEffect(() => {
    const theme = localStorage.getItem('theme');
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  }, []);

  return null;
};

const wsMessageToMessage = (msg: ChatMessage): Message => ({
  id: msg.id || '',
  msgId: msg.id || '',
  senderId: msg.from,
  receiverId: msg.to,
  chatType: msg.group ? 1 : 0,
  msgType: msg.type || 'TEXT',
  content: msg.content,
  createdAt: new Date().toISOString(),
  headers: msg.headers,
  // 持久化投递路径（跨节点/离线）在 headers.seq 附带权威 seq；本节点直投无 seq，由 /sync 回填
  seq: toFiniteNumber(msg.headers?.seq),
  replyTo: parseReplyInfo(msg.headers?.replyTo),
  mentions: parseMentions(msg.headers?.mentions),
});

const WebSocketProvider = () => {
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const addMessage = useChatStore((s) => s.addMessage);
  const updateConversation = useChatStore((s) => s.updateConversation);
  const setConversations = useChatStore((s) => s.setConversations);
  const setFriends = useContactStore((s) => s.setFriends);
  const setGroups = useContactStore((s) => s.setGroups);
  const setOnlineUsers = useOnlineStore((s) => s.setOnlineUsers);
  const addOnlineUser = useOnlineStore((s) => s.addOnlineUser);
  const removeOnlineUser = useOnlineStore((s) => s.removeOnlineUser);

  useEffect(() => {
    if (!token) return;
    wsService.connect(token);
    if (user?.userId) {
      wsService.setUserId(String(user.userId));
    }
    loadInitialData(setConversations, setFriends, setGroups, setOnlineUsers);

    const unsubscribe = wsService.onMessage((message: ChatMessage) => {
      // 音视频通话信令（瞬时）：交由通话管理器处理，不入会话消息
      if (message.type && CALL_SIGNAL_TYPES.has(message.type)) {
        callManager.handleSignal(message);
        return;
      }
      if (message.type === 'SYSTEM') {
        const content = message.content || '';
        const headers = message.headers || {};

        // ACK 消息：持久化成功后的确认
        if (headers.ack === 'true') {
          const clientMsgId = headers.clientMsgId || '';
          const serverMsgId = headers.serverMsgId || '';
          const ackSeq = toFiniteNumber(headers.seq);
          if (clientMsgId) {
            // 清除超时定时器
            useChatStore.getState().clearPending(clientMsgId);
            const targetMsgId = serverMsgId || clientMsgId;
            // 更新本地消息的 msgId 为服务端 id、状态为 sent，并写入 ACK 携带的权威 seq
            const messages = useChatStore.getState().messages;
            for (const [key, list] of Object.entries(messages)) {
              const found = list.find(m => m.msgId === clientMsgId);
              if (found) {
                // 服务端副本可能已由增量补拉提前插入：此时丢弃本地乐观副本，避免重复气泡
                if (targetMsgId !== clientMsgId && list.some(m => m.msgId === targetMsgId)) {
                  useChatStore.getState().removeMessage(key, clientMsgId);
                } else {
                  useChatStore.getState().updateMessage(key, clientMsgId, {
                    msgId: targetMsgId,
                    status: 'sent',
                    ...(ackSeq != null ? { seq: ackSeq } : {}),
                  });
                }
                break;
              }
            }
          }
          return;
        }

        const userId = content.includes(':') ? content.split(':')[1] : '';
        const eventType = parseSystemEventType(content);

        switch (eventType) {
          case SystemEventType.ONLINE:
            if (userId) addOnlineUser(userId);
            break;
          case SystemEventType.OFFLINE:
            if (userId) removeOnlineUser(userId);
            break;
          case SystemEventType.FRIEND_REQUEST:
          case SystemEventType.FRIEND_ACCEPT:
          case SystemEventType.FRIEND_REJECT:
            // 好友关系变化，刷新好友列表
            contactApi.getFriends().then(res => {
              if (res.code === 200) useContactStore.getState().setFriends(res.data);
            }).catch(() => {});
            break;
          case SystemEventType.GROUP_ADD:
          case SystemEventType.GROUP_KICK:
          case SystemEventType.GROUP_QUIT:
          case SystemEventType.GROUP_TRANSFER:
          case SystemEventType.GROUP_RENAME:
          case SystemEventType.GROUP_ADMIN_SET:
          case SystemEventType.GROUP_ADMIN_UNSET:
            // 群组变化，刷新群组列表
            contactApi.getGroups().then(res => {
              if (res.code === 200) useContactStore.getState().setGroups(res.data);
            }).catch(() => {});
            window.dispatchEvent(new CustomEvent('group:changed', {
              detail: { groupId: content.split(':')[1] || '' },
            }));
            break;
          case SystemEventType.MESSAGE_RECALL: {            // 消息撤回：content 格式 message_recall:msgId，本地替换为撤回态
            const recalledMsgId = content.split(':')[1] || '';
            if (recalledMsgId) {
              const messagesMap = useChatStore.getState().messages;
              for (const [key, list] of Object.entries(messagesMap)) {
                if (list.some(m => m.msgId === recalledMsgId)) {
                  useChatStore.getState().updateMessage(key, recalledMsgId, {
                    msgType: 'RECALL',
                    content: '',
                  });
                  break;
                }
              }
            }
            // 撤回可能改变会话预览（last_msg_content），以后端为准刷新列表
            messageApi.getConversations().then(res => {
              if (res.code === 200) setConversations(res.data);
            }).catch(() => {});
            break;
          }
          case SystemEventType.RATE_LIMITED: {
            // 发送频率超限：后端已阻断该消息，本地置失败并提示
            const rateLimitedClientMsgId = headers.clientMsgId || '';
            if (rateLimitedClientMsgId) {
              useChatStore.getState().clearPending(rateLimitedClientMsgId);
              const messagesMap = useChatStore.getState().messages;
              for (const [key, list] of Object.entries(messagesMap)) {
                if (list.some(m => m.msgId === rateLimitedClientMsgId)) {
                  useChatStore.getState().updateMessage(key, rateLimitedClientMsgId, { status: 'failed' });
                  break;
                }
              }
            }
            Toast.show({ content: t('chat.rateLimited') });
            break;
          }
          default:
            break;
        }
      } else if (message.type === 'TYPING') {
        // 输入中状态（仅私聊）：更新对应会话的输入中时间戳，不当作消息入库
        const typingKey = `${message.from}_0`;
        useChatStore.getState().setTyping(typingKey);
      } else {
        const targetId = message.group ? message.to : message.from;
        const key = `${targetId}_${message.group ? 1 : 0}`;
        const isMine = message.from === String(user?.userId);
        if (!isMine) {
          addMessage(key, wsMessageToMessage(message));
          // 对方已发出消息，清除"正在输入"状态
          useChatStore.getState().clearTyping(key);
        }

        const isAi = message.from === '0' || message.to === '0';
        if (!isAi) {
          updateConversation(
            key,
            truncatePreview(message.content || '', message.type, message.headers),
            new Date().toISOString(),
            !isMine
          );
        }

        if (!isMine && !isAi) {
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(t('common.newMessage'), { body: message.content, icon: '/vite.svg' });
          }
        }
      }
    });

    // 连接（含重连）建立后对已加载过的会话做增量补拉，补齐离线/其他设备期间的消息，
    // 完成后刷新会话列表（预览/未读角标）
    const unsubscribeOpen = wsService.onOpen(() => {
      const state = useChatStore.getState();
      const convs = state.conversations
        .map((c) => ({ targetId: c.targetId, chatType: c.chatType }))
        .filter((c) => (state.syncCursors[`${c.targetId}_${c.chatType}`] || 0) > 0);
      if (convs.length === 0) {
        return;
      }
      syncConversations(convs).finally(() => {
        messageApi
          .getConversations()
          .then((res) => {
            if (res.code === 200) setConversations(res.data);
          })
          .catch(() => {});
      });
    });

    return () => {
      unsubscribe();
      unsubscribeOpen();
      wsService.disconnect();
    };
  }, [token, user?.userId]);

  return null;
};

const loadInitialData = async (
  setConversations: (c: import('./types').Conversation[]) => void,
  setFriends: (f: import('./types').Friend[]) => void,
  setGroups: (g: import('./types').Group[]) => void,
  setOnlineUsers: (u: string[]) => void,
) => {
  try {
    const [convRes, friendRes, groupRes, onlineRes] = await Promise.all([
      messageApi.getConversations(),
      contactApi.getFriends(),
      contactApi.getGroups(),
      messageApi.getOnlineFriends().catch(() => ({ code: 500, data: [] as string[] })),
    ]);
    if (convRes.code === 200) setConversations(convRes.data);
    if (friendRes.code === 200) setFriends(friendRes.data);
    if (groupRes.code === 200) setGroups(groupRes.data);
    if (onlineRes.code === 200 && Array.isArray(onlineRes.data)) setOnlineUsers(onlineRes.data);
  } catch (e) {
    console.error('Failed to load initial data:', e);
  }
};

const CallRingtoneProvider = () => {
  useCallRingtone();
  return null;
};

function App() {
  return (
      <ConfigProvider locale={zhCN}>
        <SessionRestore />
        <WebSocketProvider />
        <CallRingtoneProvider />
        <CallOverlay />
        <BrowserRouter>
          <BackButtonHandler />
          <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route
            path="/"
            element={
              <PrivateRoute>
                <Main />
              </PrivateRoute>
            }
          >
            <Route index element={<Navigate to="/chat" replace />} />
            <Route path="chat" element={<ChatList />} />
            <Route path="contacts" element={<Contacts />} />
            <Route path="profile" element={<Profile />} />
          </Route>

          <Route path="/chat/:targetId" element={<PrivateRoute><ChatWindow /></PrivateRoute>} />
          <Route path="/search" element={<PrivateRoute><SearchPage /></PrivateRoute>} />
          <Route path="/contacts/search" element={<PrivateRoute><AddFriend /></PrivateRoute>} />
          <Route path="/contacts/requests" element={<PrivateRoute><FriendRequests /></PrivateRoute>} />
          <Route path="/contacts/groups" element={<PrivateRoute><Groups /></PrivateRoute>} />
          <Route path="/contacts/groups/:groupId" element={<PrivateRoute><GroupDetail /></PrivateRoute>} />
          <Route path="/contacts/:friendId" element={<PrivateRoute><FriendDetail /></PrivateRoute>} />
          <Route path="/profile/ai" element={<PrivateRoute><AiConfig /></PrivateRoute>} />
          <Route path="/profile/info" element={<PrivateRoute><MyInfo /></PrivateRoute>} />
          <Route path="/profile/settings" element={<PrivateRoute><Settings /></PrivateRoute>} />
          <Route path="/profile/change-password" element={<PrivateRoute><ChangePassword /></PrivateRoute>} />
          <Route path="/profile/delete-account" element={<PrivateRoute><DeleteAccount /></PrivateRoute>} />
          <Route path="/select-target" element={<PrivateRoute><SelectTarget /></PrivateRoute>} />
        </Routes>
      </BrowserRouter>
    </ConfigProvider>
  );
}

export default App;
