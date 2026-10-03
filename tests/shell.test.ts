import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { quoteShell } from '../tools/shell';

it.each([
  '',
  "apostrophe ' and space",
  'double " and $variable; $(printf injected)',
  'line one\nline two',
])('round-trips a literal shell argument: %j', (value) => {
  const output = execFileSync('/bin/sh', ['-c', "printf '%s' " + quoteShell(value)], {
    encoding: 'utf8',
  });
  expect(output).toBe(value);
});
it('preserves Python source through the host shell and nested guest shell', () => {
  const source = "print({'status': 'ready', 'message': \"a'b\"})";
  const command = "printf '%s' " + quoteShell(source);
  const output = execFileSync('/bin/sh', ['-c', 'sh -c ' + quoteShell(command)], {
    encoding: 'utf8',
  });
  expect(output).toBe(source);
});
