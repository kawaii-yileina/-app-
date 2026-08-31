import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import { ConfigProvider } from 'antd-mobile';
import zhCN from 'antd-mobile/es/locales/zh-CN';
import { useTranslation } from 'react-i18next';
import { App as CapApp } from '@capacitor/app';
import { useAuthStore } from './store/useAuthStore';
import { useChatStore } from './store/useChatStore';
import { useOnlineStore } from './store/useOnlineStore';
import { useContactStore } from './store/useContactStore';
import { contactApi, messageApi } from './api';
import wsService from './services/websocket';
import type { ChatMessage, Message } from './types';
import Login from './pages/Login';
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
import SelectTarget from './pages/Chat/SelectTarget';

const BackButtonHandler = () => {
  useEffect(() => {
    const subscription = CapApp.addListener('backButton', ({ canGoBack }) => {
      const hasPopup = document.querySelector('.adm-popup,.adm-center-popup,.adm-dialog-wrap,.adm-action-sheet');
      if (hasPopup) {
        const mask = document.querySelector('.adm-mask') as HTMLElement;
        if (mask) mask.click();
        return;
      }

      const homePaths = ['/', '/chat', '/contacts', '/profile'];
      const path = window.location.pathname;
      const isHome = homePaths.includes(path);

      if (isHome) {
        CapApp.exitApp();
      } else if (canGoBack) {
        window.history.back();
      } else {
        CapApp.exitApp();
      }
    });

    return () => {
      subscription.then((sub) => sub.remove());
    };
  }, []);

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
      if (message.type === 'SYSTEM') {
        const content = message.content || '';
        const userId = content.includes(':') ? content.split(':')[1] : '';
        if (content.includes('online')) {
          if (userId) addOnlineUser(userId);
        } else if (content.includes('offline')) {
          if (userId) removeOnlineUser(userId);
        }
      } else {
        const targetId = message.group ? message.to : message.from;
        const key = `${targetId}_${message.group ? 1 : 0}`;
        const isMine = message.from === String(user?.userId);
        if (!isMine) {
          addMessage(key, wsMessageToMessage(message));
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

    return () => {
      unsubscribe();
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

const truncatePreview = (content: string, type: string, headers?: Record<string, string>) => {
  switch (type) {
    case 'IMAGE': return '[图片]';
    case 'VIDEO': return '[视频]';
    case 'VOICE': return `[语音] ${Math.round(Number(headers?.duration) || 0)}"`;
    case 'CONTACT_CARD': return '[个人名片]';
    case 'FILE': {
      const name = headers?.originalName || '';
      const text = `[文件] ${name}`;
      return text.length > 30 ? text.substring(0, 30) + '...' : text;
    }
    default:
      return content.length > 30 ? content.substring(0, 30) + '...' : content;
  }
};

function App() {
  return (
      <ConfigProvider locale={zhCN}>
        <SessionRestore />
        <WebSocketProvider />
        <BrowserRouter>
          <BackButtonHandler />
          <Routes>
          <Route path="/login" element={<Login />} />
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
          <Route path="/contacts/search" element={<PrivateRoute><AddFriend /></PrivateRoute>} />
          <Route path="/contacts/requests" element={<PrivateRoute><FriendRequests /></PrivateRoute>} />
          <Route path="/contacts/groups" element={<PrivateRoute><Groups /></PrivateRoute>} />
          <Route path="/contacts/groups/:groupId" element={<PrivateRoute><GroupDetail /></PrivateRoute>} />
          <Route path="/contacts/:friendId" element={<PrivateRoute><FriendDetail /></PrivateRoute>} />
          <Route path="/profile/ai" element={<PrivateRoute><AiConfig /></PrivateRoute>} />
          <Route path="/profile/info" element={<PrivateRoute><MyInfo /></PrivateRoute>} />
          <Route path="/profile/settings" element={<PrivateRoute><Settings /></PrivateRoute>} />
          <Route path="/select-target" element={<PrivateRoute><SelectTarget /></PrivateRoute>} />
        </Routes>
      </BrowserRouter>
    </ConfigProvider>
  );
}

export default App;
