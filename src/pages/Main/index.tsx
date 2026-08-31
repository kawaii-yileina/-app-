import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { TabBar } from 'antd-mobile';
import { MessageOutline, UserOutline, SetOutline } from 'antd-mobile-icons';
import { useTranslation } from 'react-i18next';
import styles from './index.module.css';

const Main = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  const tabs = [
    { key: '/chat', title: t('tab.chats'), icon: <MessageOutline /> },
    { key: '/contacts', title: t('tab.contacts'), icon: <UserOutline /> },
    { key: '/profile', title: t('tab.profile'), icon: <SetOutline /> },
  ];

  const currentTab = tabs.find((t) => location.pathname.startsWith(t.key))?.key || '/chat';

  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <Outlet />
      </div>
      <div className={styles.tabBar}>
        <TabBar activeKey={currentTab} onChange={(key) => navigate(key)}>
          {tabs.map((tab) => (
            <TabBar.Item key={tab.key} icon={tab.icon} title={tab.title} />
          ))}
        </TabBar>
      </div>
    </div>
  );
};

export default Main;
