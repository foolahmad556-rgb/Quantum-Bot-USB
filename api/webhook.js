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

/**
 * Constant-time string comparison to prevent timing attacks on webhook secrets.
 */
function constantTimeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Validate incoming webhook signal payload.
 * Returns null if valid, or an error message string if invalid.
 */
function validateSignal(signal) {
  if (!signal || typeof signal !== 'object') return 'Invalid payload: expected a JSON object';
  if (typeof signal.symbol !== 'string' || signal.symbol.trim().length === 0 || signal.symbol.length > 32) {
    return 'Invalid payload: symbol must be a non-empty string (max 32 chars)';
  }
  if (typeof signal.action !== 'string' || !['BUY', 'SELL', 'HOLD'].includes(signal.action.toUpperCase())) {
    return 'Invalid payload: action must be one of BUY, SELL, HOLD';
  }
  if (signal.price !== undefined && (typeof signal.price !== 'number' || !Number.isFinite(signal.price) || signal.price < 0)) {
    return 'Invalid payload: price must be a non-negative number';
  }
  return null;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

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
    throw new Error('Google OAuth token request failed');
  }
  return tokenData.access_token;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === '/health' || url.pathname === '/') {
      return new Response('Quantum-Bot Webhook Active (Firebase Native)', {
        headers: { 'Content-Type': 'text/plain', ...CORS_HEADERS }
      });
    }

    if (url.pathname === '/webhook' && request.method === 'POST') {
      try {
        const auth = request.headers.get('Authorization');
        const expected = `Bearer ${env.WEBHOOK_SECRET}`;
        if (!auth || !constantTimeCompare(auth, expected)) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
          });
        }

        const signal = await request.json();
        const validationError = validateSignal(signal);
        if (validationError) {
          return new Response(JSON.stringify({ error: validationError }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
          });
        }

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
              symbol: { stringValue: String(signal.symbol || 'UNKNOWN').toUpperCase().slice(0, 32) },
              action: { stringValue: String(signal.action || 'HOLD').toUpperCase() },
              price: { doubleValue: Number(signal.price) || 0 },
              timestamp: { TimestampValue: new Date().toISOString() },
              raw: { stringValue: JSON.stringify(signal) }
            }
          })
        });

        const firestoreData = await firestoreRes.json();
        if (!firestoreRes.ok) {
          throw new Error('Firestore write failed');
        }

        return new Response(JSON.stringify({ status: 'ok', data: firestoreData }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: 'Internal server error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
        });
      }
    }

    return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
  }
};
