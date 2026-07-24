export async function onRequestPost(context) {
  // Alle Headers explizit weiterleiten inkl. X-App-Password
  const originalRequest = context.request;
  const headers = new Headers(originalRequest.headers);
  
  const newRequest = new Request(originalRequest, {
    headers: headers,
  });
  
  return context.env.RAUSZEIT_WORKER.fetch(newRequest);
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
