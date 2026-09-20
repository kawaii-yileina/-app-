import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { NavBar, Toast } from 'antd-mobile';
import { useTranslation } from 'react-i18next';
import { contactApi } from '../../../api';
import { useContactStore } from '../../../store/useContactStore';
import { avatarTint } from '../../../utils/avatarColor';
import type { FriendRequestItem } from '../../../types';
import styles from './index.module.css';

const FriendRequests = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [received, setReceived] = useState<FriendRequestItem[]>([]);
  const [sent, setSent] = useState<FriendRequestItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadRequests();
  }, []);

  const loadRequests = async () => {
    setLoading(true);
    try {
      const [recvRes, sentRes] = await Promise.all([
        contactApi.getReceivedRequests(),
        contactApi.getSentRequests(),
      ]);
      if (recvRes.code === 200) setReceived(recvRes.data || []);
      if (sentRes.code === 200) setSent(sentRes.data || []);
    } catch (e) {
      console.error('Failed to load requests:', e);
    } finally {
      setLoading(false);
    }
  };

  /** 接受后刷新好友列表：接受方自身的好友列表此时还不含新好友，需主动拉取一次 */
  const refreshFriends = async () => {
    try {
      const res = await contactApi.getFriends();
      if (res.code === 200) useContactStore.getState().setFriends(res.data || []);
    } catch (e) {
      console.error('Failed to refresh friends:', e);
    }
  };

  const handleAccept = async (id: string) => {
    try {
      const res = await contactApi.acceptRequest(id);
      if (res.code === 200) {
        Toast.show({ content: t('common.success') });
        loadRequests();
        refreshFriends();
      } else {
        Toast.show({ content: res.message || t('common.error') });
      }
    } catch (e) {
      Toast.show({ content: t('common.error') });
    }
  };

  const handleReject = async (id: string) => {
    try {
      const res = await contactApi.rejectRequest(id);
      if (res.code === 200) {
        Toast.show({ content: t('common.success') });
        loadRequests();
      } else {
        Toast.show({ content: res.message || t('common.error') });
      }
    } catch (e) {
      Toast.show({ content: t('common.error') });
    }
  };

  return (
    <div className={styles.container}>
      <NavBar
        onBack={() => navigate(-1)}
        className={styles.navBar}
        right={<span className={styles.addText} onClick={() => navigate('/contacts/search')}>{t('contacts.addFriend')}</span>}
      >
        {t('contacts.newFriends')}
      </NavBar>

      <div className={styles.list}>
        {received.length === 0 && sent.length === 0 && !loading && (
          <div className={styles.empty}>暂无好友申请</div>
        )}

        {received.length > 0 && (
          <>
            <div className={styles.sectionTitle}>{t('contacts.received')}</div>
            {received.map((r) => (
              <div key={r.id} className={styles.item}>
                <div className={styles.avatar} style={{ background: avatarTint(r.nickname || '') }}>{r.nickname?.charAt(0)}</div>
                <div className={styles.info}>
                  <div className={styles.name}>{r.nickname}</div>
                  <div className={styles.sub}>{t('contacts.requestAdd')}</div>
                </div>
                <div className={styles.actions}>
                  <span className={`${styles.btn} ${styles.reject}`} onClick={() => handleReject(r.id)}>
                    {t('contacts.reject')}
                  </span>
                  <span className={`${styles.btn} ${styles.accept}`} onClick={() => handleAccept(r.id)}>
                    {t('contacts.accept')}
                  </span>
                </div>
              </div>
            ))}
          </>
        )}

        {sent.length > 0 && (
          <>
            <div className={styles.sectionTitle}>{t('contacts.sent')}</div>
            {sent.map((r) => (
              <div key={r.id} className={styles.item}>
                <div className={styles.avatar} style={{ background: avatarTint(r.nickname || '') }}>{r.nickname?.charAt(0)}</div>
                <div className={styles.info}>
                  <div className={styles.name}>{r.nickname}</div>
                </div>
                <div className={styles.waiting}>{t('contacts.requested')}</div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
};

export default FriendRequests;
