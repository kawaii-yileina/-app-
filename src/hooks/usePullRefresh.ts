import { useTranslation } from 'react-i18next';
import { Toast } from 'antd-mobile';

/**
 * 下拉刷新通用逻辑：统一 i18n 文案与失败提示，避免各列表页重复（AGENTS §1.1）。
 * 用法：const pullProps = usePullRefresh(fetcher); 然后 <PullToRefresh {...pullProps}> 。
 * 注意：须在组件顶层无条件调用（遵循 hooks 规则），不要写进条件渲染里。
 */
export const usePullRefresh = (fetcher: () => Promise<boolean>) => {
  const { t } = useTranslation();

  const onRefresh = async (): Promise<void> => {
    const ok = await fetcher();
    if (!ok) {
      Toast.show({ content: t('common.refreshFailed') });
    }
  };

  return {
    onRefresh,
    pullingText: t('common.pullToRefresh'),
    canReleaseText: t('common.releaseToRefresh'),
    refreshingText: t('common.refreshing'),
    completeText: t('common.refreshComplete'),
  };
};
