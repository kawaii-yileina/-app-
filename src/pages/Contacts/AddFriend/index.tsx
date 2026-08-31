import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { NavBar, Input, Button, Toast } from 'antd-mobile';
import { useTranslation } from 'react-i18next';
import { userApi, contactApi } from '../../../api';
import type { SearchUser } from '../../../types';
import styles from './index.module.css';

const AddFriend = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<SearchUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = useCallback(async (kw: string) => {
    if (!kw.trim()) {
      setResults([]);
      setSearched(false);
      return;
    }
    setSearching(true);
    try {
      const res = await userApi.search(kw.trim());
      if (res.code === 200) {
        setResults(res.data || []);
      } else {
        setResults([]);
      }
    } catch (e) {
      console.error('Search failed:', e);
    } finally {
      setSearching(false);
      setSearched(true);
    }
  }, []);

  const handleKeywordChange = (val: string) => {
    setKeyword(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(val), 300);
  };

  const handleAdd = async (user: SearchUser, index: number) => {
    try {
      const res = await contactApi.sendRequest(user.userId);
      if (res.code === 200) {
        Toast.show({ content: t('contacts.requestSent') });
        setResults((prev) =>
          prev.map((u, i) => (i === index ? { ...u, requestStatus: 1 } : u))
        );
      } else {
        Toast.show({ content: res.message || t('common.error') });
      }
    } catch (e) {
      Toast.show({ content: t('common.error') });
    }
  };

  const handleOpenDetail = (user: SearchUser) => {
    navigate(`/contacts/${user.userId}`);
  };

  const getAction = (user: SearchUser, index: number) => {
    if (user.isFriend) {
      return (
        <Button size="mini" className={styles.actionBtn} onClick={() => navigate(`/chat/${user.userId}?type=0`)}>
          {t('contacts.message')}
        </Button>
      );
    }
    if (user.requestStatus === 1) {
      return (
        <Button size="mini" className={`${styles.actionBtn} ${styles.pending}`}>
          {t('contacts.requested')}
        </Button>
      );
    }
    if (user.requestStatus === 2) {
      return (
        <Button
          size="mini"
          className={styles.actionBtn}
          onClick={() => navigate(`/contacts/${user.userId}`)}
        >
          {t('contacts.toAccept')}
        </Button>
      );
    }
    return (
      <Button size="mini" color="primary" className={styles.actionBtn} onClick={() => handleAdd(user, index)}>
        {t('contacts.add')}
      </Button>
    );
  };

  return (
    <div className={styles.container}>
      <NavBar onBack={() => navigate(-1)} className={styles.navBar}>
        {t('contacts.addFriend')}
      </NavBar>

      <div className={styles.searchSection}>
        <Input
          placeholder={t('contacts.searchPlaceholder')}
          value={keyword}
          onChange={handleKeywordChange}
          className={styles.input}
          clearable
        />
        {searching && <span className={styles.searching}>{t('common.loading')}</span>}
      </div>

      <div className={styles.results}>
        {searched && results.length === 0 && (
          <div className={styles.empty}>{t('contacts.noResults')}</div>
        )}
        {results.map((user, index) => (
          <div key={user.userId} className={styles.resultItem} onClick={() => handleOpenDetail(user)}>
            <div className={styles.avatar}>{user.nickname?.charAt(0)}</div>
            <div className={styles.info}>
              <div className={styles.name}>{user.nickname}</div>
              <div className={styles.sub}>{`${t('contacts.wechat')}: ${user.username}`}</div>
            </div>
            <div onClick={(e) => e.stopPropagation()}>
              {getAction(user, index)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default AddFriend;
