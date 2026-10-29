import webpush from "npm:web-push@3.6.7";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.118.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const response = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});
const beninDate = () => {
  const fields = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Porto-Novo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date()).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
};

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return response(405, { error: "Méthode non autorisée." });
  const authorization = req.headers.get("Authorization");
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!authorization || !url || !anonKey || !serviceKey) return response(401, { error: "Authentification requise." });
  if (!vapidPublic || !vapidPrivate) return response(503, { error: "Les notifications en arrière-plan ne sont pas encore configurées." });

  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return response(401, { error: "Session invalide." });
  const serviceClient = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  let event: Record<string, unknown>;
  try { event = await req.json(); }
  catch { return response(400, { error: "Requête invalide." }); }

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
      return response(404, { error: "Actualité introuvable ou non publiée." });
    }
    const { data: globalAdmin } = await userClient.rpc("is_admin");
    const scopeSite = announcement.site || announcement.published_by_site;
    const { data: siteAdmin } = !globalAdmin && scopeSite
      ? await userClient.rpc("is_admin_for_site", { p_site: scopeSite })
      : { data: false };
    const allowed = Boolean(globalAdmin || siteAdmin);
    if (!allowed) return response(403, { error: "Vous ne pouvez pas notifier les destinataires de cette actualité." });
    if (announcement.expires_at && announcement.expires_at < beninDate()) return response(409, { error: "Cette actualité a expiré." });
    targetSite = announcement.site;
    title = "Nouvelle actualité IRGIB";
    body = announcement.title;
    tag = `campus-news-${announcement.id}`;
    destination = "/etudiant/#news";
  } else if (event.kind === "badge_approved" && typeof event.id === "string") {
    const { data: application, error } = await serviceClient.from("badge_applications")
      .select("id,student_id,site,status").eq("id", event.id).maybeSingle();
    if (error || !application || application.status !== "approved") return response(404, { error: "Approbation introuvable." });
    const { data: allowed } = await userClient.rpc("is_admin_for_site", { p_site: application.site });
    if (!allowed) return response(403, { error: "Vous ne pouvez pas notifier cet étudiant." });
    targetUser = application.student_id;
    title = "Votre badge IRGIB est approuvé";
    body = "Votre carte étudiante est disponible dans votre espace.";
    tag = `badge-approved-${application.id}`;
    destination = "/etudiant/#card";
  } else if (event.kind === "student_account_approved" && typeof event.id === "string") {
    const { data: student, error } = await serviceClient.from("student_profiles")
      .select("user_id,site,account_status,email_verified_at").eq("user_id", event.id).maybeSingle();
    if (error || !student || student.account_status !== "approved" || !student.email_verified_at) {
      return response(404, { error: "Compte étudiant confirmé introuvable." });
    }
    const { data: allowed } = await userClient.rpc("is_admin_for_site", { p_site: student.site });
    if (!allowed) return response(403, { error: "Vous ne pouvez pas notifier cet étudiant." });
    targetUser = student.user_id;
    title = "Votre compte étudiant IRGIB est confirmé";
    body = "Vous pouvez maintenant vous connecter et envoyer votre demande de badge.";
    tag = `student-account-approved-${student.user_id}`;
    destination = "/etudiant/";
  } else return response(400, { error: "Type de notification inconnu." });

  const subscriptionQuery = serviceClient.from("push_subscriptions").select("endpoint,user_id,p256dh,auth_secret");
  const { data: subscriptions, error: subscriptionError } = targetUser
    ? await subscriptionQuery.eq("user_id", targetUser)
    : targetSite ? await subscriptionQuery.eq("site", targetSite) : await subscriptionQuery;
  if (subscriptionError) return response(500, { error: "Impossible de charger les abonnements aux notifications." });
  if (!subscriptions?.length) return response(200, { sent: 0, message: "Aucun appareil n’a activé les notifications." });

  try { webpush.setVapidDetails("https://irgib-africa-badge.vercel.app/", vapidPublic, vapidPrivate); }
  catch { return response(503, { error: "La configuration des notifications est invalide." }); }
  const payload = JSON.stringify({ title, body, tag, url: destination });
  let sent = 0;
  let failed = 0;
  const expired: string[] = [];
  await Promise.all(subscriptions.map(async row => {
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
  return response(200, { sent, failed });
});
