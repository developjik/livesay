/**
 * Browser bundle entry: `dist/browser/livesay.js` exposes `window.Livesay`
 * with the announcer, so the demo (and a plain <script> tag) runs the same code
 * the package ships.
 */

export { createStreamingAnnouncer, type StreamingAnnouncer, type StreamingAnnouncerOptions } from './core.js';
export { createDomSink, createMemorySink, type AnnouncementSink } from './sink.js';
export { takeCompleteSentences, splitAtBoundary } from './sentences.js';
export { simulate, PROFILES, PROFILE_NAMES } from '../simulate.js';
export { countWords } from '../text.js';
export { markAnswer } from '../probe/mark.js';
