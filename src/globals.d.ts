declare global {
  interface Window {
    /** Browser entry point for announcements; https://developer.mozilla.org/docs/Web/API/Window/ariaNotify */
    ariaNotify?: (message: string, options?: { priority?: 'normal' | 'high' }) => void;
    __livesayProbe?: import('./probe/runtime.js').ProbeHandle;
  }
}

export {};
