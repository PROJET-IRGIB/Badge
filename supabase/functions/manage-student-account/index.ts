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
  const paths: string[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await bucket.list(path, { limit: pageSize, offset });
    if (error) throw error;
    for (const item of data || []) {
      const child = path ? `${path}/${item.name}` : item.name;
      if (item.id === null) paths.push(...await listAllFiles(client, child));
      else paths.push(child);
    }
    if (!data || data.length < pageSize) break;
  }
  return paths;
}

async function recordAccountAction(client: any, site: string, actorId: string, studentId: string, action: string, details: Record<string, unknown>) {
  try {
    const { error } = await client.from("admin_action_log").insert({
      site,
      actor_id: actorId,
      subject_id: studentId,
      action,
      details: { source: "student-account-management", ...details },
    });
    if (error) {
      console.error("Account action audit log could not be written");
      return false;
    }
    return true;
  } catch {
    console.error("Account action audit log could not be written");
    return false;
  }
}

async function actionFailure(client: any, site: string, actorId: string, studentId: string, action: string, step: string, message: string, status = 500, details: Record<string, unknown> = {}) {
  const auditLogged = await recordAccountAction(client, site, actorId, studentId, action, { outcome: "failed", step, ...details });
  return reply(status, { error: message, auditLogged, auditWarning: !auditLogged });
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

  try {
  if (body.action === "ban") {
    const action = "student_account_banned";
    const bannedAt = new Date().toISOString();
    const reason = "Banni par l’administration de son établissement.";
    const { error: updateError } = await serviceClient.from("student_profiles").update({
      banned_at: bannedAt, banned_by: authData.user.id, ban_reason: reason,
    }).eq("user_id", body.studentId);
    if (updateError) return await actionFailure(serviceClient, profile.site, authData.user.id, body.studentId, action, "profile_ban", "Le statut de bannissement n’a pas pu être enregistré.");

    const { error: banError } = await serviceClient.auth.admin.updateUserById(body.studentId, { ban_duration: "876000h" });
    if (banError) {
      const { error: rollbackError } = await serviceClient.from("student_profiles").update({ banned_at: null, banned_by: null, ban_reason: null }).eq("user_id", body.studentId);
      return await actionFailure(serviceClient, profile.site, authData.user.id, body.studentId, action, "auth_ban", "Le statut est enregistré mais la fermeture de l’accès Supabase a échoué. Réessayez.", 500, { profileRollback: rollbackError ? "failed" : "completed" });
    }
    const { error: representativeError } = await serviceClient.from("class_representatives").delete().eq("user_id", body.studentId);
    if (representativeError) return await actionFailure(serviceClient, profile.site, authData.user.id, body.studentId, action, "remove_representative", "Le compte est banni, mais le rôle de responsable n’a pas pu être retiré. Réessayez.", 500, { accountBan: "completed" });
    const { error: pushError } = await serviceClient.from("push_subscriptions").delete().eq("user_id", body.studentId);
    const auditLogged = await recordAccountAction(serviceClient, profile.site, authData.user.id, body.studentId, action, {
      outcome: pushError ? "partial" : "completed",
      ...(pushError ? { step: "remove_push_subscriptions", accountBan: "completed" } : {}),
    });
    return reply(200, { ok: true, action: "ban", auditLogged, auditWarning: !auditLogged });
  }

  if (body.action === "unban") {
    const action = "student_account_unbanned";
    if (!profile.banned_at) return await actionFailure(serviceClient, profile.site, authData.user.id, body.studentId, action, "validate_status", "Ce compte n’est pas actuellement banni.", 409);
    const { error: unbanError } = await serviceClient.auth.admin.updateUserById(body.studentId, { ban_duration: "none" });
    if (unbanError) return await actionFailure(serviceClient, profile.site, authData.user.id, body.studentId, action, "auth_unban", "Le bannissement Supabase n’a pas pu être levé.");
    const { error: profileError } = await serviceClient.from("student_profiles").update({
      banned_at: null, banned_by: null, ban_reason: null,
    }).eq("user_id", body.studentId);
    if (profileError) {
      const { error: rollbackError } = await serviceClient.auth.admin.updateUserById(body.studentId, { ban_duration: "876000h" });
      return await actionFailure(serviceClient, profile.site, authData.user.id, body.studentId, action, "profile_unban", "Le bannissement Auth a été levé, mais le statut du compte n’a pas pu être actualisé. Réessayez.", 500, { authRollback: rollbackError ? "failed" : "completed" });
    }
    const auditLogged = await recordAccountAction(serviceClient, profile.site, authData.user.id, body.studentId, action, { outcome: "completed" });
    return reply(200, { ok: true, action: "unban", auditLogged, auditWarning: !auditLogged });
  }

  // Revoke sign-in first, then remove personal records and owned photos. If a later
  // cleanup step fails, the account remains blocked and an administrator can retry.
  const action = "student_account_deleted";
  const { error: banError } = await serviceClient.auth.admin.updateUserById(body.studentId, { ban_duration: "876000h" });
  if (banError) return await actionFailure(serviceClient, profile.site, authData.user.id, body.studentId, action, "auth_ban", "La désactivation préalable du compte a échoué.");
  const { error: blockError } = await serviceClient.from("student_profiles").update({ banned_at: new Date().toISOString(), banned_by: authData.user.id, ban_reason: "Compte en cours de suppression." }).eq("user_id", body.studentId);
  try {
    const files = await listAllFiles(serviceClient, body.studentId);
    if (files.length) {
      const { error } = await serviceClient.storage.from("student-photos").remove(files);
      if (error) return await actionFailure(serviceClient, profile.site, authData.user.id, body.studentId, action, "remove_photos", "Le compte est bloqué, mais ses photos n’ont pas pu être supprimées.", 500, { accountBlocked: blockError ? "partial" : "completed" });
    }
    const removals = [
      await serviceClient.from("attendance_records").delete().eq("student_id", body.studentId),
      await serviceClient.from("badge_applications").delete().eq("student_id", body.studentId),
      await serviceClient.from("class_representatives").delete().eq("user_id", body.studentId),
      await serviceClient.from("push_subscriptions").delete().eq("user_id", body.studentId),
    ];
    if (removals.some(result => result.error)) return await actionFailure(serviceClient, profile.site, authData.user.id, body.studentId, action, "remove_records", "Le compte est bloqué, mais le nettoyage de ses données est incomplet. Réessayez.", 500, { accountBlocked: blockError ? "partial" : "completed" });
    const { error: deleteError } = await serviceClient.auth.admin.deleteUser(body.studentId);
    if (deleteError) return await actionFailure(serviceClient, profile.site, authData.user.id, body.studentId, action, "delete_auth_user", "Le compte est bloqué, mais Supabase n’a pas pu supprimer l’utilisateur. Réessayez.", 500, { accountBlocked: blockError ? "partial" : "completed" });
    const auditLogged = await recordAccountAction(serviceClient, profile.site, authData.user.id, body.studentId, action, { outcome: blockError ? "partial" : "completed", ...(blockError ? { step: "mark_profile_banned" } : {}) });
    return reply(200, { ok: true, action: "delete", auditLogged, auditWarning: !auditLogged });
  } catch (error) {
    console.error("Account cleanup failed");
    return await actionFailure(serviceClient, profile.site, authData.user.id, body.studentId, action, "cleanup_exception", "Le compte est bloqué, mais le nettoyage n’a pas pu aboutir. Réessayez.", 500, { accountBlocked: blockError ? "partial" : "completed" });
  }
  } catch {
    const action = body.action === "ban" ? "student_account_banned" : body.action === "unban" ? "student_account_unbanned" : "student_account_deleted";
    const message = body.action === "ban"
      ? "Le statut de bannissement n’a pas pu être enregistré."
      : body.action === "unban"
      ? "Le bannissement Supabase n’a pas pu être levé."
      : "Le compte est bloqué, mais le nettoyage n’a pas pu aboutir. Réessayez.";
    return await actionFailure(serviceClient, profile.site, authData.user.id, body.studentId, action, "unexpected_exception", message, 500, { outcome: "unknown_or_partial" });
  }
});
