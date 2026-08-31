import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { NavBar, Toast, Dialog, Popup } from 'antd-mobile';
import { useTranslation } from 'react-i18next';
import { contactApi } from '../../../api';
import { useAuthStore } from '../../../store/useAuthStore';
import type { Group, GroupMember } from '../../../types';
import styles from './index.module.css';

const GroupDetail = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { groupId } = useParams<{ groupId: string }>();
  const user = useAuthStore((s) => s.user);
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [friends, setFriends] = useState<GroupMember[]>([]);

  useEffect(() => {
    loadGroup();
  }, [groupId]);

  const loadGroup = async () => {
    try {
      const [gRes, mRes] = await Promise.all([
        contactApi.getGroup(groupId!),
        contactApi.getGroupMembers(groupId!),
      ]);
      if (gRes.code === 200) setGroup(gRes.data);
      if (mRes.code === 200) setMembers(mRes.data || []);
    } catch (e) {
      console.error('Failed to load group:', e);
    }
  };

  const loadAddCandidates = async () => {
    setShowAdd(true);
    try {
      const res = await contactApi.getFriends();
      if (res.code === 200) {
        const memberIds = new Set(members.map((m) => m.userId));
        setFriends(
          res.data.map((f) => ({
            userId: f.userId,
            username: f.username,
            nickname: f.nickname,
            avatar: f.avatar,
            role: 0,
            joinedAt: '',
          })).filter((f) => !memberIds.has(f.userId))
        );
      }
    } catch (e) {
      console.error('Load friends failed:', e);
    }
  };

  const handleAddMember = async (member: GroupMember) => {
    try {
      const res = await contactApi.addGroupMember(groupId!, member.userId);
      if (res.code === 200) {
        Toast.show({ content: t('common.success') });
        setShowAdd(false);
        loadGroup();
      } else {
        Toast.show({ content: res.message || t('common.error') });
      }
    } catch (e) {
      Toast.show({ content: t('common.error') });
    }
  };

  const handleRemoveMember = async (member: GroupMember) => {
    if (member.role === 2) {
      Toast.show({ content: t('contacts.cannotRemoveOwner') });
      return;
    }
    const confirmed = await Dialog.confirm({
      content: t('contacts.confirmRemove'),
    });
    if (!confirmed) return;
    try {
      const res = await contactApi.removeGroupMember(groupId!, member.userId);
      if (res.code === 200) {
        Toast.show({ content: t('common.success') });
        loadGroup();
      } else {
        Toast.show({ content: res.message || t('common.error') });
      }
    } catch (e) {
      Toast.show({ content: t('common.error') });
    }
  };

  const handleRename = () => {
    let newName = '';
    Dialog.confirm({
      title: t('contacts.renameGroup'),
      content: (
        <input
          className={styles.renameInput}
          defaultValue={group?.name}
          onChange={(e) => (newName = e.target.value)}
        />
      ),
      onConfirm: async () => {
        if (!newName.trim()) return;
        const res = await contactApi.updateGroup(groupId!, newName.trim());
        if (res.code === 200) {
          Toast.show({ content: t('common.success') });
          loadGroup();
        } else {
          Toast.show({ content: res.message || t('common.error') });
        }
      },
    });
  };

  const handleTransfer = async () => {
    const candidate = members.find((m) => m.role !== 2 && m.userId !== user?.userId);
    if (!candidate) {
      Toast.show({ content: t('contacts.noMemberToTransfer') });
      return;
    }
    const confirmed = await Dialog.confirm({
      content: `${t('contacts.transferTo')} "${candidate.nickname}"?`,
    });
    if (!confirmed) return;
    try {
      const res = await contactApi.transferGroupOwner(groupId!, candidate.userId);
      if (res.code === 200) {
        Toast.show({ content: t('common.success') });
        loadGroup();
      } else {
        Toast.show({ content: res.message || t('common.error') });
      }
    } catch (e) {
      Toast.show({ content: t('common.error') });
    }
  };

  const handleQuit = async () => {
    const confirmed = await Dialog.confirm({
      content: t('contacts.confirmQuit'),
    });
    if (!confirmed) return;
    try {
      const res = await contactApi.quitGroup(groupId!);
      if (res.code === 200) {
        Toast.show({ content: t('common.success') });
        navigate('/contacts/groups');
      } else {
        Toast.show({ content: res.message || t('common.error') });
      }
    } catch (e) {
      Toast.show({ content: t('common.error') });
    }
  };

  const isOwner = group?.ownerId === user?.userId;

  return (
    <div className={styles.container}>
      <NavBar onBack={() => navigate(-1)} className={styles.navBar}>
        {t('contacts.groupDetail')}
      </NavBar>

      {group && (
        <>
          <div className={styles.card}>
            <div className={styles.avatar}>{group.name?.charAt(0)}</div>
            <div className={styles.groupName}>{group.name}</div>
            <div className={styles.memberCount}>{members.length} {t('contacts.members')}</div>
          </div>

          <div className={styles.memberSection}>
            <div className={styles.gridHeader}>{t('contacts.groupMembers')}</div>
            <div className={styles.grid}>
              <div className={styles.cell} onClick={loadAddCandidates}>
                <div className={`${styles.avatar} ${styles.addAvatar}`}>＋</div>
                <span className={styles.cellName}>{t('contacts.addMember')}</span>
              </div>
              {members.map((m) => (
                <div key={m.userId} className={styles.cell} onClick={() => handleRemoveMember(m)}>
                  <div className={styles.avatar}>
                    {m.nickname?.charAt(0)}
                    {m.role === 2 && <div className={styles.ownerTag} />}
                  </div>
                  <span className={styles.cellName}>{m.nickname}</span>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.menu}>
            {isOwner && (
              <>
                <div className={styles.menuItem} onClick={handleRename}>
                  <span>{t('contacts.renameGroup')}</span>
                </div>
                <div className={styles.menuItem} onClick={handleTransfer}>
                  <span>{t('contacts.transferOwner')}</span>
                </div>
              </>
            )}
            <div className={styles.menuItem} onClick={() => navigate(`/chat/${group.id}?type=1`)}>
              <span>{t('contacts.enterGroup')}</span>
            </div>
          </div>

          <div className={styles.quit} onClick={handleQuit}>
            {t('contacts.quitGroup')}
          </div>
        </>
      )}

      <Popup visible={showAdd} onMaskClick={() => setShowAdd(false)} position="bottom">
        <div className={styles.addPopup}>
          <div className={styles.popupTitle}>{t('contacts.addMember')}</div>
          {friends.length === 0 ? (
            <div className={styles.popupEmpty}>{t('contacts.noFriendToAdd')}</div>
          ) : (
            friends.map((f) => (
              <div key={f.userId} className={styles.popupItem} onClick={() => handleAddMember(f)}>
                <div className={styles.avatar}>{f.nickname?.charAt(0)}</div>
                <span className={styles.popupName}>{f.nickname}</span>
              </div>
            ))
          )}
        </div>
      </Popup>
    </div>
  );
};

export default GroupDetail;
