// Declares the ambient module shape for CSS Modules so .module.css imports
// type-check in consumers that don't ship a CSS-module typing themselves.

declare module "*.module.css" {
  const classes: { readonly [key: string]: string };
  export default classes;
}
