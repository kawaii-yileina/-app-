import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input, Toast } from 'antd-mobile';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../store/useAuthStore';
import { authApi } from '../../api';
import styles from './index.module.css';

type LoginMethod = 'password' | 'code';

const Login = () => {
  const { t } = useTranslation();
  const [isLogin, setIsLogin] = useState(true);
  const [loginMethod, setLoginMethod] = useState<LoginMethod>('password');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [sendLoading, setSendLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const switchMode = (login: boolean) => {
    setIsLogin(login);
    setLoginMethod('password');
  };

  const handleSendCode = async (scene: 'register' | 'login' | 'reset_password') => {
    if (countdown > 0 || sendLoading) return;
    if (!email.trim()) {
      Toast.show({ content: t('auth.emailRequired') });
      return;
    }
    setSendLoading(true);
    try {
      const res = await authApi.sendCode(email.trim(), scene);
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
    setLoading(true);
    try {
      let res;
      if (!isLogin) {
        if (!username || !password || !email.trim() || !code) {
          Toast.show({ content: t('auth.registerRequired') });
          return;
        }
        res = await authApi.register(username, password, nickname, email.trim(), code);
      } else if (loginMethod === 'password') {
        if (!username || !password) {
          Toast.show({ content: t('auth.inputRequired') });
          return;
        }
        res = await authApi.login(username, password);
      } else {
        if (!email.trim() || !code) {
          Toast.show({ content: t('auth.codeLoginRequired') });
          return;
        }
        res = await authApi.loginByCode(email.trim(), code);
      }

      if (res.code === 200) {
        setAuth(res.data.token, res.data.refreshToken, {
          userId: res.data.userId,
          username: res.data.username || username || email,
          nickname: res.data.nickname,
          avatar: res.data.avatar || '',
          signature: '',
        });
        Toast.show({ content: isLogin ? t('auth.loginSuccess') : t('auth.registerSuccess') });
        navigate('/');
      } else {
        Toast.show({ content: res.message });
      }
    } catch (e: any) {
      Toast.show({ content: e?.response?.data?.message || t('common.networkError') });
    } finally {
      setLoading(false);
    }
  };

  const showCodeField = !isLogin || loginMethod === 'code';
  const codeScene: 'register' | 'login' = isLogin ? 'login' : 'register';

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.logo}>M</div>
        <h1 className={styles.title}>{t('auth.title')}</h1>
        <p className={styles.subtitle}>{isLogin ? t('auth.login') : t('auth.register')}</p>
      </div>

      <div className={styles.form}>
        {isLogin && (
          <div className={styles.segment}>
            <div
              className={`${styles.segmentItem} ${loginMethod === 'password' ? styles.segmentActive : ''}`}
              onClick={() => setLoginMethod('password')}
            >
              {t('auth.passwordLogin')}
            </div>
            <div
              className={`${styles.segmentItem} ${loginMethod === 'code' ? styles.segmentActive : ''}`}
              onClick={() => setLoginMethod('code')}
            >
              {t('auth.codeLogin')}
            </div>
          </div>
        )}

        {(!isLogin || loginMethod === 'password') && (
          <Input
            placeholder={t('auth.usernamePlaceholder')}
            value={username}
            onChange={setUsername}
            className={styles.input}
          />
        )}

        {showCodeField && (
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
              onClick={() => handleSendCode(codeScene)}
            >
              {sendLoading ? '···' : countdown > 0 ? `${countdown}s` : t('auth.sendCode')}
            </button>
          </div>
        )}

        {showCodeField && (
          <Input
            placeholder={t('auth.codePlaceholder')}
            value={code}
            onChange={setCode}
            className={styles.input}
          />
        )}

        {(!isLogin || loginMethod === 'password') && (
          <Input
            placeholder={t('auth.passwordPlaceholder')}
            type="password"
            value={password}
            onChange={setPassword}
            className={styles.input}
          />
        )}

        {!isLogin && (
          <Input
            placeholder={t('auth.nicknamePlaceholder')}
            value={nickname}
            onChange={setNickname}
            className={styles.input}
          />
        )}

        <Button
          block
          color="primary"
          size="large"
          loading={loading}
          onClick={handleSubmit}
          className={styles.button}
        >
          {isLogin ? t('auth.login') : t('auth.register')}
        </Button>

        <div className={styles.switch}>
          <span onClick={() => switchMode(!isLogin)}>
            {isLogin ? t('auth.noAccount') : t('auth.hasAccount')}
          </span>
        </div>
        {isLogin && (
          <div className={styles.link} onClick={() => navigate('/reset-password')}>
            {t('auth.forgotPassword')}
          </div>
        )}
      </div>
    </div>
  );
};

export default Login;
