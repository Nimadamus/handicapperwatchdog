// Cloudflare Worker entry for the Watchdog Pro API. Routed on handicapperwatchdog.com/api/* so it shares the site's
// origin (first party cookie); every other path keeps going to the static site on GitHub Pages.
// KV namespace binding: HWD. Secrets: see docs/RELEASE.md.
import { handle } from './core.mjs';

export default {
  async fetch(request, env) {
    return handle(request, { ...env, KV: env.HWD }, { fetch });
  },
};
