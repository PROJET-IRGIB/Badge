import { createClient } from "https://esm.sh/@supabase/supabase-js@2.118.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://irgib-africa-badge.vercel.app",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

async function listAllFiles(client: any, path: string): Promise<string[]> {
  const bucket = client.storage.from("student-photos");
  const { data, error } = await bucket.list(path, { limit: 1000 });
  if (error) throw error;
  const paths: string[] = [];
  for (const item of data || []) {
    const child = path ? `${path}/${item.name}` : item.name;
    if (item.id === null) paths.push(...await listAllFiles(client, child));
    else paths.push(child);
  }
  return paths;
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply(405, { error: "Méthode non autorisée." });

  const authorization = req.headers.get("Authorization");
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!authorization || !url || !anonKey || !serviceKey) return reply(503, { error: "Le service de gestion des comptes n’est pas configuré." });

  let input: unknown;
  try { input = await req.json(); }
  catch { return reply(400, { error: "Requête invalide." }); }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return reply(400, { error: "Requête invalide." });
  }
  const body = input as { action?: unknown; studentId?: unknown };
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof body.action !== "string" || !["ban", "unban", "delete"].includes(body.action)
      || typeof body.studentId !== "string" || !uuidPattern.test(body.studentId)) {
    return reply(400, { error: "Action ou identifiant étudiant invalide." });
  }

  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: authData, error: authError } = await userClient.auth.getUser();
  if (authError || !authData.user) return reply(401, { error: "Session administrateur invalide." });
  const serviceClient = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: profile, error: profileError } = await serviceClient.from("student_profiles")
    .select("user_id,site,first_name,last_name,banned_at").eq("user_id", body.studentId).maybeSingle();
  if (profileError || !profile) return reply(404, { error: "Étudiant introuvable." });

  const { data: globalAdmin, error: globalError } = await serviceClient.from("admin_members")
    .select("user_id").eq("user_id", body.studentId).maybeSingle();
  const { data: siteAdmin, error: siteAdminError } = await serviceClient.from("admin_site_members")
    .select("user_id").eq("user_id", body.studentId).maybeSingle();
  if (globalError || siteAdminError) return reply(500, { error: "Impossible de vérifier le compte ciblé." });
  if (globalAdmin || siteAdmin) return reply(403, { error: "Un compte administrateur ne peut pas être géré comme un compte étudiant." });

  const { data: allowed, error: accessError } = await userClient.rpc("is_admin_for_site", { p_site: profile.site });
  if (accessError || !allowed) return reply(403, { error: "Votre compte administrateur n’est pas autorisé sur le site de cet étudiant." });

  if (body.action === "ban") {
    const bannedAt = new Date().toISOString();
    const reason = "Banni par l’administration de son établissement.";
    const { error: updateError } = await serviceClient.from("student_profiles").update({
      banned_at: bannedAt, banned_by: authData.user.id, ban_reason: reason,
    }).eq("user_id", body.studentId);
    if (updateError) return reply(500, { error: "Le statut de bannissement n’a pas pu être enregistré." });

    const { error: banError } = await serviceClient.auth.admin.updateUserById(body.studentId, { ban_duration: "876000h" });
    if (banError) {
      await serviceClient.from("student_profiles").update({ banned_at: null, banned_by: null, ban_reason: null }).eq("user_id", body.studentId);
      return reply(500, { error: "Le statut est enregistré mais la fermeture de l’accès Supabase a échoué. Réessayez." });
    }
    await serviceClient.from("push_subscriptions").delete().eq("user_id", body.studentId);
    return reply(200, { ok: true, action: "ban" });
  }

  if (body.action === "unban") {
    if (!profile.banned_at) return reply(409, { error: "Ce compte n’est pas actuellement banni." });
    const { error: unbanError } = await serviceClient.auth.admin.updateUserById(body.studentId, { ban_duration: "none" });
    if (unbanError) return reply(500, { error: "Le bannissement Supabase n’a pas pu être levé." });
    const { error: profileError } = await serviceClient.from("student_profiles").update({
      banned_at: null, banned_by: null, ban_reason: null,
    }).eq("user_id", body.studentId);
    if (profileError) {
      await serviceClient.auth.admin.updateUserById(body.studentId, { ban_duration: "876000h" });
      return reply(500, { error: "Le bannissement Auth a été levé, mais le statut du compte n’a pas pu être actualisé. Réessayez." });
    }
    return reply(200, { ok: true, action: "unban" });
  }

  // Revoke sign-in first, then remove personal records and owned photos. If a later
  // cleanup step fails, the account remains blocked and an administrator can retry.
  const { error: banError } = await serviceClient.auth.admin.updateUserById(body.studentId, { ban_duration: "876000h" });
  if (banError) return reply(500, { error: "La désactivation préalable du compte a échoué." });
  await serviceClient.from("student_profiles").update({ banned_at: new Date().toISOString(), banned_by: authData.user.id, ban_reason: "Compte en cours de suppression." }).eq("user_id", body.studentId);
  try {
    const files = await listAllFiles(serviceClient, body.studentId);
    if (files.length) {
      const { error } = await serviceClient.storage.from("student-photos").remove(files);
      if (error) return reply(500, { error: "Le compte est bloqué, mais ses photos n’ont pas pu être supprimées." });
    }
    const removals = [
      await serviceClient.from("attendance_records").delete().eq("student_id", body.studentId),
      await serviceClient.from("badge_applications").delete().eq("student_id", body.studentId),
      await serviceClient.from("class_representatives").delete().eq("user_id", body.studentId),
      await serviceClient.from("push_subscriptions").delete().eq("user_id", body.studentId),
    ];
    if (removals.some(result => result.error)) return reply(500, { error: "Le compte est bloqué, mais le nettoyage de ses données est incomplet. Réessayez." });
    const { error: deleteError } = await serviceClient.auth.admin.deleteUser(body.studentId);
    if (deleteError) return reply(500, { error: "Le compte est bloqué, mais Supabase n’a pas pu supprimer l’utilisateur. Réessayez." });
    return reply(200, { ok: true, action: "delete" });
  } catch (error) {
    console.error("Account cleanup failed");
    return reply(500, { error: "Le compte est bloqué, mais le nettoyage n’a pas pu aboutir. Réessayez." });
  }
});
