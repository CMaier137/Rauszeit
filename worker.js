// Cloudflare Pages Functions — leitet /api/venues an den rauszeit-worker weiter
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
 
    if (url.pathname === '/api/venues' && request.method === 'POST') {
      return env.RAUSZEIT_WORKER.fetch(request);
    }
 
    // Alles andere → normale Pages-Assets
    return env.ASSETS.fetch(request);
  },
};
 
