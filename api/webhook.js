// Legacy worker entrypoint now uses the same Telegram/D1 ingress contract.
import { telegramIngress } from './telegram-ingress.js';
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/health') return new Response('alive');
    if (path === '/webhook/telegram' || path === '/webhook') return telegramIngress(request, env);
    return new Response('Not Found', { status: 404 });
  },
};
