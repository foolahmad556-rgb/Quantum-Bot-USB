function pemToArrayBuffer(pem) {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function base64UrlEncode(str) {
  return btoa(str)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function bufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return base64UrlEncode(binary);
}

async function getGoogleAuthToken(credentials) {
  const keyBuffer = pemToArrayBuffer(credentials.private_key);
  const key = await crypto.subtle.importKey(
    'pkcs8',
    keyBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const claimSet = base64UrlEncode(JSON.stringify({
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  }));

  const textToSign = `${header}.${claimSet}`;
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(textToSign)
  );

  const signatureBase64 = bufferToBase64Url(signature);
  const jwt = `${textToSign}.${signatureBase64}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });

  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || !tokenData.access_token) {
    throw new Error(`Google OAuth error: ${JSON.stringify(tokenData)}`);
  }
  return tokenData.access_token;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health' || url.pathname === '/') {
      return new Response('Quantum-Bot Webhook Active (Firebase Native)', {
        headers: { 'Content-Type': 'text/plain' }
      });
    }

    if (url.pathname === '/webhook' && request.method === 'POST') {
      try {
        const auth = request.headers.get('Authorization');
        const secret = env.WEBHOOK_SECRET;
        if (!secret) {
          return new Response(JSON.stringify({ error: 'Webhook secret not configured' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        if (!auth || auth !== `Bearer ${secret}`) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        const signal = await request.json();
        const creds = JSON.parse(env.FIREBASE_CREDENTIALS_JSON || '{}');
        if (!creds.client_email || !creds.private_key || !creds.project_id) {
          throw new Error('Missing or invalid FIREBASE_CREDENTIALS_JSON');
        }

        const accessToken = await getGoogleAuthToken(creds);
        const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${creds.project_id}/databases/(default)/documents/signals`;

        const firestoreRes = await fetch(firestoreUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            fields: {
              symbol: { stringValue: String(signal.symbol || 'UNKNOWN') },
              action: { stringValue: String(signal.action || 'HOLD') },
              price: { doubleValue: Number(signal.price) || 0 },
              timestamp: { timestampValue: new Date().toISOString() },
              raw: { stringValue: JSON.stringify(signal) }
            }
          })
        });

        const firestoreData = await firestoreRes.json();
        if (!firestoreRes.ok) {
          throw new Error(`Firestore error: ${JSON.stringify(firestoreData)}`);
        }

        return new Response(JSON.stringify({ status: 'ok', data: firestoreData }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    return new Response('Not Found', { status: 404 });
  }
};
