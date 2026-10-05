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
    inspectPublicFile('.env.web.example', 'ORDERING_URL=http://backend-host.local:4311'),
  ).toEqual([]);
  expect(
    inspectPublicFile('.env.example', 'PG_HOST=127.0.0.1\nPG_ADMIN_PASSWORD=dummy_local_admin'),
  ).toEqual([]);
  expect(inspectPublicFile('README.md', 'https://github.com/example/project')).toEqual([]);
});

it('checks visible diagram labels without interpreting editor ordering tokens as documentation', () => {
  const contents = JSON.stringify({
    elements: [{ index: 'a' + 'I', text: 'Ordering database', originalText: 'Ordering database' }],
  });
  expect(inspectPublicFile('docs/diagrams/scene.excalidraw', contents)).toEqual([]);
  const prohibited = JSON.stringify({ elements: [{ index: 'a0', text: ['A', 'I'].join('') }] });
  expect(inspectPublicFile('docs/diagrams/scene.excalidraw', prohibited)).toContain(
    'docs/diagrams/scene.excalidraw: documentation terminology outside the project scope',
  );
});
it('continues scanning all diagram metadata for private paths and rejects malformed scenes', () => {
  const location = ['/', 'Users', '/', 'fixture-user', '/project'].join('');
  const contents = JSON.stringify({ elements: [{ text: 'Ordering' }], source: location });
  expect(inspectPublicFile('docs/diagrams/scene.excalidraw', contents)).toContain(
    'docs/diagrams/scene.excalidraw: machine-specific home path',
  );
  expect(inspectPublicFile('docs/diagrams/scene.excalidraw', '{broken')).toContain(
    'docs/diagrams/scene.excalidraw: invalid editable diagram',
  );
});
