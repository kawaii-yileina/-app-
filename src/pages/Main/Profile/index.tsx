import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { List, Button, Dialog } from 'antd-mobile';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../../store/useAuthStore';
import { authApi, fileApi } from '../../../api';
import { resolveFileUrl } from '../../../utils/fileUrl';
import { RightOutline } from 'antd-mobile-icons';
import AvatarEditor from '../../../components/AvatarEditor';
import SharedAvatar from '../../../components/SharedAvatar';
import styles from './index.module.css';

const Profile = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const updateUser = useAuthStore((s) => s.updateUser);
  const [showEditor, setShowEditor] = useState(false);

  const displayName = user?.nickname || user?.username || '';

  const handleLogout = () => {
    Dialog.confirm({
      content: t('auth.logoutConfirm'),
      onConfirm: () => {
        logout();
        navigate('/login');
      },
    });
  };

  const handleAvatarUpload = async (file: File): Promise<string> => {
    const result = await fileApi.upload(file);
    const avatarUrl = result.url;
    const res = await authApi.updateProfile({ avatar: avatarUrl });
    if (res.code === 200) {
      updateUser({ avatar: res.data.avatar });
    }
    return avatarUrl;
  };

  return (
    <div className={styles.container}>
      <div className={styles.header} onClick={() => navigate('/profile/info')}>
        <div className={styles.avatar} onClick={(e) => { e.stopPropagation(); setShowEditor(true); }}>
          {user?.avatar ? (
            <img src={resolveFileUrl(user.avatar)} alt="avatar" className={styles.imgAvatar} />
          ) : (
            <SharedAvatar name={displayName} size={64} />
          )}
          <div className={styles.avatarEditHint}>{t('profile.changeAvatar')}</div>
        </div>
        <div className={styles.userInfo}>
          <div className={styles.nickname}>{user?.nickname}</div>
          {user?.signature && <div className={styles.signature}>{user.signature}</div>}
          <div className={styles.id}>{t('profile.account')}: {user?.username}</div>
        </div>
        <RightOutline className={styles.arrow} />
      </div>

      <List className={styles.list}>
        <List.Item
          prefix={<span style={{ fontSize: 20 }}> </span>}
          onClick={() => navigate('/profile/info')}
          extra={<RightOutline />}
        >
          {t('profile.myInfo')}
        </List.Item>
        <List.Item
          prefix={<span style={{ fontSize: 20 }}> </span>}
          onClick={() => navigate('/profile/ai')}
          extra={<RightOutline />}
        >
          {t('profile.aiSettings')}
        </List.Item>
        <List.Item
          prefix={<span style={{ fontSize: 20 }}> </span>}
          onClick={() => navigate('/profile/settings')}
          extra={<RightOutline />}
        >
          {t('profile.settings')}
        </List.Item>
      </List>

      <Button
        block
        color="danger"
        size="large"
        onClick={handleLogout}
        className={styles.logoutButton}
      >
        {t('profile.logout')}
      </Button>

      <AvatarEditor
        visible={showEditor}
        onClose={() => setShowEditor(false)}
        onUpload={handleAvatarUpload}
      />
    </div>
  );
};

export default Profile;
