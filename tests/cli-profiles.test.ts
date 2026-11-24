import { afterEach, describe, expect, it, vi } from 'vitest';
import { regionUpdate, snapshot } from './helpers/fixtures.js';

const captured = vi.hoisted(() => ({ value: {} as unknown }));
vi.mock('../src/capture.js', () => ({ capture: async () => captured.value }));
const originalArgs = process.argv;
afterEach(() => { process.argv = originalArgs; vi.restoreAllMocks(); vi.resetModules(); });

describe('CLI all-profile regression', () => {
  it('fails for non-primary budget failures and writes all profiles as pure JSON', async () => {
    captured.value = { snapshot: snapshot({ events: [0,100,200].map((t,index) => regionUpdate({ t, text: `notice ${index}`, previousText: '', addedText: `notice ${index}` })) }), status: 'done' };
    const output: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => { output.push(String(chunk)); return true; });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    process.argv = ['node', 'cli', 'audit', 'https://example.test', '--profile', 'all', '--budget', 'announcements<3', '--json', '-'];
    await import('../src/cli.js');
    await vi.waitFor(() => expect(exit).toHaveBeenCalled());
    expect(exit).toHaveBeenCalledWith(1);
    const parsed = JSON.parse(output.join(''));
    expect(parsed.schema).toBe('livesay.profiles/v1');
    expect(parsed.reports[0].budget.passed).toBe(true);
    expect(parsed.reports[1].budget.passed).toBe(false);
  });
});
