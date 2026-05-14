import type { NextConfig } from 'next';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { config as loadDotenv } from 'dotenv';

// Next.js only reads .env from packages/ui/ by default. The rest of the
// workspace shares a single .env at the repo root — so load it here for
// the UI build/runtime too. Values explicitly set in the environment
// (e.g. on Vercel) still win because dotenv doesn't override.
const repoRoot = resolve(__dirname, '..', '..');
const rootEnv = resolve(repoRoot, '.env');
if (existsSync(rootEnv)) {
  loadDotenv({ path: rootEnv });
}

const nextConfig: NextConfig = {};
export default nextConfig;
