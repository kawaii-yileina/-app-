/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_WS_URL?: string;
  /** 应用层消息加密开关（需与服务端 im.crypto.enabled 成对开启） */
  readonly VITE_CRYPTO_ENABLED?: string;
  /** 服务端静态公钥（SPKI, Base64），用于防中间人的信任锚 */
  readonly VITE_CRYPTO_SERVER_SPKI?: string;
  /** 轮换期可信公钥集合（JSON：{"k1":"SPKI","k2":"SPKI"}）；设置后优先于 VITE_CRYPTO_SERVER_SPKI */
  readonly VITE_CRYPTO_KEYS?: string;
  /** 服务端静态密钥标识 */
  readonly VITE_CRYPTO_KEY_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
