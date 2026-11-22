/* The same answer, announced by livesay's createStreamingAnnouncer. */

const ANSWER = [
  'A streaming answer arrives one token at a time.',
  'Most chat interfaces write every token straight into a live region, so the screen reader is asked to speak again and again.',
  'The result is a stutter of half-words that never becomes a sentence.',
  'When the stream finally stops, nothing announces that the answer is complete.',
  'A listener cannot tell whether the answer ended or the page is still thinking.',
  'That silence is the bug users report most often.',
].join(' ');

const probe = window.__livesayProbe;
const mark = (phase, detail) => (window.Livesay?.markAnswer ?? ((p, d) => probe?.mark(p, d)))(phase, detail);
const answerEl = document.getElementById('answer');
const statusEl = document.getElementById('status');
const runBtn = document.getElementById('run');
const failBtn = document.getElementById('fail');
const tokens = ANSWER.match(/\S+\s*/g) ?? [ANSWER];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const announcer = window.Livesay.createStreamingAnnouncer({ minIntervalMs: 600, maxAnnouncements: 2 });

let running = false;

async function stream({ fail = false } = {}) {
  if (running) return;
  running = true;
  runBtn.disabled = true;
  failBtn.disabled = true;
  document.body.dataset.done = 'false';

  probe?.reset();
  announcer.reset();
  answerEl.textContent = '';
  answerEl.setAttribute('aria-busy', 'true');
  statusEl.textContent = 'Searching the project notes…';

  mark('start');
  announcer.status('Searching the project notes…');

  const total = tokens.length;
  const failAt = Math.round(total * 0.42);

  for (let index = 0; index < total; index += 1) {
    const token = tokens[index] ?? '';
    answerEl.append(token);
    announcer.push(token);

    if (fail && index === failAt) {
      document.body.dataset.done = 'true';
      answerEl.setAttribute('aria-busy', 'false');
      mark('error', { detail: 'http 429 from the model' });
      announcer.error('the model returned 429');
      statusEl.textContent = 'Request failed (429). Nothing was lost; the partial answer stays above.';
      running = false;
      runBtn.disabled = false;
      failBtn.disabled = false;
      return;
    }

    await sleep(45);
  }

  document.body.dataset.done = 'true';
  answerEl.setAttribute('aria-busy', 'false');
  mark('done');
  announcer.done();
  statusEl.textContent = 'Answer complete.';
  running = false;
  runBtn.disabled = false;
  failBtn.disabled = false;
}

runBtn.addEventListener('click', () => void stream());
failBtn.addEventListener('click', () => void stream({ fail: true }));

void stream();
