// Cloudflare Pages Function for api.handicapperwatchdog.com: every /api/* request goes to the shared core.
import { handle } from '../../../backend/core.mjs';
export const onRequest = ({ request, env }) => handle(request, { ...env, KV: env.HWD }, { fetch: (...a) => fetch(...a) });
