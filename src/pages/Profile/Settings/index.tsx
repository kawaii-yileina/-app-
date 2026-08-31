import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { NavBar, List } from 'antd-mobile';
import { useTranslation } from 'react-i18next';
import styles from './index.module.css';

const Settings = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [language, setLanguage] = useState(i18n.language || 'zh');
  const [darkMode, setDarkMode] = useState(() => {
    return localStorage.getItem('theme') === 'dark';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.setAttribute('data-theme', 'dark');
      localStorage.setItem('theme', 'dark');
    } else {
      root.removeAttribute('data-theme');
      localStorage.setItem('theme', 'light');
    }
  }, [darkMode]);

  const handleLanguageChange = () => {
    const next = language === 'zh' ? 'en' : 'zh';
    setLanguage(next);
    i18n.changeLanguage(next);
    localStorage.setItem('language', next);
  };

  return (
    <div className={styles.container}>
      <NavBar onBack={() => navigate(-1)} className={styles.navBar}>
        {t('settings.title')}
      </NavBar>

      <List className={styles.list}>
        <List.Item
          extra={language === 'zh' ? '中文' : 'English'}
          onClick={handleLanguageChange}
        >
          {t('settings.language')}
        </List.Item>
        <List.Item
          extra={
            <div
              className={`${styles.toggle} ${darkMode ? styles.toggleOn : ''}`}
              onClick={(e) => { e.stopPropagation(); setDarkMode(!darkMode); }}
            >
              <div className={styles.toggleKnob} />
            </div>
          }
        >
          {t('settings.darkMode')}
        </List.Item>
      </List>

      <List className={styles.list}>
        <List.Item extra="1.0.0">
          {t('settings.version')}
        </List.Item>
        <List.Item>
          {t('settings.appName')}
        </List.Item>
      </List>
    </div>
  );
};

export default Settings;
