/** 音视频通话相关类型 */

export type CallMedia = 'audio' | 'video';

/** 通话阶段：idle 无通话 / incoming 来电铃响 / outgoing 呼出铃响 / connecting 协商中 / active 通话中 / ended 已结束 */
export type CallPhase = 'idle' | 'incoming' | 'outgoing' | 'connecting' | 'active' | 'ended';

/** 结束原因（用于展示文案） */
export type CallEndReason =
  | 'hangup'
  | 'rejected'
  | 'canceled'
  | 'busy'
  | 'timeout'
  | 'failed'
  | 'permission';

export interface CallPeer {
  id: string;
  name: string;
  avatar?: string;
}

/** 通话信令类型（与后端白名单一致）：瞬时消息，不落库 */
export const CALL_SIGNAL_TYPES = new Set([
  'CALL_INVITE',
  'CALL_RINGING',
  'CALL_ACCEPT',
  'CALL_REJECT',
  'CALL_CANCEL',
  'CALL_BUSY',
  'CALL_OFFER',
  'CALL_ANSWER',
  'CALL_ICE',
  'CALL_HANGUP',
  'CALL_TIMEOUT',
]);
