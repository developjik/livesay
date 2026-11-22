/* Naive streaming chat: token by token into a live region, no completion signal. */

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
const toastEl = document.getElementById('toast');
const runBtn = document.getElementById('run');
const failBtn = document.getElementById('fail');
const tokens = ANSWER.match(/\S+\s*/g) ?? [ANSWER];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let running = false;

async function stream({ fail = false } = {}) {
  if (running) return;
  running = true;
  runBtn.disabled = true;
  failBtn.disabled = true;
  document.body.dataset.done = 'false';
  document.body.dataset.state = 'idle';
  toastEl.textContent = '';
  answerEl.textContent = '';
  statusEl.textContent = 'Thinking…';

  probe?.reset();
  mark('start');

  const total = tokens.length;
  const failAt = Math.round(total * 0.42);

  for (let index = 0; index < total; index += 1) {
    answerEl.append(tokens[index] ?? '');

    if (fail && index === failAt) {
      // the stream dies: no announcement, no error text, nothing
      document.body.dataset.done = 'true';
      document.body.dataset.state = 'error';
      mark('error', { detail: 'http 429 from the model' });
      running = false;
      runBtn.disabled = false;
      failBtn.disabled = false;
      return;
    }

    if (!fail && index === Math.round(total * 0.3)) toastEl.textContent = 'Searching the web…';
    if (!fail && index === Math.round(total * 0.65)) toastEl.textContent = 'Reading three pages…';

    await sleep(28);
  }

  // the stream is over. The DOM never says so.
  document.body.dataset.done = 'true';
  mark('done');
  running = false;
  runBtn.disabled = false;
  failBtn.disabled = false;
}

runBtn.addEventListener('click', () => void stream());
failBtn.addEventListener('click', () => void stream({ fail: true }));

void stream();
