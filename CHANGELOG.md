# Changelog

## 0.1.1

- `createStreamingAnnouncer`: terminal endings are now idempotent — the first of `done()`/`abort()`/`error()` wins, repeats and cross-terminal calls are ignored, so an abort or error can no longer be followed by a bogus "Answer complete" announcement (DEV-46).
- `status()` and `push()` go quiet after a terminal phase; a new answer starts only after an explicit `reset()` (contract documented in the README and API docs).
- Tests pin: repeated abort/error → one announcement, abort/error → done → no completion text, reset → normal completion.

## 0.1.0

- Initial release: livesay audit/probe/simulate CLI, speech budget rules, `createStreamingAnnouncer` + `useStreamingAnnouncer` + `markAnswer` helpers.
