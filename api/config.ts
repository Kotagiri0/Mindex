import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
  const googleClientId = process.env.VITE_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;

  console.log(`[API] Serving config: URL=${supabaseUrl ? 'Set' : 'Not Set'}, Key=${supabaseAnonKey ? 'Set' : 'Not Set'}, Google=${googleClientId ? 'Set' : 'Not Set'}`);

  res.status(200).json({
    supabaseUrl,
    supabaseAnonKey,
    googleClientId,
  });
}
