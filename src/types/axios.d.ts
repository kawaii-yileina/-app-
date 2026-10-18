import 'axios';
import type { RestCryptoSession } from '../services/restCrypto';

declare module 'axios' {
  export interface AxiosRequestConfig {
    /** 标记该请求需要 REST 响应加密（im-rest-v1） */
    restEncrypted?: boolean;
    /** 本次请求的临时密钥上下文，仅内部使用 */
    _restCrypto?: RestCryptoSession;
  }
}
