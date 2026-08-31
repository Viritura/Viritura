/// <reference types="vite/client" />

declare module "*.module.css" {
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare module "mediainfo.js/MediaInfoModule.wasm?url" {
  const url: string;
  export default url;
}
