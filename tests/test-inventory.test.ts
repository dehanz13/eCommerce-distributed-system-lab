import { expect, it } from 'vitest';
import { inventory } from '../tools/test-inventory.mjs';
it('records only observed assertion statuses with relative paths, including failed and skipped cases', () => {
  const rows = inventory(
    {
      testResults: [
        {
          name: '/lab/tests/sample.test.ts',
          assertionResults: [
            { fullName: 'accepts good data', status: 'passed', duration: 4 },
            { fullName: 'rejects bad data', status: 'failed', duration: 5 },
            { fullName: 'pending boundary', status: 'skipped' },
          ],
        },
      ],
    },
    '/lab',
  );
  expect(rows.map((x) => [x.file, x.name, x.status, x.durationMs])).toEqual([
    ['tests/sample.test.ts', 'accepts good data', 'passed', 4],
    ['tests/sample.test.ts', 'rejects bad data', 'failed', 5],
    ['tests/sample.test.ts', 'pending boundary', 'skipped', null],
  ]);
  expect(inventory({}, '/lab')).toEqual([]);
});
