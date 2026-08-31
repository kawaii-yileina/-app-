import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { NavBar, Toast, Dialog, Input } from 'antd-mobile';
import { useTranslation } from 'react-i18next';
import { contactApi } from '../../../api';
import { useContactStore } from '../../../store/useContactStore';
import type { Group } from '../../../types';
import styles from './index.module.css';

const Groups = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const groups = useContactStore((s) => s.groups);
  const setGroups = useContactStore((s) => s.setGroups);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [groupName, setGroupName] = useState('');

  const handleCreateGroup = async () => {
    if (!groupName.trim()) {
      Toast.show({ content: t('contacts.groupNamePlaceholder') });
      return;
    }
    try {
      const res = await contactApi.createGroup(groupName.trim());
      if (res.code === 200) {
        Toast.show({ content: t('common.success') });
        setGroups([...groups, res.data]);
        setShowCreateDialog(false);
        setGroupName('');
        navigate(`/chat/${res.data.id}?type=1`);
      } else {
        Toast.show({ content: res.message || t('common.error') });
      }
    } catch (e) {
      Toast.show({ content: t('common.error') });
    }
  };

  const handleGroupClick = (group: Group) => {
    navigate(`/chat/${group.id}?type=1`);
  };

  return (
    <div className={styles.container}>
      <NavBar onBack={() => navigate(-1)} className={styles.navBar}>
        {t('contacts.groups')}
      </NavBar>

      <div className={styles.createRow} onClick={() => setShowCreateDialog(true)}>
        <div className={styles.createIcon}>＋</div>
        <span className={styles.createText}>{t('contacts.createGroup')}</span>
      </div>

      <div className={styles.list}>
        {groups.length === 0 ? (
          <div className={styles.empty}>{t('contacts.noGroups')}</div>
        ) : (
          groups.map((group) => (
            <div key={group.id} className={styles.item} onClick={() => handleGroupClick(group)}>
              <div className={styles.avatar}>{group.name?.charAt(0)}</div>
              <div className={styles.info}>
                <span className={styles.name}>{group.name}</span>
              </div>
            </div>
          ))
        )}
      </div>

      <Dialog
        visible={showCreateDialog}
        title={t('contacts.createGroup')}
        content={
          <div className={styles.dialogContent}>
            <Input
              placeholder={t('contacts.groupNamePlaceholder')}
              value={groupName}
              onChange={setGroupName}
              className={styles.dialogInput}
              clearable
            />
          </div>
        }
        actions={[
          { key: 'cancel', text: t('common.cancel'), onClick: () => setShowCreateDialog(false) },
          { key: 'confirm', text: t('common.confirm'), bold: true, onClick: handleCreateGroup },
        ]}
      />
    </div>
  );
};

export default Groups;
