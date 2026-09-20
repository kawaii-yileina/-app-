import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { NavBar, SearchBar } from 'antd-mobile';
import { useTranslation } from 'react-i18next';
import { useContactStore } from '../../../store/useContactStore';
import { useChatStore } from '../../../store/useChatStore';
import SharedAvatar from '../../../components/SharedAvatar';
import { PENDING_FORWARD_KEY, PENDING_OUTGOING_KEY, formatConversationPreview } from '../../../utils/messagePreview';
import styles from './index.module.css';

interface TargetItem {
  id: string;
  name: string;
  avatar: string;
  chatType: number;
  subtitle?: string;
}

const SelectTarget = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const action = searchParams.get('action') || 'recommend';
  const contactUserId = searchParams.get('userId') || '';
  const contactNickname = searchParams.get('nickname') || '';
  const contactAvatar = searchParams.get('avatar') || '';

  const friends = useContactStore((s) => s.friends);
  const groups = useContactStore((s) => s.groups);
  const conversations = useChatStore((s) => s.conversations);
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<TargetItem[]>([]);
  const [recentTargets, setRecentTargets] = useState<TargetItem[]>([]);

  useEffect(() => {
    loadRecentTargets();
  }, [conversations, friends, groups]);

  const loadRecentTargets = () => {
    const targets: TargetItem[] = conversations.map((conv) => {
      if (conv.chatType === 1) {
        const group = groups.find((g) => g.id === conv.targetId);
        return {
          id: conv.targetId,
          name: group?.name || t('common.unknownGroup'),
          avatar: group?.avatar || '',
          chatType: 1,
          subtitle: formatConversationPreview(conv.lastMsgContent, t),
        };
      }
      const friend = friends.find((f) => f.userId === conv.targetId);
      return {
        id: conv.targetId,
        name: friend?.nickname || friend?.username || t('common.unknown'),
        avatar: friend?.avatar || '',
        chatType: 0,
        subtitle: formatConversationPreview(conv.lastMsgContent, t),
      };
    });
    setRecentTargets(targets);
  };

  const handleSearch = (val: string) => {
    setKeyword(val);
    if (!val.trim()) {
      setResults([]);
      return;
    }
    const q = val.toLowerCase();
    const matchedFriends: TargetItem[] = friends
      .filter((f) =>
        (f.nickname || '').toLowerCase().includes(q) ||
        (f.username || '').toLowerCase().includes(q)
      )
      .map((f) => ({
        id: f.userId,
        name: f.nickname || f.username || '',
        avatar: f.avatar || '',
        chatType: 0,
        subtitle: t('contacts.message'),
      }));
    const matchedGroups: TargetItem[] = groups
      .filter((g) => (g.name || '').toLowerCase().includes(q))
      .map((g) => ({
        id: g.id,
        name: g.name || '',
        avatar: g.avatar || '',
        chatType: 1,
        subtitle: t('contacts.groupMembers'),
      }));
    setResults([...matchedFriends, ...matchedGroups]);
  };

  const handleSelect = (target: TargetItem) => {
    let payload: string | null = null;
    if (action === 'recommend') {
      payload = JSON.stringify({
        msgType: 'CONTACT_CARD',
        content: JSON.stringify({
          userId: contactUserId,
          nickname: contactNickname,
          avatar: contactAvatar,
        }),
        preview: t('chat.contactCard'),
        successToast: t('chat.cardSent'),
      });
    } else {
      // 转发：载荷由来源聊天页写入 pending_forward
      const forwarded = sessionStorage.getItem(PENDING_FORWARD_KEY);
      sessionStorage.removeItem(PENDING_FORWARD_KEY);
      if (forwarded) {
        payload = JSON.stringify({ ...JSON.parse(forwarded), successToast: t('chat.forwarded') });
      }
    }
    if (payload) {
      sessionStorage.setItem(PENDING_OUTGOING_KEY, payload);
    }
    navigate(`/chat/${target.id}?type=${target.chatType}`, { replace: true });
  };

  const displayList = keyword.trim() ? results : recentTargets;

  return (
    <div className={styles.container}>
      <NavBar onBack={() => navigate(-1)} className={styles.navBar}>
        {action === 'recommend' ? t('chat.sendToFriend') : t('chat.forward')}
      </NavBar>

      <div className={styles.searchSection}>
        <SearchBar
          placeholder={t('contacts.searchPlaceholder')}
          value={keyword}
          onChange={handleSearch}
          className={styles.searchInput}
        />
      </div>

      <div className={styles.list}>
        {displayList.length === 0 && (
          <div className={styles.empty}>{t('common.noData')}</div>
        )}
        {displayList.map((item) => (
          <div
            key={`${item.id}_${item.chatType}`}
            className={styles.item}
            onClick={() => handleSelect(item)}
          >
            <SharedAvatar name={item.name} src={item.avatar} size={44} />
            <div className={styles.itemInfo}>
              <span className={styles.itemName}>{item.name}</span>
              {item.subtitle && <span className={styles.itemSub}>{item.subtitle}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SelectTarget;
