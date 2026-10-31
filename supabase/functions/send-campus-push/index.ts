import webpush from "npm:web-push@3.6.7";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.118.0";

const allowedOrigins = new Set([
  "https://irgib-africa-badge.vercel.app",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
]);
const corsHeadersFor = (origin: string | null) => ({
  ...(origin && allowedOrigins.has(origin) ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } : {}),
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
});
const response = (status: number, body: Record<string, unknown>, origin: string | null) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeadersFor(origin), "Content-Type": "application/json" },
});
const isAllowedPushEndpoint = (raw: string) => {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    const allowedHost = host === "fcm.googleapis.com"
      || host.endsWith(".push.services.mozilla.com")
      || host.endsWith(".notify.windows.com")
      || host.endsWith(".push.apple.com");
    return url.protocol === "https:" && (url.port === "" || url.port === "443")
      && !url.username && !url.password && !url.hash && allowedHost;
  } catch { return false; }
};
const beninDate = () => {
  const fields = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Porto-Novo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date()).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
};

Deno.serve(async req => {
  const origin = req.headers.get("Origin");
  if (origin && !allowedOrigins.has(origin)) return response(403, { error: "Origine non autorisée." }, null);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeadersFor(origin) });
  if (req.method !== "POST") return response(405, { error: "Méthode non autorisée." }, origin);
  const authorization = req.headers.get("Authorization");
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!authorization || !url || !anonKey || !serviceKey) return response(401, { error: "Authentification requise." }, origin);
  if (!vapidPublic || !vapidPrivate) return response(503, { error: "Les notifications en arrière-plan ne sont pas encore configurées." }, origin);

  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return response(401, { error: "Session invalide." }, origin);
  const serviceClient = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  let event: Record<string, unknown>;
  try { event = await req.json(); }
  catch { return response(400, { error: "Requête invalide." }, origin); }

  let title = "";
  let body = "";
  let destination = "/etudiant/";
  let targetSite: string | null = null;
  let targetUser: string | null = null;
  let tag = "irgib-notification";

  if (event.kind === "announcement" && typeof event.id === "string") {
    const { data: announcement, error } = await serviceClient.from("campus_announcements")
      .select("id,title,body,site,published_by_site,status,published_at,expires_at")
      .eq("id", event.id).maybeSingle();
    if (error || !announcement || announcement.status !== "published" || !announcement.published_at || new Date(announcement.published_at) > new Date()) {
      return response(404, { error: "Actualité introuvable ou non publiée." }, origin);
    }
    const { data: globalAdmin } = await userClient.rpc("is_admin");
    const scopeSite = announcement.site || announcement.published_by_site;
    const { data: siteAdmin } = !globalAdmin && scopeSite
      ? await userClient.rpc("is_admin_for_site", { p_site: scopeSite })
      : { data: false };
    const allowed = Boolean(globalAdmin || siteAdmin);
    if (!allowed) return response(403, { error: "Vous ne pouvez pas notifier les destinataires de cette actualité." }, origin);
    if (announcement.expires_at && announcement.expires_at < beninDate()) return response(409, { error: "Cette actualité a expiré." }, origin);
    targetSite = announcement.site;
    title = "Nouvelle actualité IRGIB";
    body = announcement.title;
    tag = `campus-news-${announcement.id}`;
    destination = "/etudiant/#news";
  } else if (event.kind === "badge_approved" && typeof event.id === "string") {
    const { data: application, error } = await serviceClient.from("badge_applications")
      .select("id,student_id,site,status").eq("id", event.id).maybeSingle();
    if (error || !application || application.status !== "approved") return response(404, { error: "Approbation introuvable." }, origin);
    const { data: allowed } = await userClient.rpc("is_admin_for_site", { p_site: application.site });
    if (!allowed) return response(403, { error: "Vous ne pouvez pas notifier cet étudiant." }, origin);
    targetUser = application.student_id;
    title = "Votre badge IRGIB est approuvé";
    body = "Votre carte étudiante est disponible dans votre espace.";
    tag = `badge-approved-${application.id}`;
    destination = "/etudiant/#card";
  } else if (event.kind === "student_account_approved" && typeof event.id === "string") {
    const { data: student, error } = await serviceClient.from("student_profiles")
      .select("user_id,site,account_status,email_verified_at").eq("user_id", event.id).maybeSingle();
    if (error || !student || student.account_status !== "approved" || !student.email_verified_at) {
      return response(404, { error: "Compte étudiant confirmé introuvable." }, origin);
    }
    const { data: allowed } = await userClient.rpc("is_admin_for_site", { p_site: student.site });
    if (!allowed) return response(403, { error: "Vous ne pouvez pas notifier cet étudiant." }, origin);
    targetUser = student.user_id;
    title = "Votre compte étudiant IRGIB est confirmé";
    body = "Vous pouvez maintenant vous connecter et envoyer votre demande de badge.";
    tag = `student-account-approved-${student.user_id}`;
    destination = "/etudiant/";
  } else return response(400, { error: "Type de notification inconnu." }, origin);

  const subscriptionQuery = serviceClient.from("push_subscriptions").select("endpoint,user_id,p256dh,auth_secret");
  const { data: subscriptions, error: subscriptionError } = targetUser
    ? await subscriptionQuery.eq("user_id", targetUser)
    : targetSite ? await subscriptionQuery.eq("site", targetSite) : await subscriptionQuery;
  if (subscriptionError) return response(500, { error: "Impossible de charger les abonnements aux notifications." }, origin);
  if (!subscriptions?.length) return response(200, { sent: 0, message: "Aucun appareil n’a activé les notifications." }, origin);

  // Defend even if legacy rows bypass the new database constraint. Push endpoints
  // are server-side URLs, so an untrusted host would otherwise create an SSRF.
  const safeSubscriptions = subscriptions.filter(row => isAllowedPushEndpoint(row.endpoint));
  const userIds = [...new Set(safeSubscriptions.map(row => row.user_id))];
  if (!userIds.length) return response(200, { sent: 0, failed: 0 }, origin);
  const { data: profiles, error: profileError } = await serviceClient.from("student_profiles")
    .select("user_id,site,account_status,email_verified_at,banned_at,card_suspended_at")
    .in("user_id", userIds);
  if (profileError) return response(500, { error: "Impossible de vérifier les comptes destinataires." }, origin);
  const eligible = new Set((profiles || []).filter(profile =>
    profile.account_status === "approved" && profile.email_verified_at && !profile.banned_at && !profile.card_suspended_at
      && (targetUser ? profile.user_id === targetUser : !targetSite || profile.site === targetSite)
  ).map(profile => profile.user_id));
  const deliverable = safeSubscriptions.filter(row => eligible.has(row.user_id));
  if (!deliverable.length) return response(200, { sent: 0, failed: 0 }, origin);

  try { webpush.setVapidDetails("https://irgib-africa-badge.vercel.app/", vapidPublic, vapidPrivate); }
  catch { return response(503, { error: "La configuration des notifications est invalide." }, origin); }
  const payload = JSON.stringify({ title, body, tag, url: destination });
  let sent = 0;
  let failed = 0;
  const expired: string[] = [];
  await Promise.all(deliverable.map(async row => {
    try {
      await webpush.sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth_secret } }, payload);
      sent++;
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) expired.push(row.endpoint);
      else failed++;
    }
  }));
  if (expired.length) await serviceClient.from("push_subscriptions").delete().in("endpoint", expired);
  return response(200, { sent, failed }, origin);
});
