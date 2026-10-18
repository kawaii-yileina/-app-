import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ActionSheet, Dialog, NavBar, Popup, SpinLoading, Toast } from 'antd-mobile';
import { ChevronRight, Crown, ShieldCheck, UserPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { contactApi } from '../../../api';
import { useAuthStore } from '../../../store/useAuthStore';
import GroupAvatar from '../../../components/GroupAvatar';
import { avatarTint } from '../../../utils/avatarColor';
import { useBackGuard } from '../../../hooks/useBackGuard';
import type { Group, GroupMember } from '../../../types';
import styles from './index.module.css';

const RoleBadge = ({ role }: { role: number }) => {
  const { t } = useTranslation();
  if (role === 2) {
    return (
      <span className={`${styles.roleBadge} ${styles.ownerBadge}`}>
        <Crown size={10} strokeWidth={1.8} />
        {t('contacts.ownerBadge')}
      </span>
    );
  }
  if (role === 1) {
    return (
      <span className={`${styles.roleBadge} ${styles.adminBadge}`}>
        <ShieldCheck size={10} strokeWidth={1.8} />
        {t('contacts.adminBadge')}
      </span>
    );
  }
  return null;
};

const GroupDetail = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { groupId } = useParams<{ groupId: string }>();
  const user = useAuthStore((s) => s.user);
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [sheet, setSheet] = useState<{
    visible: boolean;
    actions: { key: string; text: string; danger?: boolean; onClick: () => void }[];
  }>({ visible: false, actions: [] });
  const [friends, setFriends] = useState<GroupMember[]>([]);

  const me = String(user?.userId || '');
  const myRole = members.find((m) => m.userId === me)?.role ?? 0;
  const isOwner = Boolean(group && String(group.ownerId) === me);
  const canManage = isOwner || myRole === 1;
  const visibleMembers = members.slice(0, 10);
  const hasMore = members.length > visibleMembers.length;

  useEffect(() => {
    loadGroup();
  }, [groupId]);

  useEffect(() => {
    const onGroupChanged = (event: Event) => {
      const changedGroupId = (event as CustomEvent<{ groupId?: string }>).detail?.groupId;
      if (!changedGroupId || String(changedGroupId) === String(groupId)) {
        loadGroup();
      }
    };
    window.addEventListener('group:changed', onGroupChanged);
    return () => window.removeEventListener('group:changed', onGroupChanged);
  }, [groupId]);

  useBackGuard(showAdd || showMembers || sheet.visible, () => {
    setShowAdd(false);
    setShowMembers(false);
    setSheet({ visible: false, actions: [] });
  });

  const closeSheet = () => setSheet({ visible: false, actions: [] });

  const loadGroup = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [gRes, mRes] = await Promise.all([
        contactApi.getGroup(groupId!),
        contactApi.getGroupMembers(groupId!),
      ]);
      if (gRes.code === 200) {
        setGroup(gRes.data);
      } else {
        setLoadError(true);
        Toast.show({ content: errorMessage(gRes.message) });
      }
      if (mRes.code === 200) {
        setMembers(mRes.data || []);
      } else {
        setLoadError(true);
        Toast.show({ content: errorMessage(mRes.message) });
      }
    } catch (e) {
      console.error('Failed to load group:', e);
      setLoadError(true);
      Toast.show({ content: t('common.error') });
    } finally {
      setLoading(false);
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

  const errorMessage = (message?: string) => {
    switch (message) {
      case 'Admin limit reached': return t('contacts.adminLimitReached');
      case 'Cannot remove group owner': return t('contacts.cannotRemoveOwner');
      case 'Group owner cannot be set as admin': return t('contacts.cannotSetOwnerAdmin');
      case 'Member is not an admin': return t('contacts.memberNotAdmin');
      case 'Cannot transfer ownership to yourself': return t('contacts.cannotTransferSelf');
      case 'newOwnerId is required': return t('contacts.newOwnerRequired');
      case 'New owner is not a member': return t('contacts.newOwnerNotMember');
      case 'User is already a member of this group': return t('contacts.alreadyMember');
      case 'Group not found': return t('contacts.groupNotFound');
      case 'Member not found': return t('contacts.memberNotFound');
      default:
        if (message?.includes('permission') || message?.includes('Only group owner')) {
          return t('contacts.noPermission');
        }
        return message || t('common.error');
    }
  };

  const execute = async (
    request: () => Promise<{ code: number; message?: string }>,
    onSuccess?: () => void | Promise<void>,
  ) => {
    Toast.show({ icon: 'loading', content: t('common.loading') });
    try {
      const res = await request();
      Toast.clear();
      if (res.code === 200) {
        Toast.show({ content: t('common.success') });
        await onSuccess?.();
        await loadGroup();
      } else {
        Toast.show({ content: errorMessage(res.message) });
      }
    } catch {
      Toast.clear();
      Toast.show({ content: t('common.error') });
    }
  };

  const handleAddMember = (member: GroupMember) =>
    execute(
      () => contactApi.addGroupMember(groupId!, member.userId),
      () => setShowAdd(false),
    );

  const canRemove = (member: GroupMember) =>
    member.role !== 2
    && member.userId !== me
    && (isOwner || (myRole === 1 && member.role === 0));

  const handleSetAdmin = (member: GroupMember) =>
    execute(() => contactApi.setGroupAdmin(groupId!, member.userId));

  const handleUnsetAdmin = (member: GroupMember) =>
    execute(() => contactApi.unsetGroupAdmin(groupId!, member.userId));

  const handleRemoveMember = async (member: GroupMember) => {
    const confirmed = await Dialog.confirm({ content: t('contacts.confirmRemove') });
    if (!confirmed) return;
    await execute(() => contactApi.removeGroupMember(groupId!, member.userId));
  };

  const handleTransferTo = async (member: GroupMember) => {
    const confirmed = await Dialog.confirm({ content: t('contacts.confirmTransfer') });
    if (!confirmed) return;
    await execute(() => contactApi.transferGroupOwner(groupId!, member.userId));
  };

  const openMemberActions = (member: GroupMember) => {
    if (member.userId === me) {
      if (!isOwner) {
        setSheet({
          visible: true,
          actions: [{
            key: 'quit',
            text: t('contacts.quitGroup'),
            danger: true,
            onClick: handleQuit,
          }],
        });
      } else {
        Toast.show({ content: t('contacts.thisIsYou') });
      }
      return;
    }

    const actions: { key: string; text: string; danger?: boolean; onClick: () => void }[] = [];
    if (isOwner && member.role === 0) {
      actions.push({ key: 'setAdmin', text: t('contacts.setAdmin'), onClick: () => handleSetAdmin(member) });
    }
    if (isOwner && member.role === 1) {
      actions.push({ key: 'unsetAdmin', text: t('contacts.unsetAdmin'), onClick: () => handleUnsetAdmin(member) });
    }
    if (isOwner && member.role !== 2) {
      actions.push({ key: 'transfer', text: t('contacts.transferOwner'), onClick: () => handleTransferTo(member) });
    }
    if (canRemove(member)) {
      actions.push({ key: 'remove', text: t('contacts.removeMember'), danger: true, onClick: () => handleRemoveMember(member) });
    }

    if (actions.length === 0) {
      Toast.show({ content: t('contacts.noPermission') });
      return;
    }
    setSheet({ visible: true, actions });
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
        if (!newName.trim()) {
          Toast.show({ content: t('contacts.groupNamePlaceholder') });
          return;
        }
        await execute(() => contactApi.updateGroup(groupId!, newName.trim()));
      },
    });
  };

  const handleTransfer = () => {
    const candidates = members.filter((m) => m.role !== 2 && m.userId !== me);
    if (candidates.length === 0) {
      Toast.show({ content: t('contacts.noMemberToTransfer') });
      return;
    }
    setSheet({
      visible: true,
      actions: candidates.map((m) => ({
        key: m.userId,
        text: m.nickname,
        onClick: () => handleTransferTo(m),
      })),
    });
  };

  const handleQuit = async () => {
    const confirmed = await Dialog.confirm({ content: t('contacts.confirmQuit') });
    if (!confirmed) return;
    Toast.show({ icon: 'loading', content: t('common.loading') });
    try {
      const res = await contactApi.quitGroup(groupId!);
      Toast.clear();
      if (res.code === 200) {
        Toast.show({ content: t('common.success') });
        navigate('/contacts/groups');
      } else {
        Toast.show({ content: errorMessage(res.message) });
      }
    } catch {
      Toast.clear();
      Toast.show({ content: t('common.error') });
    }
  };

  return (
    <div className={styles.container}>
      <NavBar onBack={() => navigate(-1)} className={styles.navBar}>
        {t('contacts.groupDetail')}
      </NavBar>

      {loading && !group && (
        <div className={styles.loading}><SpinLoading color="primary" /></div>
      )}

      {!loading && loadError && !group && (
        <div className={styles.loadError}>
          <span>{t('common.error')}</span>
          <button className={styles.retryButton} onClick={loadGroup}>{t('common.retry')}</button>
        </div>
      )}

      {group && (
        <>
          <div className={styles.card}>
            <GroupAvatar
              name={group.name}
              avatar={group.avatar}
              members={group.memberAvatars?.length ? group.memberAvatars : members.slice(0, 9).map((m) => ({ nickname: m.nickname, avatar: m.avatar }))}
              size={72}
            />
            <div className={styles.groupName}>{group.name}</div>
            <div className={styles.memberCount}>{members.length} {t('contacts.members')}</div>
            {myRole > 0 && <RoleBadge role={myRole} />}
          </div>

          {loadError && (
            <div className={styles.inlineError}>
              <span>{t('common.error')}</span>
              <button className={styles.retryButton} onClick={loadGroup}>{t('common.retry')}</button>
            </div>
          )}

          <div className={styles.memberSection}>
            <div className={styles.sectionHeader}>
              <span>{t('contacts.groupMembers')}</span>
              {hasMore && (
                <button className={styles.textButton} onClick={() => setShowMembers(true)}>
                  {t('contacts.viewAllMembers')}
                  <ChevronRight size={14} strokeWidth={1.8} />
                </button>
              )}
            </div>

            <div className={styles.grid}>
              <button className={styles.cell} onClick={loadAddCandidates}>
                <span className={`${styles.avatar} ${styles.addAvatar}`}>
                  <UserPlus size={20} strokeWidth={1.8} />
                </span>
                <span className={styles.cellName}>{t('contacts.addMember')}</span>
              </button>
              {visibleMembers.map((m) => (
                <button key={m.userId} className={styles.cell} onClick={() => openMemberActions(m)}>
                  <span className={`${styles.avatarWrap} ${m.role === 2 ? styles.ownerRing : m.role === 1 ? styles.adminRing : ''}`}>
                    <span className={styles.avatar} style={{ background: avatarTint(m.nickname || '') }}>
                      {m.nickname?.charAt(0)}
                    </span>
                  </span>
                  <span className={styles.cellName}>{m.nickname}</span>
                  <RoleBadge role={m.role} />
                  {m.deleted && <span className={styles.deletedTag}>{t('settings.deletedUser')}</span>}
                </button>
              ))}
            </div>

            {canManage && (
              <button className={styles.manageHint} onClick={() => setShowMembers(true)}>
                {t('contacts.memberActions')}
                <ChevronRight size={15} strokeWidth={1.8} />
              </button>
            )}
          </div>

          <div className={styles.menu}>
            {isOwner && (
              <>
                <div className={styles.menuItem} onClick={handleRename}>
                  <span>{t('contacts.renameGroup')}</span>
                  <ChevronRight size={16} strokeWidth={1.8} />
                </div>
                <div className={styles.menuItem} onClick={handleTransfer}>
                  <span>{t('contacts.transferOwner')}</span>
                  <ChevronRight size={16} strokeWidth={1.8} />
                </div>
              </>
            )}
            <div className={styles.menuItem} onClick={() => navigate(`/search?groupId=${groupId}`)}>
              <span>{t('search.findChatHistory')}</span>
              <ChevronRight size={16} strokeWidth={1.8} />
            </div>
            <div className={styles.menuItem} onClick={() => navigate(`/chat/${group.id}?type=1`)}>
              <span>{t('contacts.enterGroup')}</span>
              <ChevronRight size={16} strokeWidth={1.8} />
            </div>
          </div>

          {!isOwner && (
            <div className={styles.quit} onClick={handleQuit}>
              {t('contacts.quitGroup')}
            </div>
          )}
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
                <div className={styles.avatar} style={{ background: avatarTint(f.nickname || '') }}>
                  {f.nickname?.charAt(0)}
                </div>
                <span className={styles.popupName}>{f.nickname}</span>
              </div>
            ))
          )}
        </div>
      </Popup>

      <Popup
        visible={showMembers}
        onMaskClick={() => setShowMembers(false)}
        position="bottom"
        bodyStyle={{ borderTopLeftRadius: 16, borderTopRightRadius: 16 }}
      >
        <div className={styles.membersPopup}>
          <div className={styles.popupTitle}>
            {t('contacts.groupMembers')}
            <span className={styles.popupCount}>{members.length}</span>
          </div>
          <div className={styles.memberList}>
            {members.map((m) => (
              <button
                key={m.userId}
                className={styles.memberRow}
                onClick={() => {
                  setShowMembers(false);
                  openMemberActions(m);
                }}
              >
                <span className={`${styles.avatarWrap} ${m.role === 2 ? styles.ownerRing : m.role === 1 ? styles.adminRing : ''}`}>
                  <span className={styles.avatar} style={{ background: avatarTint(m.nickname || '') }}>
                    {m.nickname?.charAt(0)}
                  </span>
                </span>
                <span className={styles.memberMain}>
                  <span className={styles.memberName}>{m.nickname}</span>
                  <RoleBadge role={m.role} />
                </span>
                <ChevronRight size={16} strokeWidth={1.8} className={styles.rowChevron} />
              </button>
            ))}
          </div>
        </div>
      </Popup>

      <ActionSheet
        visible={sheet.visible}
        actions={sheet.actions}
        cancelText={t('common.cancel')}
        closeOnAction
        onClose={closeSheet}
      />
    </div>
  );
};

export default GroupDetail;
