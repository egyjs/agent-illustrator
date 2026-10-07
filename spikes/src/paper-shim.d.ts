/// <reference types="paper" />
// paper's own d.ts declares the global `paper` namespace, but the ESM-safe import path
// `paper/dist/paper-core.js` resolves to a declaration file with no exports.
declare module 'paper/dist/paper-core.js' {
  export default paper;
}
