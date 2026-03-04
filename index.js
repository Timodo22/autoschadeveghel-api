export interface Env {
  DB: D1Database;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://autoschade-veghel.nl/','https://wwww.autoschade-veghel.nl/', // Tip: Verander '*' naar jouw echte domeinnaam als je live gaat
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const BAD_WORDS = [
  // Scheldwoorden
  'klootzak','lul','eikel','idioot','dom','achterlijk','mongool',
  'tering','tyfus','kanker','hoer','slet','sukkel','debiel',
  'stom wijf','stomme','rotbedrijf','oplichters','oplichting',
  'nepbedrijf','waardeloos','klote','klotezooi','nigger',

  // Haatdragend
  'racist','nazi','hitler','kk','homo','joden','moslims',
  'zwarte','blanke','buitenlander','kut buitenlanders',

  // Spam
  'koop nu','nu kopen','gratis','100% gratis','win geld',
  'verdien geld','snel rijk','crypto','bitcoin','forex',
  'casino','gokken','betting','korting','actie','aanbieding',
  'klik hier','link in bio','volg mij','dm mij',
  'whatsapp mij','telegram','onlyfans',

  // Links
  'http://','https://','www.','.com','.ru','.xyz','.top','.click','.info',

  // Ongepast
  'porno','sex','seks','naakt','pik','kut','masturberen','escort'
];

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // GET /reviews - Haal alleen goedgekeurde reviews op
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

    // POST /reviews - Nieuwe review toevoegen
    if (request.method === 'POST' && url.pathname === '/reviews') {
      try {
        const body: any = await request.json();
        const { name, text, rating } = body;
        const ipAddress = request.headers.get('cf-connecting-ip') || 'unknown';

        // 1. Validatie
        if (!name || !text || !rating || rating < 1 || rating > 5) {
          return new Response(JSON.stringify({ error: 'Vul alle velden correct in.' }), { status: 400, headers: corsHeaders });
        }

        // 2. Woordenfilter check
        const textLower = text.toLowerCase();
        const containsBadWords = BAD_WORDS.some(word => textLower.includes(word));
        if (containsBadWords) {
          return new Response(JSON.stringify({ error: 'Je bericht bevat niet-toegestane woorden of links.' }), { status: 400, headers: corsHeaders });
        }

        // 3. Spam check: Max 3 reviews per IP
        const ipCheck = await env.DB.prepare(
          "SELECT COUNT(*) as count FROM reviews WHERE ip_address = ?"
        ).bind(ipAddress).first();
        
        if (ipCheck && (ipCheck as any).count >= 3) {
          return new Response(JSON.stringify({ error: 'Je hebt het maximum aantal reviews voor dit IP-adres bereikt.' }), { status: 429, headers: corsHeaders });
        }

        // 4. Opslaan in database met status 'pending'
        await env.DB.prepare(
          "INSERT INTO reviews (name, text, rating, ip_address, status) VALUES (?, ?, ?, ?, 'pending')"
        ).bind(name, text, rating, ipAddress).run();

        return new Response(JSON.stringify({ success: 'Review succesvol geplaatst! Na controle wordt deze zichtbaar.' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });

      } catch (e) {
        return new Response(JSON.stringify({ error: 'Er ging iets mis bij het verwerken van je aanvraag.' }), { status: 500, headers: corsHeaders });
      }
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });
  },
};
