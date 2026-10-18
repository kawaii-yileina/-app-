import { useEffect, useRef } from 'react';
import { pushBackGuard } from '../services/backGuard';

/**
 * 浮层返回拦截：active 为 true 时注册到全局返回栈，关闭时自动注销。
 * onClose 放 ref，避免调用方内联函数导致反复压栈。
 */
export function useBackGuard(active: boolean, onClose: () => void): void {
  const handlerRef = useRef(onClose);
  handlerRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    return pushBackGuard(() => handlerRef.current());
  }, [active]);
}
