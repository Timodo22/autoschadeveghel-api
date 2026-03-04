export interface Env {
  DB: D1Database;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://autoschade-veghel.nl/','https://www.autoschade-veghel.nl', // Verander dit later naar 'https://jouwwebsite.nl'
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Breid deze lijst uit met typische spam-woorden
const BAD_WORDS = ['spam', 'klootzak', 'slechte', 'koop nu', 'crypto', 'http://', 'https://', 'www.', 'viagra', 'casino'];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // GET: Haal alle goedgekeurde reviews op (nieuwste eerst)
    if (request.method === 'GET' && url.pathname === '/reviews') {
      try {
        const { results } = await env.DB.prepare(
          "SELECT id, name, text, rating, created_at FROM reviews WHERE status = 'approved' ORDER BY created_at DESC"
        ).all();

        return new Response(JSON.stringify(results), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (e) {
        return new Response('Database Error', { status: 500, headers: corsHeaders });
      }
    }

    // POST: Nieuwe review opslaan (met automatische goedkeuring)
    if (request.method === 'POST' && url.pathname === '/reviews') {
      try {
        const body: any = await request.json();
        const { name, text, rating } = body;
        const ipAddress = request.headers.get('cf-connecting-ip') || 'unknown';

        // 1. Basis validatie
        if (!name || !text || !rating || rating < 1 || rating > 5) {
          return new Response(JSON.stringify({ error: 'Vul alle velden correct in.' }), { status: 400, headers: corsHeaders });
        }

        // 2. Woordenfilter (Spam/Scheldwoorden)
        const textLower = text.toLowerCase();
        const containsBadWords = BAD_WORDS.some(word => textLower.includes(word));
        if (containsBadWords) {
          return new Response(JSON.stringify({ error: 'Je bericht bevat niet-toegestane woorden of links.' }), { status: 400, headers: corsHeaders });
        }

        // 3. Totale IP limiet: Max 3 reviews per IP in totaal
        const totalReviewsCheck = await env.DB.prepare(
          "SELECT COUNT(*) as count FROM reviews WHERE ip_address = ?"
        ).bind(ipAddress).first();
        
        if (totalReviewsCheck && (totalReviewsCheck as any).count >= 3) {
          return new Response(JSON.stringify({ error: 'Je hebt het maximum aantal reviews (3) voor dit netwerk bereikt.' }), { status: 429, headers: corsHeaders });
        }

        // 4. Rate Limiting: Max 1 review per uur per IP (tegen spam-bots)
        const recentReviewCheck = await env.DB.prepare(
          "SELECT created_at FROM reviews WHERE ip_address = ? ORDER BY created_at DESC LIMIT 1"
        ).bind(ipAddress).first();

        if (recentReviewCheck) {
          const lastReviewTime = new Date((recentReviewCheck as any).created_at).getTime();
          const oneHourAgo = Date.now() - (60 * 60 * 1000);
          
          if (lastReviewTime > oneHourAgo) {
            return new Response(JSON.stringify({ error: 'Je kunt maar 1 review per uur plaatsen. Probeer het later opnieuw.' }), { status: 429, headers: corsHeaders });
          }
        }

        // 5. Alles is veilig! Sla direct op als 'approved'
        await env.DB.prepare(
          "INSERT INTO reviews (name, text, rating, ip_address, status) VALUES (?, ?, ?, ?, 'approved')"
        ).bind(name, text, rating, ipAddress).run();

        return new Response(JSON.stringify({ success: 'Bedankt! Je review is succesvol geplaatst en direct zichtbaar.' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });

      } catch (e) {
        return new Response(JSON.stringify({ error: 'Er ging iets mis op de server. Probeer het later nog eens.' }), { status: 500, headers: corsHeaders });
      }
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });
  },
};
