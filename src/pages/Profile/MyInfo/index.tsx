import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { NavBar, Form, Input, Button, Toast } from 'antd-mobile';
import { useTranslation } from 'react-i18next';
import { authApi, fileApi } from '../../../api';
import { useAuthStore } from '../../../store/useAuthStore';
import SharedAvatar from '../../../components/SharedAvatar';
import AvatarEditor from '../../../components/AvatarEditor';
import styles from './index.module.css';

const MyInfo = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const updateUser = useAuthStore((s) => s.updateUser);
  const [nickname, setNickname] = useState(user?.nickname || '');
  const [signature, setSignature] = useState(user?.signature || '');
  const [saving, setSaving] = useState(false);
  const [showEditor, setShowEditor] = useState(false);

  const handleAvatarUpload = async (file: File): Promise<string> => {
    const result = await fileApi.upload(file);
    const avatarUrl = result.url;
    const res = await authApi.updateProfile({ avatar: avatarUrl });
    if (res.code === 200) {
      updateUser({ avatar: res.data.avatar });
    }
    return avatarUrl;
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await authApi.updateProfile({
        nickname: nickname.trim(),
        signature: signature.trim(),
      });
      if (res.code === 200) {
        updateUser({
          nickname: res.data.nickname,
          signature: res.data.signature,
        });
        Toast.show({ content: t('info.saveSuccess') });
        navigate(-1);
      } else {
        Toast.show({ content: res.message || t('common.error') });
      }
    } catch (e) {
      Toast.show({ content: t('common.error') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.container}>
      <NavBar onBack={() => navigate(-1)} className={styles.navBar}>
        {t('info.title')}
      </NavBar>

      <div className={styles.avatarSection} onClick={() => setShowEditor(true)}>
        <SharedAvatar name={user?.nickname || user?.username} src={user?.avatar} size={72} />
        <span className={styles.avatarLabel}>{t('profile.changeAvatar')}</span>
      </div>

      <Form className={styles.form} layout="vertical">
        <Form.Item label={t('info.account')}>
          <Input value={user?.username} disabled className={styles.disabledInput} />
        </Form.Item>

        <Form.Item label={t('info.nickname')}>
          <Input
            value={nickname}
            onChange={setNickname}
            placeholder={t('info.nicknamePlaceholder')}
            className={styles.input}
            clearable
          />
        </Form.Item>

        <Form.Item label={t('info.signature')}>
          <Input
            value={signature}
            onChange={setSignature}
            placeholder={t('info.signaturePlaceholder')}
            className={styles.input}
            clearable
          />
        </Form.Item>
      </Form>

      <div className={styles.footer}>
        <Button
          block
          color="primary"
          size="large"
          loading={saving}
          onClick={handleSave}
          className={styles.saveBtn}
        >
          {t('common.save')}
        </Button>
      </div>

      <AvatarEditor
        visible={showEditor}
        onClose={() => setShowEditor(false)}
        onUpload={handleAvatarUpload}
      />
    </div>
  );
};

export default MyInfo;
