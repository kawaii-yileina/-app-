import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, PullToRefresh } from 'antd-mobile';
import { CirclePlus, Search, Users, UserPlus, Inbox } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useContactStore } from '../../../store/useContactStore';
import { useOnlineStore } from '../../../store/useOnlineStore';
import { contactApi } from '../../../api';
import { refreshFriends, refreshOnlineFriends } from '../../../services/refresh';
import { usePullRefresh } from '../../../hooks/usePullRefresh';
import SharedAvatar from '../../../components/SharedAvatar';
import styles from './index.module.css';

const Contacts = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const friends = useContactStore((s) => s.friends);
  const onlineUsers = useOnlineStore((s) => s.onlineUsers);
  const [requestCount, setRequestCount] = useState(0);

  useEffect(() => {
    loadRequestCount();
  }, []);

  const loadRequestCount = async () => {
    try {
      const res = await contactApi.getReceivedRequests();
      if (res.code === 200) {
        setRequestCount((res.data || []).length);
      }
    } catch (e) {
      console.error('Failed to load request count:', e);
    }
  };

  const pullProps = usePullRefresh(async () => {
    const [friendsOk, onlineOk] = await Promise.all([refreshFriends(), refreshOnlineFriends()]);
    await loadRequestCount();
    return friendsOk && onlineOk;
  });

  const groupedFriends = friends.reduce<Record<string, typeof friends>>((acc, friend) => {
    const name = friend.nickname || friend.username || '';
    const firstChar = name.charAt(0)?.toUpperCase() || '#';
    if (!acc[firstChar]) acc[firstChar] = [];
    acc[firstChar].push(friend);
    return acc;
  }, {});

  const sortedKeys = Object.keys(groupedFriends).sort();

  const handleFriendClick = (friendId: string) => {
    navigate(`/contacts/${friendId}`);
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.title}>{t('tab.contacts')}</span>
        <div className={styles.addBtn} onClick={() => navigate('/contacts/search')}>
          <CirclePlus size={20} strokeWidth={1.8} />
        </div>
      </div>

      <div className={styles.body}>
        <PullToRefresh {...pullProps}>
        <div className={styles.searchBar} onClick={() => navigate('/contacts/search')}>
          <span className={styles.searchIcon}><Search size={16} strokeWidth={2} /></span>
          <span className={styles.searchPlaceholder}>{t('common.search')}</span>
        </div>

        <div className={styles.entries}>
          <div className={styles.entry} onClick={() => navigate('/contacts/requests')}>
            <div className={`${styles.entryIcon} ${styles.iconRequests}`}><Inbox size={22} strokeWidth={1.8} /></div>
            <span className={styles.entryText}>{t('contacts.newFriends')}</span>
            <Badge content={requestCount > 0 ? String(requestCount) : undefined} className={styles.entryBadge} />
          </div>
          <div className={styles.entry} onClick={() => navigate('/contacts/groups')}>
            <div className={`${styles.entryIcon} ${styles.iconGroups}`}><Users size={22} strokeWidth={1.8} /></div>
            <span className={styles.entryText}>{t('contacts.groups')}</span>
          </div>
          <div className={styles.entry} onClick={() => navigate('/contacts/search')}>
            <div className={`${styles.entryIcon} ${styles.iconAdd}`}><UserPlus size={22} strokeWidth={1.8} /></div>
            <span className={styles.entryText}>{t('contacts.addFriend')}</span>
          </div>
        </div>

        <div className={styles.friendSection}>
          {sortedKeys.map((key) => (
            <div key={key} className={styles.group}>
              <div className={styles.groupHeader}>{key}</div>
              {groupedFriends[key].map((friend) => {
                const isOnline = onlineUsers.has(String(friend.userId));
                const name = friend.nickname || friend.username || '';
                return (
                  <div
                    key={friend.userId}
                    className={styles.friend}
                    onClick={() => handleFriendClick(friend.userId)}
                  >
                    <div className={styles.avatarWrapper}>
                      <SharedAvatar name={name} src={friend.avatar} size={44} />
                      {isOnline && <div className={styles.onlineDot} />}
                    </div>
                    <div className={styles.friendInfo}>
                      <span className={styles.friendName}>{name}</span>
                      {friend.deleted && <span className={styles.deletedTag}>{t('settings.deletedUser')}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        </PullToRefresh>
      </div>
    </div>
  );
};

export default Contacts;
