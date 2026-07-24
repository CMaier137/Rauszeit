export async function onRequestPost(context) {
  return context.env.RAUSZEIT_WORKER.fetch(context.request);
}

export async function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-App-Password',
    },
  });
}
