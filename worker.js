// Cloudflare Pages Functions — leitet /api/venues an den rauszeit-worker weiter
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // /api/venues → rauszeit-worker
    if (url.pathname === '/api/venues') {
      return env.RAUSZEIT_WORKER.fetch(request);
    }

    // Alles andere → normale Pages-Datei ausliefern
    return env.ASSETS.fetch(request);
  },
};
