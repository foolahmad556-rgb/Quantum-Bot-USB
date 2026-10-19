// Run only against the intended backend; values are supplied securely via process env.
const base = new URL(process.env.API_BASE_URL || 'http://127.0.0.1:3000');
if (base.protocol !== 'https:' && !['127.0.0.1','localhost'].includes(base.hostname)) throw new Error('HTTPS required');
for (const key of ['OPERATOR_SECRET','USER_EMAIL','USER_PASSWORD']) if (!process.env[key]) throw new Error(`${key} required`);
const response = await fetch(new URL('/api/auth/register',base), { method:'POST',
  headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.OPERATOR_SECRET}`},
  body:JSON.stringify({email:process.env.USER_EMAIL,password:process.env.USER_PASSWORD}), signal:AbortSignal.timeout(10000),
});
if(!response.ok) throw new Error(`Account provisioning failed (${response.status}); verify ADMIN_EMAILS and password requirements`);
// The returned JWT is intentionally not printed or stored.
console.log('Operator account created. Sign in through the configured dashboard.');
