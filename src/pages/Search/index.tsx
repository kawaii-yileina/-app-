import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { SpinLoading } from 'antd-mobile';
import {
  ArrowLeft, ChevronRight, Clock3, MessagesSquare, Search, Trash2, UserRound, Users, X,
} from 'lucide-react';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
import { searchApi } from '../../api';
import SharedAvatar from '../../components/SharedAvatar';
import GroupAvatar from '../../components/GroupAvatar';
import { useContactStore } from '../../store/useContactStore';
import type {
  SearchCategory,
  SearchContactItem,
  SearchGroupItem,
  SearchMemberItem,
  SearchMessageItem,
  SearchResponse,
} from '../../types';
import styles from './index.module.css';

type TypeKey = 'contact' | 'group' | 'member' | 'message';

const ALL_TYPES: TypeKey[] = ['contact', 'group', 'member', 'message'];
const KEYWORD_KEY = 'im_search_keyword';
const TYPES_KEY = 'im_search_types';
const RECENT_KEY = 'im_recent_searches';

const loadRecent = (): string[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string').slice(0, 8) : [];
  } catch {
    return [];
  }
};

const loadTypes = (groupId: string | null): Set<TypeKey> => {
  if (groupId) return new Set<TypeKey>(['message']);
  try {
    const parsed = JSON.parse(sessionStorage.getItem(TYPES_KEY) || '[]') as unknown;
    if (Array.isArray(parsed)) {
      const valid = parsed.filter((x): x is TypeKey => ALL_TYPES.includes(x as TypeKey));
      if (valid.length > 0) return new Set(valid);
    }
  } catch {
    // 忽略损坏的本地状态
  }
  return new Set(ALL_TYPES);
};

const SearchPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const groups = useContactStore((s) => s.groups);
  const [searchParams] = useSearchParams();
  const groupId = searchParams.get('groupId');
  const inputRef = useRef<HTMLInputElement>(null);
  const [keyword, setKeyword] = useState(() => sessionStorage.getItem(KEYWORD_KEY) || '');
  const [types, setTypes] = useState<Set<TypeKey>>(() => loadTypes(groupId));
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [rateLimited, setRateLimited] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setTypes(groupId ? new Set<TypeKey>(['message']) : loadTypes(null));
  }, [groupId]);

  useEffect(() => {
    sessionStorage.setItem(KEYWORD_KEY, keyword);
    if (!groupId) {
      sessionStorage.setItem(TYPES_KEY, JSON.stringify([...types]));
    }
  }, [keyword, types, groupId]);

  useEffect(() => {
    const q = keyword.trim();
    if (!q) {
      setResults(null);
      setLoading(false);
      setFailed(false);
      setRateLimited(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setFailed(false);
      setRateLimited(false);
      try {
        const res = await searchApi.search({
          keyword: q,
          types: [...types].join(','),
          limit: 20,
          ...(groupId ? { groupId } : {}),
        }, controller.signal);
        if (controller.signal.aborted) return;
        if (res.code === 200) {
          setResults(res.data);
          setExpanded({});
        } else if (res.code === 429) {
          setResults(null);
          setRateLimited(true);
        } else {
          setFailed(true);
        }
      } catch (e) {
        if (!controller.signal.aborted) setFailed(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [keyword, types, groupId, retryKey]);

  const remember = (value: string) => {
    const q = value.trim();
    if (!q) return;
    const next = [q, ...recent.filter((item) => item !== q)].slice(0, 8);
    setRecent(next);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  };

  const toggleType = (type: TypeKey) => {
    if (groupId) return;
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next.size === 0 ? prev : next;
    });
  };

  const openResult = (action: () => void) => {
    remember(keyword);
    action();
  };

  const highlight = (text: string): ReactNode => {
    const q = keyword.trim();
    if (!q || !text) return text;
    const index = text.toLowerCase().indexOf(q.toLowerCase());
    if (index < 0) return text;
    return (
      <>
        {text.slice(0, index)}
        <mark className={styles.mark}>{text.slice(index, index + q.length)}</mark>
        {text.slice(index + q.length)}
      </>
    );
  };

  const renderCategory = <T,>(
    key: string,
    title: string,
    category: SearchCategory<T> | undefined,
    renderItem: (item: T) => ReactNode,
  ) => {
    if (!category || category.total === 0) return null;
    const isExpanded = Boolean(expanded[key]);
    const visible = isExpanded ? category.items.slice(0, 20) : category.items.slice(0, 3);
    return (
      <section className={styles.section} key={key}>
        <div className={styles.sectionHeader}>
          <span>{title}</span>
          <span className={styles.count}>{category.total > 99 ? '99+' : category.total}</span>
        </div>
        <div className={styles.sectionList}>{visible.map(renderItem)}</div>
        {!isExpanded && category.total > 3 && (
          <button className={styles.moreButton} onClick={() => setExpanded((prev) => ({ ...prev, [key]: true }))}>
            {t('search.viewMore')} ({category.total > 99 ? '99+' : category.total})
            <ChevronRight size={14} strokeWidth={1.8} />
          </button>
        )}
      </section>
    );
  };

  const renderContact = (item: SearchContactItem) => (
    <button
      key={`contact-${item.userId}`}
      className={styles.row}
      onClick={() => openResult(() => navigate(`/contacts/${item.userId}`))}
    >
      <SharedAvatar name={item.nickname || item.username} src={item.avatar} size={42} />
      <span className={styles.rowMain}>
        <span className={styles.rowTitle}>{highlight(item.nickname || item.username)}</span>
        <span className={styles.rowSub}>
          {highlight(item.username)}
          <span className={styles.relationTag}>
            {item.isFriend ? t('search.added') : t('contacts.add')}
          </span>
        </span>
      </span>
      <ChevronRight size={16} strokeWidth={1.8} className={styles.chevron} />
    </button>
  );

  const renderGroup = (item: SearchGroupItem) => {
    const group = groups.find((g) => g.id === item.id);
    return (
      <button
        key={`group-${item.id}`}
        className={styles.row}
        onClick={() => openResult(() => navigate(`/chat/${item.id}?type=1`))}
      >
        <GroupAvatar name={item.name} avatar={item.avatar} members={group?.memberAvatars} size={42} />
        <span className={styles.rowMain}>
          <span className={styles.rowTitle}>{highlight(item.name)}</span>
          <span className={styles.rowSub}>{t('search.groups')}</span>
        </span>
        <ChevronRight size={16} strokeWidth={1.8} className={styles.chevron} />
      </button>
    );
  };

  const renderMember = (item: SearchMemberItem) => (
    <button
      key={`member-${item.groupId}-${item.userId}`}
      className={styles.row}
      onClick={() => openResult(() => navigate(`/contacts/groups/${item.groupId}`))}
    >
      <SharedAvatar name={item.nickname || item.username} src={item.avatar} size={42} />
      <span className={styles.rowMain}>
        <span className={styles.rowTitle}>
          {highlight(item.nickname || item.username)}
          {item.role === 2 && <span className={`${styles.roleBadge} ${styles.ownerBadge}`}>{t('contacts.ownerBadge')}</span>}
          {item.role === 1 && <span className={`${styles.roleBadge} ${styles.adminBadge}`}>{t('contacts.adminBadge')}</span>}
        </span>
        <span className={styles.rowSub}>{highlight(item.groupName)}</span>
      </span>
      <ChevronRight size={16} strokeWidth={1.8} className={styles.chevron} />
    </button>
  );

  const renderMessage = (item: SearchMessageItem) => (
    <button
      key={`message-${item.msgId}`}
      className={`${styles.row} ${styles.messageRow}`}
      onClick={() => openResult(() => {
        const seq = Number(item.seq);
        const around = Number.isFinite(seq) && seq > 0
          ? `&aroundSeq=${seq}&msgId=${encodeURIComponent(item.msgId)}`
          : '';
        navigate(`/chat/${item.targetId}?type=${item.chatType}${around}`);
      })}
    >
      <span className={styles.messageIcon}><MessagesSquare size={18} strokeWidth={1.8} /></span>
      <span className={styles.rowMain}>
        <span className={styles.rowTitle}>
          {item.groupName ? `${item.groupName} · ${item.senderName}` : item.senderName}
          <span className={styles.messageTime}>{dayjs(item.createdAt).format('MM-DD HH:mm')}</span>
        </span>
        <span className={styles.messageContent}>{highlight(item.content)}</span>
      </span>
    </button>
  );

  const hasAnyResult = Boolean(results && (
    results.contacts.total + results.groups.total + results.members.total + results.messages.total > 0
  ));

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <button className={styles.backButton} onClick={() => navigate(-1)} aria-label={t('common.back')}>
          <ArrowLeft size={22} strokeWidth={1.8} />
        </button>
        <div className={styles.inputWrap}>
          <Search size={16} strokeWidth={1.8} className={styles.inputIcon} />
          <input
            ref={inputRef}
            className={styles.input}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                remember(keyword);
                inputRef.current?.blur();
              }
            }}
            placeholder={t('search.placeholder')}
            maxLength={50}
          />
          {keyword && (
            <button
              className={styles.clearButton}
              onClick={() => {
                setKeyword('');
                inputRef.current?.focus();
              }}
              aria-label={t('common.clear')}
            >
              <X size={15} strokeWidth={1.8} />
            </button>
          )}
        </div>
        <button className={styles.cancelButton} onClick={() => navigate(-1)}>{t('common.cancel')}</button>
      </header>

      <div className={styles.scroll}>
        {groupId ? (
          <div className={styles.scopeNote}>{t('search.groupMessages')}</div>
        ) : (
          <div className={styles.chips}>
            {ALL_TYPES.map((type) => (
              <button
                key={type}
                className={`${styles.chip} ${types.has(type) ? styles.chipActive : ''}`}
                onClick={() => toggleType(type)}
              >
                {t(`search.${type === 'contact' ? 'contacts' : type === 'group' ? 'groups' : type === 'member' ? 'members' : 'messages'}`)}
              </button>
            ))}
          </div>
        )}

        {!keyword.trim() && (
          <div className={styles.recentBlock}>
            {recent.length > 0 ? (
              <>
                <div className={styles.recentHeader}>
                  <span>{t('search.recent')}</span>
                  <button
                    className={styles.clearRecent}
                    onClick={() => {
                      setRecent([]);
                      localStorage.removeItem(RECENT_KEY);
                    }}
                  >
                    <Trash2 size={13} strokeWidth={1.8} />
                    {t('search.clearRecent')}
                  </button>
                </div>
                <div className={styles.recentList}>
                  {recent.map((item) => (
                    <button key={item} className={styles.recentItem} onClick={() => setKeyword(item)}>
                      <Clock3 size={15} strokeWidth={1.8} />
                      <span>{item}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className={styles.hint}>
                <UserRound size={28} strokeWidth={1.5} />
                <Users size={28} strokeWidth={1.5} />
                <span>{t('search.placeholder')}</span>
              </div>
            )}
          </div>
        )}

        {loading && (
          <div className={styles.loading}><SpinLoading color="primary" /></div>
        )}

        {!loading && rateLimited && (
          <div className={styles.stateBox}>{t('search.rateLimited')}</div>
        )}

        {!loading && failed && (
          <div className={styles.stateBox}>
            <span>{t('search.searchFailed')}</span>
            <button className={styles.retryButton} onClick={() => setRetryKey((key) => key + 1)}>
              {t('common.retry')}
            </button>
          </div>
        )}

        {!loading && !failed && keyword.trim() && results && !hasAnyResult && (
          <div className={styles.stateBox}>{t('search.noResults')}</div>
        )}

        {!loading && !failed && results && (
          <div className={styles.results}>
            {renderCategory('contacts', t('search.contacts'), results.contacts, renderContact)}
            {renderCategory('groups', t('search.groups'), results.groups, renderGroup)}
            {renderCategory('members', t('search.members'), results.members, renderMember)}
            {renderCategory('messages', t('search.messages'), results.messages, renderMessage)}
          </div>
        )}
      </div>
    </div>
  );
};

export default SearchPage;

