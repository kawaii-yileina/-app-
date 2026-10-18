/**
 * 全局返回栈：浮层打开时压栈，Android 返回键或浏览器返回先关闭最上层浮层。
 * Web 端在栈非空时压入一条同 URL 的历史哨兵，避免返回直接离开当前路由。
 */

import { Capacitor } from '@capacitor/core';

type Handler = () => void;

interface Entry {
  id: symbol;
  handler: Handler;
}

const SENTINEL_KEY = '__imBackGuard';
const stack: Entry[] = [];
/** Android 由 Capacitor backButton 事件处理，不能再操作 WebView 历史 */
const isAndroid = Capacitor.getPlatform() === 'android';
let sentinelActive = false;
let suppressPop = 0;
let installed = false;
// 关闭浮层时回退哨兵的异步窗口；期间若又打开新浮层，等 popstate 后再补哨兵
let pendingRelease = false;
let needSentinelAfterPop = false;

const stateWithSentinel = (): Record<string, unknown> => ({
  ...(typeof window.history.state === 'object' && window.history.state ? window.history.state : {}),
  [SENTINEL_KEY]: true,
});

const isSentinelState = (): boolean =>
  Boolean(window.history.state && (window.history.state as Record<string, unknown>)[SENTINEL_KEY]);

function ensureSentinel() {
  if (isAndroid || typeof window === 'undefined' || sentinelActive) return;
  if (pendingRelease) {
    needSentinelAfterPop = true;
    return;
  }
  window.history.pushState(stateWithSentinel(), '');
  sentinelActive = true;
}

function releaseSentinel() {
  if (isAndroid || !sentinelActive) return;
  sentinelActive = false;
  if (!isSentinelState()) return;
  pendingRelease = true;
  suppressPop += 1;
  window.history.back();
}

function onPopState() {
  if (suppressPop > 0) {
    suppressPop -= 1;
    sentinelActive = false;
    const finishedRelease = pendingRelease;
    pendingRelease = false;
    if (finishedRelease && stack.length > 0 && needSentinelAfterPop) {
      window.history.pushState(stateWithSentinel(), '');
      sentinelActive = true;
    }
    needSentinelAfterPop = false;
    return;
  }
  if (stack.length === 0) {
    sentinelActive = false;
    return;
  }
  // 用户返回已经消耗掉哨兵；先关闭浮层，绝不能再补哨兵。
  // 若仍有下层浮层，由 pushBackGuard 的 cleanup 负责重新压栈。
  sentinelActive = false;
  stack[stack.length - 1].handler();
}

/** 安装浏览器 popstate 监听；可重复调用，返回卸载函数 */
export function installBackGuard(): () => void {
  if (installed) return () => {};
  installed = true;
  window.addEventListener('popstate', onPopState);
  return () => {
    window.removeEventListener('popstate', onPopState);
    installed = false;
  };
}

/** 注册一个返回处理器；返回注销函数（组件卸载/浮层关闭时调用） */
export function pushBackGuard(handler: Handler): () => void {
  const entry: Entry = { id: Symbol('backGuard'), handler };
  stack.push(entry);
  ensureSentinel();
  return () => {
    const index = stack.findIndex((item) => item.id === entry.id);
    if (index >= 0) stack.splice(index, 1);
    if (stack.length > 0) {
      // 关闭最上层后仍有浮层时，重新保证返回拦截
      ensureSentinel();
    } else {
      releaseSentinel();
    }
  };
}

/** 关闭最上层浮层；没有浮层时返回 false */
export function runBackGuard(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top.handler();
  return true;
}

export function hasBackGuard(): boolean {
  return stack.length > 0;
}
