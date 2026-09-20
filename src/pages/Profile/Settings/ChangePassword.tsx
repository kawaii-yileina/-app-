import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { NavBar, Input, Button, Toast } from 'antd-mobile';
import { useTranslation } from 'react-i18next';
import { authApi } from '../../../api';
import { useAuthStore } from '../../../store/useAuthStore';
import styles from './security.module.css';

const ChangePassword = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!oldPassword || !newPassword) {
      Toast.show({ content: t('settings.pwdRequired') });
      return;
    }
    if (newPassword !== confirm) {
      Toast.show({ content: t('settings.pwdMismatch') });
      return;
    }
    setLoading(true);
    try {
      const res = await authApi.changePassword(oldPassword, newPassword);
      if (res.code === 200) {
        Toast.show({ content: t('settings.pwdChanged') });
        // 服务端已使全部 token 失效，本地登出并回到登录页
        useAuthStore.getState().logout();
        navigate('/login');
      } else {
        Toast.show({ content: res.message });
      }
    } catch (e: any) {
      Toast.show({ content: e?.response?.data?.message || t('common.networkError') });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <NavBar onBack={() => navigate(-1)} className={styles.navBar}>
        {t('settings.changePassword')}
      </NavBar>
      <div className={styles.body}>
        <p className={styles.hint}>{t('settings.changePasswordHint')}</p>
        <Input
          className={styles.field}
          type="password"
          placeholder={t('settings.oldPasswordPlaceholder')}
          value={oldPassword}
          onChange={setOldPassword}
        />
        <Input
          className={styles.field}
          type="password"
          placeholder={t('settings.newPasswordPlaceholder')}
          value={newPassword}
          onChange={setNewPassword}
        />
        <Input
          className={styles.field}
          type="password"
          placeholder={t('settings.confirmPasswordPlaceholder')}
          value={confirm}
          onChange={setConfirm}
        />
        <Button
          block
          color="primary"
          size="large"
          loading={loading}
          className={styles.button}
          onClick={handleSubmit}
        >
          {t('common.confirm')}
        </Button>
      </div>
    </div>
  );
};

export default ChangePassword;
