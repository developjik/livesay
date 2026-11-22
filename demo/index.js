/* Measure both demos in place: run each, read its probe, simulate the listener. */

const frameBad = document.getElementById('frame-bad');
const frameGood = document.getElementById('frame-good');
const scoreBad = document.getElementById('score-bad');
const scoreGood = document.getElementById('score-good');
const runBoth = document.getElementById('run-both');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function countUpdates(snapshot) {
  return snapshot.events.filter((event) => event.type === 'region-updated').length;
}

async function measure(frame, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const win = frame.contentWindow;
    const probe = win?.__livesayProbe;
    if (probe) {
      const snapshot = probe.snapshot();
      const ended = snapshot.answers.some((answer) => answer.outcome !== 'running');
      if (ended) {
        const simulation = win.Livesay.simulate(snapshot, 'nvda-like');
        const last = snapshot.answers[snapshot.answers.length - 1];
        const completion = simulation.utterances.some(
          (utterance) => last && last.endedAt !== null && utterance.t >= last.endedAt,
        );
        return {
          announcements: simulation.utterances.length,
          updates: countUpdates(snapshot),
          completion,
        };
      }
    }
    await sleep(150);
  }
  return null;
}

function render(el, result, tone) {
  if (!result) {
    el.textContent = 'timed out';
    return;
  }
  el.innerHTML = `<span class="${tone}">${result.announcements}</span> announcements · ${result.updates} updates · completion ${
    result.completion ? 'yes' : 'no'
  }`;
}

async function run() {
  runBoth.disabled = true;
  scoreBad.textContent = 'running…';
  scoreGood.textContent = 'running…';
  frameBad.src = '/bad.html';
  frameGood.src = '/good.html';

  const [bad, good] = await Promise.all([measure(frameBad, 25_000), measure(frameGood, 25_000)]);
  render(scoreBad, bad, 'bad');
  render(scoreGood, good, 'good');
  runBoth.disabled = false;
}

runBoth.addEventListener('click', () => void run());
