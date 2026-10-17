import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input, Toast } from 'antd-mobile';
import { useTranslation } from 'react-i18next';
import { authApi } from '../../api';
import styles from './index.module.css';

const ResetPassword = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [sendLoading, setSendLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const handleSendCode = async () => {
    if (countdown > 0 || sendLoading) return;
    if (!email.trim()) {
      Toast.show({ content: t('auth.emailRequired') });
      return;
    }
    setSendLoading(true);
    try {
      const res = await authApi.sendCode(email.trim(), 'reset_password');
      if (res.code === 200) {
        setCountdown(60);
        Toast.show({ content: t('auth.codeSent') });
      } else {
        Toast.show({ content: res.message });
      }
    } catch (e: any) {
      Toast.show({ content: e?.response?.data?.message || t('common.networkError') });
    } finally {
      setSendLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!email.trim() || !code || !newPassword) {
      Toast.show({ content: t('auth.resetRequired') });
      return;
    }
    setLoading(true);
    try {
      const res = await authApi.resetPassword(email.trim(), code, newPassword);
      if (res.code === 200) {
        Toast.show({ content: t('auth.resetSuccess') });
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
      <div className={styles.header}>
        <div className={styles.logo}>IM</div>
        <h1 className={styles.title}>{t('auth.resetPassword')}</h1>
        <p className={styles.subtitle}>{t('auth.resetSubtitle')}</p>
      </div>

      <div className={styles.form}>
        <div className={styles.fieldRow}>
          <Input
            placeholder={t('auth.emailPlaceholder')}
            type="email"
            value={email}
            onChange={setEmail}
            className={styles.fieldRowInput}
          />
          <span className={styles.fieldDivider} />
          <button
            type="button"
            className={`${styles.codeBtn} ${countdown > 0 || sendLoading ? styles.codeBtnOff : ''}`}
            disabled={countdown > 0 || sendLoading}
            onClick={handleSendCode}
          >
            {sendLoading ? '···' : countdown > 0 ? `${countdown}s` : t('auth.sendCode')}
          </button>
        </div>

        <Input
          placeholder={t('auth.codePlaceholder')}
          value={code}
          onChange={setCode}
          className={styles.input}
        />

        <Input
          placeholder={t('auth.newPasswordPlaceholder')}
          type="password"
          value={newPassword}
          onChange={setNewPassword}
          className={styles.input}
        />

        <Button
          block
          color="primary"
          size="large"
          loading={loading}
          onClick={handleSubmit}
          className={styles.button}
        >
          {t('auth.resetPassword')}
        </Button>

        <div className={styles.link} onClick={() => navigate('/login')}>
          {t('auth.backToLogin')}
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;
