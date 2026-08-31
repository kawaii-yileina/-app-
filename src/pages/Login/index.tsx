import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input, Toast } from 'antd-mobile';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../store/useAuthStore';
import { authApi } from '../../api';
import styles from './index.module.css';

const Login = () => {
  const { t } = useTranslation();
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);

  const handleSubmit = async () => {
    if (!username || !password) {
      Toast.show({ content: t('auth.inputRequired') });
      return;
    }

    setLoading(true);
    try {
      const res = isLogin
        ? await authApi.login(username, password)
        : await authApi.register(username, password, nickname);

      if (res.code === 200) {
        setAuth(res.data.token, {
          userId: res.data.userId,
          username,
          nickname: res.data.nickname,
          avatar: res.data.avatar || '',
          signature: '',
        });
        Toast.show({ content: isLogin ? t('auth.loginSuccess') : t('auth.registerSuccess') });
        navigate('/');
      } else {
        Toast.show({ content: res.message });
      }
    } catch (e) {
      Toast.show({ content: t('common.networkError') });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>{t('auth.title')}</h1>
        <p className={styles.subtitle}>{isLogin ? t('auth.login') : t('auth.register')}</p>
      </div>

      <div className={styles.form}>
        <Input
          placeholder={t('auth.usernamePlaceholder')}
          value={username}
          onChange={setUsername}
          className={styles.input}
        />
        <Input
          placeholder={t('auth.passwordPlaceholder')}
          type="password"
          value={password}
          onChange={setPassword}
          className={styles.input}
        />
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
          <span onClick={() => setIsLogin(!isLogin)}>
            {isLogin ? t('auth.noAccount') : t('auth.hasAccount')}
          </span>
        </div>
      </div>
    </div>
  );
};

export default Login;
