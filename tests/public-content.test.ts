import { expect, it } from 'vitest';
import { inspectPublicFile } from '../tools/public-content';

it('rejects private files and identifying values without echoing their contents', () => {
  expect(inspectPublicFile('.env.production', 'PASSWORD=fixture')).toContain(
    '.env.production: private configuration file',
  );
  expect(inspectPublicFile('keys/client.pem', 'fixture')).toContain(
    'keys/client.pem: private key, credential directory or generated runtime data',
  );
  const contents = ['/', 'Users', '/', 'fixture-user', '/project'].join('');
  const report = inspectPublicFile('docs/setup.md', contents);
  expect(report).toContain('docs/setup.md: machine-specific home path');
  expect(report.join()).not.toContain('fixture-user');
});

it('accepts the fictional environment example and public project URL', () => {
  expect(
    inspectPublicFile('.env.example', 'PG_HOST=127.0.0.1\nPG_ADMIN_PASSWORD=dummy_local_admin'),
  ).toEqual([]);
  expect(inspectPublicFile('README.md', 'https://github.com/example/project')).toEqual([]);
});
