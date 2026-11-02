// Cloudflare Worker entry for the Watchdog Pro API. Routed on handicapperwatchdog.com/api/* so it shares the site's
// origin (first party cookie); every other path keeps going to the static site on GitHub Pages.
// KV namespace binding: HWD. Secrets: see docs/RELEASE.md.
import { handle } from './core.mjs';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      // Staging uses the worker's own origin so the cookie and checkout stay on that host.
      // Production keeps SITE_URL on handicapperwatchdog.com. BILLING_LIVE is never set here.
      const siteEnv = env.STAGING === 'yes' ? { ...env, SITE_URL: url.origin } : env;
      return handle(request, { ...siteEnv, KV: env.HWD }, { fetch });
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  },
};
