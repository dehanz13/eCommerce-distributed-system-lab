import fs from 'node:fs';
import dotenv from 'dotenv';
import { vi } from 'vitest';

// Unit transport and process fixtures do not depend on a developer's private settings.
// Configuration tests exercise the real loader separately, including missing-file errors.
vi.mock('../packages/runtime/src/configuration', async (original) => {
  const actual = await original<typeof import('../packages/runtime/src/configuration')>();
  return {
    ...actual,
    loadConfiguration: () =>
      actual.validateConfiguration(dotenv.parse(fs.readFileSync('.env.example'))),
  };
});
