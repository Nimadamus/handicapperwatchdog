// Cloudflare Pages Function: every /api/* request goes to backend/core.mjs. KV namespace binding name: HWD.
import { handle } from '../../backend/core.mjs';

export async function onRequest(ctx) {
  return handle(ctx.request, { ...ctx.env, KV: ctx.env.HWD }, { fetch });
}
