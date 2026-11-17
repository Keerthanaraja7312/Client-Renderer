/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DATASTORE_API_URL?: string;
  readonly VITE_API_BASE?: string;
  readonly VITE_CLIENT_URL?: string;
  readonly VITE_DEFAULT_PAGE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}