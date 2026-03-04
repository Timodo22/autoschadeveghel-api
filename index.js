const corsHeaders = {
  'Access-Control-Allow-Origin': '*', 
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const BAD_WORDS = ['spam', 'klootzak', 'slechte', 'koop nu', 'crypto', 'http://', 'https://', 'www.', 'viagra', 'casino'];

export default {
  async fetch(request, env) {
    // 1. Laat alle verbindingen van buitenaf toe (CORS)
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // 2. ROOT CHECK: Zodat je in je browser ziet dat hij online is!
    if (request.method === 'GET' && url.pathname === '/') {
      return new Response(JSON.stringify({ status: "Autoschade API is online en klaar voor gebruik!" }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. GET /reviews - Haal alle reviews op
    if (request.method === 'GET' && url.pathname === '/reviews') {
      try {
        if (!env.DB) {
          return new Response(JSON.stringify({ error: "Database niet gekoppeld. Mis je de binding='DB' in wrangler.toml?" }), { status: 500, headers: corsHeaders });
        }
        
        const { results } = await env.DB.prepare(
          "SELECT id, name, text, rating, created_at FROM reviews WHERE status = 'approved' ORDER BY created_at DESC"
        ).all();

        return new Response(JSON.stringify(results), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: `Database Fout bij ophalen: ${e.message}` }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    // 4. POST /reviews - Nieuwe review plaatsen
    if (request.method === 'POST' && url.pathname === '/reviews') {
      try {
        if (!env.DB) {
          return new Response(JSON.stringify({ error: "Database niet gekoppeld. Mis je de binding='DB' in wrangler.toml?" }), { status: 500, headers: corsHeaders });
        }

        const body = await request.json();
        const { name, text, rating } = body;
        const ipAddress = request.headers.get('cf-connecting-ip') || 'unknown';

        if (!name || !text || !rating || rating < 1 || rating > 5) {
          return new Response(JSON.stringify({ error: 'Vul alle velden correct in.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        const textLower = text.toLowerCase();
        const containsBadWords = BAD_WORDS.some(word => textLower.includes(word));
        if (containsBadWords) {
          return new Response(JSON.stringify({ error: 'Je bericht bevat niet-toegestane woorden of links.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        const totalReviewsCheck = await env.DB.prepare(
          "SELECT COUNT(*) as count FROM reviews WHERE ip_address = ?"
        ).bind(ipAddress).first();
        
        if (totalReviewsCheck && totalReviewsCheck.count >= 3) {
          return new Response(JSON.stringify({ error: 'Je hebt het maximum aantal reviews (3) voor dit IP bereikt.' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        const recentReviewCheck = await env.DB.prepare(
          "SELECT created_at FROM reviews WHERE ip_address = ? ORDER BY created_at DESC LIMIT 1"
        ).bind(ipAddress).first();

        if (recentReviewCheck) {
          const lastReviewTime = new Date(recentReviewCheck.created_at).getTime();
          const oneHourAgo = Date.now() - (60 * 60 * 1000);
          
          if (lastReviewTime > oneHourAgo) {
            return new Response(JSON.stringify({ error: 'Je kunt maar 1 review per uur plaatsen. Probeer het later opnieuw.' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          }
        }

        await env.DB.prepare(
          "INSERT INTO reviews (name, text, rating, ip_address, status) VALUES (?, ?, ?, ?, 'approved')"
        ).bind(name, text, rating, ipAddress).run();

        return new Response(JSON.stringify({ success: 'Bedankt! Je review is geplaatst.' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });

      } catch (e) {
        return new Response(JSON.stringify({ error: `Server Fout bij opslaan: ${e.message}` }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    return new Response(JSON.stringify({ error: "Verkeerde URL, gebruik /reviews" }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  },
};
