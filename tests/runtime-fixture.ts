import fs from 'node:fs';
import dotenv from 'dotenv';
import os from 'node:os';
import path from 'node:path';
import { afterAll, vi } from 'vitest';
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-unit-'));
afterAll(() => fs.rmSync(folder, { recursive: true, force: true }));

// Unit transport and process fixtures do not depend on a developer's private settings.
// Configuration tests exercise the real loader separately, including missing-file errors.
vi.mock('../packages/runtime/src/configuration', async (original) => {
  const actual = await original<typeof import('../packages/runtime/src/configuration')>();
  return {
    ...actual,
    projectRoot: () => folder,
    loadConfiguration: () =>
      actual.validateConfiguration(dotenv.parse(fs.readFileSync('.env.example'))),
  };
});
