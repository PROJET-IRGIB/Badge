import { createClient } from "https://esm.sh/@supabase/supabase-js@2.118.0";

const allowedOrigins = new Set([
  "https://irgib-africa-badge.vercel.app",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
]);
const cors = (origin: string | null) => ({
  ...(origin && allowedOrigins.has(origin) ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } : {}),
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
});
const reply = (status: number, body: Record<string, unknown>, origin: string | null) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "Content-Type": "application/json" } });

Deno.serve(async req => {
  const origin = req.headers.get("Origin");
  if (origin && !allowedOrigins.has(origin)) return reply(403, { error: "Origine non autorisée." }, null);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return reply(405, { error: "Méthode non autorisée." }, origin);
  const authorization = req.headers.get("Authorization");
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!authorization || !url || !anonKey || !serviceKey) return reply(401, { error: "Authentification requise." }, origin);

  let body: unknown;
  try { body = await req.json(); } catch { return reply(400, { error: "Requête invalide." }, origin); }
  const pin = body && typeof body === "object" && !Array.isArray(body) ? (body as { pin?: unknown }).pin : null;
  if (typeof pin !== "string" || !/^\d{4}$/.test(pin)) return reply(400, { error: "Saisissez le code secret à 4 chiffres." }, origin);

  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return reply(401, { error: "Session invalide." }, origin);
  const serviceClient = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await serviceClient.rpc("verify_representative_daily_qr", {
    p_user_id: authData.user.id,
    p_pin: pin,
  });
  if (error) {
    console.error("Representative QR verification failed");
    return reply(500, { error: "Le QR du jour n’a pas pu être vérifié." }, origin);
  }
  if (!data?.ok) return reply(403, { error: data?.message || "Le code ne permet pas d’afficher le QR." }, origin);
  return reply(200, data, origin);
});
