# livesay

**서버는 토큰을 세고, livesay는 귀를 셉니다.**

스크린리더는 스트리밍 답변을 "읽는" 게 아니라, 라이브 리전이나 `ariaNotify()` 호출로 들어오는 **모든 DOM 변경에 반응**합니다. 토큰을 그대로 `aria-live`에 흘리면 사용자는 문장이 되지 못한 반쪽 단어의 더듬거림을 듣고, 끝났다는 말은 듣지 못합니다.

livesay는 페이지가 실제로 무엇을 알렸는지 기록하고, 스크린리더가 무엇을 말하게 될지 시뮬레이션해서 **숫자**로 바꿉니다. 발화 횟수, 분당 단어 수, 잘린 발화, 중복, assertive 끼어들기, 그리고 "끝났다"를 알렸는지까지. CI에 넣을 수 있는 형태로요.

[![CI](https://github.com/developjik/livesay/actions/workflows/ci.yml/badge.svg)](https://github.com/developjik/livesay/actions/workflows/ci.yml)

[English README](README.md) · MIT · Node 20+

```bash
npx playwright install chromium
npx livesay audit http://localhost:3000/chat --html report.html
```

```
announcements   7     words/min       296     peak updates/s  36
partial         0     assertive       2       completion      silent
error  Token-by-token chatter [token-storm]
       p#answer was rewritten 36 times within 1000ms (78 updates total).
error  Answer ended without a completion announcement [silent-completion]
```

---

## 한 번의 측정으로 보는 버그

같은 78단어 답변, 같은 속도, 같은 시뮬레이션 스크린리더(`nvda-like` 프로필) 기준입니다.

| | 그냥 스트리밍 | `createStreamingAnnouncer` 적용 |
|---|---|---|
| 라이브 리전 갱신 | **78회** | 2회 |
| 초당 최대 갱신 | **36회** | 2회 |
| 발화 수 | 7회 | **4회** |
| 완료 알림 | **없음** | **있음** |
| 진단 결과 | 오류 3건 | 없음 |

두 페이지 모두 이 저장소에 있고(`demo/bad.html`, `demo/good.html`), 이 숫자 뒤의 동작(토큰 폭주, 제한된 발화 수, 완료 신호 없음)을 CI에서 매번 검증합니다.

## 1분 만에 해보기

```bash
git clone https://github.com/developjik/livesay.git
cd livesay
npm install
npx playwright install chromium
npm run build

node dist/cli.js serve            # http://127.0.0.1:4319
# 다른 셸에서
node dist/cli.js audit http://127.0.0.1:4319/bad.html --html report.html
node dist/cli.js audit http://127.0.0.1:4319/good.html --budget "announcements<8,no-partial,no-silent"
```

`bad.html`은 종료 코드 **1**, `good.html`은 **0**입니다. HTML 리포트는 "무엇이 언제 들렸고 무엇이 잘못됐는지"를 시간축으로 보여 줍니다.

## 측정하는 것

모든 지표는 DOM이 아니라 **말**에 대한 것입니다.

| 지표 | 의미 |
|---|---|
| `announcements` | 사용자가 실제로 듣게 되는 발화 수 |
| `words/min` | 생성 1분당 읽어야 하는 단어 수 — 180을 넘으면 안내자가 영원히 뒤처집니다 |
| `peak updates/s` | 라이브 리전이 가장 빽빽하게 갱신된 1초 |
| `partial` | 문장 중간에 끊겼다가 처음부터 다시 읽힌 발화 |
| `duplicate` | 같은 문장이 두 번 읽힌 경우 |
| `assertive` | 끼어들기 횟수 — 답변당 한 번을 넘으면 사용자와 싸우는 셈 |
| `replaced` | 말해지기 전에 밀려난 발화 |
| `deferred (aria-busy)` | `aria-busy` 때문에 보류된 갱신 |
| `completion` | 답변이 끝났다는 사실을 알렸는가 |

## 진단 규칙

| 규칙 | 심각도 | 발생 조건 |
|---|---|---|
| `token-storm` | error | 라이브 리전(또는 `ariaNotify`)이 1초에 5회 이상 갱신 |
| `silent-completion` | error | 스트림이 끝났는데 아무 알림도 없음 |
| `silent-abort` | error | 중단·실패했는데 페이지가 조용함 |
| `assertive-abuse` | error | 답변당 assertive 알림이 2회 이상 |
| `duplicate-announcement` | warn | 같은 문장이 창 안에서 두 번 발화 |
| `partial-announcement` | warn | 앞 발화가 다음 발화의 잘린 접두사 |

이 규칙들은 WCAG 판정이 아니라 **발화 계약**입니다. "끝을 알린다", "토큰마다 다시 읽지 않는다", "assertive는 답변당 한 번".

## 스크린리더 세 종, 하나의 녹음

정답이 되는 AT 구현은 없습니다. 그래서 녹음을 세 프로필로 다시 재생하고, 리포트에는 항상 **simulated**라고 적습니다.

| 프로필 | 동작 |
|---|---|
| `nvda-like` (기본) | 250ms 버스트 안의 polite 갱신은 합쳐지고, assertive는 끼어듭니다 |
| `voiceover-like` | polite 갱신을 모두 큐에 넣고, 말이 더 느립니다(단어당 300ms) |
| `spec-strict` | 전부 큐에 넣되 atomic 리전은 처음부터 다시 읽습니다 |

```bash
node dist/cli.js audit http://127.0.0.1:4319/bad.html --profile all
```

```
profile         announcements  words/min  updates/s  partial  dup  assertive  verdict
nvda-like       7              301        36         0        0    2          FAIL
voiceover-like  30             929        36         0        0    2          FAIL
spec-strict     31             956        36         0        0    2          FAIL
```

이 폭이 핵심입니다. 한 AT에서 "괜찮아 보이는" 페이지가 다른 AT에서는 못 들을 것이 됩니다.

## 교정

```ts
import { createStreamingAnnouncer, markAnswer } from 'livesay';

const announcer = createStreamingAnnouncer({
  minIntervalMs: 600,      // 발화 간격
  maxAnnouncements: 2,     // 말은 토큰을 따라갈 수 없습니다: 도입부만 알리고
});                        // 나머지는 읽을 수 있게 둡니다

markAnswer('start');

for await (const delta of stream) {
  el.append(delta);        // 화면에 보이는 답변 — 라이브 리전 아님
  announcer.push(delta);   // 문장 경계까지 버퍼링
}

markAnswer('done');        // 스트림이 끝난 순간 — livesay가 감사하는 지점
announcer.done();          // "Answer complete. 78 words."
```

```tsx
import { useStreamingAnnouncer } from 'livesay/react';

function Answer() {
  const say = useStreamingAnnouncer({ maxAnnouncements: 2 });
  // say.push(delta) … say.done() … say.error(reason)
  return <article aria-busy={streaming} aria-label="Answer" ref={ref} />;
}
```

하는 일과, 일부러 하지 않는 일:

- **토큰이 아니라 문장 단위** — 완결된 생각일 때만 말합니다
- **간격** — polite 발화 사이에 `minIntervalMs`
- **완료는 한 번의 호출** — 빠르게 이어지는 두 번의 알림은 합쳐지거나 버려집니다
- **assertive는 오류에만** — `error()`와 `abort()`만 끼어들고, 상태는 그러지 않습니다
- **끝은 한 번뿐** — `done()`/`abort()`/`error()` 중 첫 호출만 통과합니다. 중단 뒤의 `done()`은
  엉터리 완료 알림을 내지 못하고, 새 답변은 `reset()` 후에만 시작됩니다
- **`ariaNotify()`가 있으면 그것으로, 없으면 숨은 라이브 리전으로** — 인터페이스는 같고, 기능 감지는 정직합니다. 브라우저에 없는 `ariaNotify`를 있는 척하지 않습니다
- **상한** — `maxAnnouncements`가 3.5초에 78단어를 낭독하는 일을 막습니다

스트리밍 중에는 답변 컨테이너에 `aria-busy="true"`를 두세요. AT가 잠잠해지고, 글은 나중에 읽으면 됩니다.

## CI에서

```yaml
- name: 스트리밍 답변 접근성 예산
  run: |
    npx playwright install --with-deps chromium
    npm run build
    node dist/cli.js audit http://127.0.0.1:4319/good.html \
      --budget "announcements<8,words/min<400,no-partial,no-duplicate,no-silent"
```

예산 키: `announcements<8`, `words<120`, `words/min<180`, `updates/s<20`, `assertive<=1`,
`no-partial`, `no-duplicate`, `no-silent`, `no-errors`, `no-warnings`. 위반 시 종료 코드는 `1`입니다.

## CLI

```
livesay audit <url> [옵션]
  --profile <name|all>   nvda-like | voiceover-like | spec-strict | all
  --budget <spec>        CI용 발화 예산
  --json <path>          기계용 리포트 ("-"는 표준출력)
  --html <path>          자기완결형 발화 트랜스크립트
  --out <dir>            report.json과 report.html 저장
  --timeout <ms>         종료 마크 대기 시간 (기본 30000)
  --grace <ms>           종료 마크 이후 추가 녹음 (기본 1200)
  --wait-for <selector>  특정 요소를 기다린 뒤 종료 마크 대기
  --headed               브라우저를 보면서 실행
  --strict               경고도 실패로 처리

livesay serve [--port 4319]   데모 사이트
livesay rules                 규칙 표
```

### 답변의 끝을 알리기

"답변이 끝났다"는 DOM에서 관측할 수 없습니다. 그래서 페이지가 직접 말합니다.

```ts
import { markAnswer } from 'livesay';

markAnswer('start');
// … 스트리밍 …
markAnswer('done');    // 또는 'abort' / 'error'
```

`markAnswer`는 프로브가 없으면 아무 일도 하지 않으므로, 운영 코드와 감사 코드가 같은 경로를 씁니다. 완료 알림을 **보내기 전에** 마크하세요. 감사는 "스트림이 끝난 뒤에 청자에게 무엇이 도달했는가"를 묻습니다.

마크가 없는 페이지도 `token-storm`, `assertive-abuse`, 중복, 부분 발화는 감사됩니다. 침묵 규칙만 건너뛰고 리포트에 `completion: unmarked`로 표시합니다.

## 라이브러리 API

```ts
import {
  installProbe, readProbeSnapshot, audit,
  simulate, PROFILES, checkBudget, renderHtml, renderJson,
  createStreamingAnnouncer, createMemorySink,
} from 'livesay';

await installProbe(page);                 // 페이지 스크립트보다 먼저
const snapshot = await readProbeSnapshot(page);
const report = audit(snapshot, { profile: 'nvda-like', budget: 'announcements<8' });
```

`audit()`은 순수 함수입니다. 스냅샷을 받아 리포트를 돌려주므로, 저장한 녹음을 재생·비교하거나 단위 테스트에서 단언할 수 있습니다. 발화 타임라인만 필요하면 `simulate()`를 쓰세요.

## 동작 방식

```
페이지 ──▶ 프로브 (앱 코드보다 먼저 주입)
           ├─ ariaNotify() 후킹 (페이지가 나중에 넣는 폴리필 포함)
           └─ aria-live / role=status|alert|log|marquee|timer MutationObserver
              (politeness·aria-atomic·aria-relevant·aria-busy를 ARIA대로 해석)
        │  스냅샷: 이벤트 + 시각 + 순번 + 답변 마크
        ▼
시뮬레이터 ──▶ AT 프로필별 발화 타임라인
        ▼
규칙 ──▶ 진단 ──▶ 예산 ──▶ 종료 코드
        ▼
리포트 ──▶ 콘솔 · JSON · HTML 트랜스크립트
```

프로브는 레이아웃을 바꾸지 않고 페이지에 예외를 던지지 않습니다. 남기는 것은 확장 프로퍼티 하나(`window.__livesayProbe`)와 CLI가 기다리는 데이터 속성 하나뿐입니다. 순서는 시각이 아니라 **순번**으로 비교합니다. `mark()`가 대기 중인 뮤테이션을 먼저 비우기 때문에, 마크와 그 직전 변경이 같은 밀리초에 찍힐 수 있기 때문입니다.

## 이것이 아닌 것

- **WCAG 적합성 판정이 아닙니다.** 발화 계약(완결성·속도·중복·완료 신호)을 재는 도구이고, 통과했다고 4.1.3이나 2.2.2를 통과한 것은 아닙니다.
- **실제 스크린리더가 아닙니다.** 발화 타이밍은 시뮬레이션이고 프로필은 모델입니다. NVDA·VoiceOver·Orca의 녹음이 아닙니다. 리포트는 항상 "simulated"라고 적습니다.
- **크롤 감사가 아닙니다.** 한 페이지, 한 상호작용을 실행 시점에 잽니다. axe-core의 정적 스캔과 반대쪽 끝이고, 서로 보완합니다.
- **토큰 회계가 아닙니다.** `words/min`은 생성 시간 1분당 발화 단어 수입니다. 말이 따라갈 수 있는지를 말해 줄 뿐, 모델이 낸 토큰 수를 세지 않습니다.

## 개발

```bash
npm run typecheck     # tsc --noEmit
npm test              # vitest: 규칙·시뮬레이터·안내자·예산·리포트
npm run test:e2e      # build + playwright: 데모 두 개를 끝까지 감사
npm run test:all      # 전부
```

## 라이선스

MIT © jungingwon (developjik)
