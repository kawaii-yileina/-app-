import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { NavBar, Input, Button, Toast, Dialog } from 'antd-mobile';
import { useTranslation } from 'react-i18next';
import { authApi } from '../../../api';
import { useAuthStore } from '../../../store/useAuthStore';
import styles from './security.module.css';

const DeleteAccount = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = () => {
    if (!password) {
      Toast.show({ content: t('settings.deletePasswordRequired') });
      return;
    }
    Dialog.confirm({
      content: t('settings.deleteConfirm'),
      confirmText: t('settings.deleteAccount'),
      onConfirm: async () => {
        setLoading(true);
        try {
          const res = await authApi.deleteAccount(password);
          if (res.code === 200) {
            Toast.show({ content: t('settings.deleteSuccess') });
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
      },
    });
  };

  return (
    <div className={styles.container}>
      <NavBar onBack={() => navigate(-1)} className={styles.navBar}>
        {t('settings.deleteAccount')}
      </NavBar>
      <div className={styles.body}>
        <p className={`${styles.hint} ${styles.dangerHint}`}>{t('settings.deleteWarning')}</p>
        <Input
          className={styles.field}
          type="password"
          placeholder={t('settings.deletePasswordPlaceholder')}
          value={password}
          onChange={setPassword}
        />
        <Button
          block
          color="danger"
          size="large"
          loading={loading}
          className={styles.button}
          onClick={handleSubmit}
        >
          {t('settings.deleteAccount')}
        </Button>
      </div>
    </div>
  );
};

export default DeleteAccount;
