import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { NavBar, Toast, Dialog, ImageViewer, Popup } from 'antd-mobile';
import { useTranslation } from 'react-i18next';
import { userApi, contactApi } from '../../../api';
import { resolveFileUrl } from '../../../utils/fileUrl';
import { useContactStore } from '../../../store/useContactStore';
import type { SearchUser } from '../../../types';
import SharedAvatar from '../../../components/SharedAvatar';
import styles from './index.module.css';

const FriendDetail = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { friendId } = useParams<{ friendId: string }>();
  const removeFriend = useContactStore((s) => s.removeFriend);
  const [user, setUser] = useState<SearchUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [showMenu, setShowMenu] = useState(false);

  useEffect(() => {
    loadUser();
  }, [friendId]);

  const loadUser = async () => {
    setLoading(true);
    try {
      const res = await userApi.getById(friendId!);
      if (res.code === 200 && res.data) {
        setUser(res.data);
      }
    } catch (e) {
      console.error('Failed to load user:', e);
    } finally {
      setLoading(false);
    }
  };

  const isSelfFriend = !!user?.isFriend;

  const handleRemoveFriend = async () => {
    const confirmed = await Dialog.confirm({
      content: t('contacts.confirmRemoveFriend'),
    });
    if (!confirmed) return;
    try {
      const res = await contactApi.removeFriend(user!.userId);
      if (res.code === 200) {
        removeFriend(user!.userId);
        Toast.show({ content: t('common.success') });
        navigate(-1);
      } else {
        Toast.show({ content: res.message || t('common.error') });
      }
    } catch (e) {
      Toast.show({ content: t('common.error') });
    }
  };

  const handleAddFriend = async () => {
    try {
      const res = await contactApi.sendRequest(user!.userId);
      if (res.code === 200) {
        Toast.show({ content: t('contacts.requestSent') });
        setUser({ ...user!, requestStatus: 1 });
      } else {
        Toast.show({ content: res.message || t('common.error') });
      }
    } catch (e) {
      Toast.show({ content: t('common.error') });
    }
  };

  const handleAvatarClick = () => {
    if (user?.avatar) {
      ImageViewer.show({ image: resolveFileUrl(user.avatar) });
    }
  };

  const handleMessage = () => {
    navigate(`/chat/${user!.userId}?type=0`);
  };

  const renderAction = () => {
    if (!user) return null;
    if (user.isFriend) {
      return (
        <div className={styles.actionBtn} onClick={handleMessage}>
          {t('contacts.sendMsg')}
        </div>
      );
    }
    if (user.requestStatus === 1) {
      return (
        <div className={`${styles.actionBtn} ${styles.disabled}`}>
          {t('contacts.requested')}
        </div>
      );
    }
    return (
      <div className={styles.actionBtn} onClick={handleAddFriend}>
        {t('contacts.add')}
      </div>
    );
  };

  return (
    <div className={styles.container}>
      <NavBar
        onBack={() => navigate(-1)}
        className={styles.navBar}
        right={<span className={styles.more} onClick={() => setShowMenu(true)}>...</span>}
      >
        {t('profile.myInfo')}
      </NavBar>

      <Popup
        visible={showMenu}
        onMaskClick={() => setShowMenu(false)}
        bodyStyle={{
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          padding: '8px 0 32px',
        }}
      >
        <div className={styles.menuItem} onClick={() => {
          setShowMenu(false);
          if (user) {
            navigate(`/select-target?action=recommend&userId=${user.userId}&nickname=${encodeURIComponent(user.nickname || user.username || '')}&avatar=${encodeURIComponent(user.avatar || '')}`);
          }
        }}>
          {t('contacts.sendToFriend')}
        </div>
        {isSelfFriend && (
          <div className={`${styles.menuItem} ${styles.dangerItem}`} onClick={() => {
            setShowMenu(false);
            handleRemoveFriend();
          }}>
            {t('contacts.confirmRemoveFriend').replace('确定要', '').replace('吗？', '')}
          </div>
        )}
        <div className={styles.menuItem} onClick={() => setShowMenu(false)}>
          {t('common.cancel')}
        </div>
      </Popup>

      {!loading && user && (
        <>
          <div className={styles.card}>
            <div onClick={handleAvatarClick} style={{ cursor: user?.avatar ? 'pointer' : 'default' }}>
              <SharedAvatar name={user.nickname || user.username} src={user.avatar} size={72} />
            </div>
            <div className={styles.nickname}>{user.nickname}</div>
            {user.signature && (
              <div className={styles.signature}>{user.signature}</div>
            )}
          </div>

          <div className={styles.infoList}>
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>{t('contacts.account')}</span>
              <span className={styles.infoValue}>{user.username}</span>
            </div>
          </div>

          <div className={styles.actions}>
            {renderAction()}
          </div>
        </>
      )}
    </div>
  );
};

export default FriendDetail;
