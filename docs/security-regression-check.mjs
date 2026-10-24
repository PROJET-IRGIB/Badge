// Regression checks for a disposable Supabase TEST project only.
// Run with: node --env-file=.env.security-test docs/security-regression-check.mjs
// No dependency is required. Never put production credentials in the env file.

const env = process.env;
const required = [
  "IRGIB_TEST_SUPABASE_URL", "IRGIB_TEST_PROJECT_REF", "IRGIB_TEST_PUBLISHABLE_KEY",
  "IRGIB_TEST_STUDENT_A_EMAIL", "IRGIB_TEST_STUDENT_A_PASSWORD", "IRGIB_TEST_STUDENT_A_ID",
  "IRGIB_TEST_STUDENT_B_EMAIL", "IRGIB_TEST_STUDENT_B_PASSWORD", "IRGIB_TEST_STUDENT_B_ID",
  "IRGIB_TEST_SITE_ADMIN_EMAIL", "IRGIB_TEST_SITE_ADMIN_PASSWORD",
  "IRGIB_TEST_GLOBAL_ADMIN_EMAIL", "IRGIB_TEST_GLOBAL_ADMIN_PASSWORD",
  "IRGIB_TEST_NEW_STUDENT_EMAIL", "IRGIB_TEST_NEW_STUDENT_PASSWORD", "IRGIB_TEST_NEW_STUDENT_ID",
  "IRGIB_TEST_REP_EMAIL", "IRGIB_TEST_REP_PASSWORD", "IRGIB_TEST_REP_ID",
  "IRGIB_TEST_REP_CLASSMATE_ID", "IRGIB_TEST_REP_CLASSMATE_MATRICULE",
  "IRGIB_TEST_BANNED_REP_TARGET_EMAIL", "IRGIB_TEST_BANNED_REP_TARGET_PASSWORD",
  "IRGIB_TEST_BANNED_REP_TARGET_ID", "IRGIB_TEST_BANNED_REP_TARGET_MATRICULE",
  "IRGIB_TEST_QR_VALID", "IRGIB_TEST_QR_EXPIRED", "IRGIB_TEST_QR_OTHER_GROUP",
  "IRGIB_TEST_WRONG_PIN",
];
const missing = required.filter(name => !env[name]);
if (missing.length) throw new Error(`Variables de test manquantes : ${missing.join(", ")}`);

const base = new URL(env.IRGIB_TEST_SUPABASE_URL);
if (!/^https:$/.test(base.protocol) && base.hostname !== "localhost") {
  throw new Error("L’URL de test doit utiliser HTTPS (ou localhost pour Supabase local).");
}
if (base.hostname !== "localhost" && !base.hostname.endsWith(".supabase.co")) {
  throw new Error("Utilise l’URL directe du projet Supabase de test, pas un domaine personnalisé.");
}
if (base.hostname !== "localhost" && base.hostname !== `${env.IRGIB_TEST_PROJECT_REF}.supabase.co`) {
  throw new Error("La référence du projet de test ne correspond pas à l’URL Supabase.");
}
if (env.IRGIB_TEST_PROJECT_REF === "cnzmoktoujawmmtstknm"
    || base.hostname === "cnzmoktoujawmmtstknm.supabase.co") {
  throw new Error("ARRÊT : ce script refuse explicitement le projet Supabase de production.");
}
if (!/^\d{4}$/.test(env.IRGIB_TEST_WRONG_PIN)) throw new Error("Le PIN de test incorrect doit contenir 4 chiffres.");

let passed = 0;
let failed = 0;
const check = (name, condition) => {
  if (!condition) { failed++; console.error(`ÉCHEC — ${name}`); return; }
  passed++; console.log(`OK — ${name}`);
};
const api = async (path, { key = env.IRGIB_TEST_PUBLISHABLE_KEY, token, method = "GET", body } = {}) => {
  const response = await fetch(new URL(path, base), {
    method,
    headers: {
      apikey: key,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json", Prefer: "return=representation" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  return { ok: response.ok, status: response.status, data };
};
const login = async (email, password) => {
  const result = await api("/auth/v1/token?grant_type=password", { method: "POST", body: { email, password } });
  if (!result.ok || !result.data?.access_token) throw new Error("Connexion d’un compte de test impossible; vérifie les identifiants et la confirmation e-mail.");
  return { token: result.data.access_token, id: result.data.user.id };
};
const select = async (token, table, query) => {
  const result = await api(`/rest/v1/${table}?${query}`, { token });
  if (!result.ok) throw new Error(`Lecture de test impossible (${table}, HTTP ${result.status}).`);
  return Array.isArray(result.data) ? result.data : [];
};
const rpc = (token, name, body) => api(`/rest/v1/rpc/${name}`, { token, method: "POST", body });
const expectReject = async (name, promise) => {
  const result = await promise;
  check(name, !result.ok && result.status >= 400);
};
const profile = async (token, id) => {
  const rows = await select(token, "student_profiles", `select=user_id,site,program,level,first_name,last_name,email,phone,sex,birth_date&user_id=eq.${encodeURIComponent(id)}`);
  return rows[0] || null;
};
const applicationPayload = (p, site, photoPath) => ({
  student_id: p.user_id, first_name: p.first_name, last_name: p.last_name, email: p.email,
  phone: p.phone, sex: p.sex, birth_date: p.birth_date, program: p.program, level: p.level,
  site, photo_path: photoPath, status: "pending", temporary_matricule: `TMP-SEC-${crypto.randomUUID()}`,
  final_matricule: null, decided_at: null, decided_by: null, rejection_reason: null,
});

const studentA = await login(env.IRGIB_TEST_STUDENT_A_EMAIL, env.IRGIB_TEST_STUDENT_A_PASSWORD);
const studentB = await login(env.IRGIB_TEST_STUDENT_B_EMAIL, env.IRGIB_TEST_STUDENT_B_PASSWORD);
const siteAdmin = await login(env.IRGIB_TEST_SITE_ADMIN_EMAIL, env.IRGIB_TEST_SITE_ADMIN_PASSWORD);
const globalAdmin = await login(env.IRGIB_TEST_GLOBAL_ADMIN_EMAIL, env.IRGIB_TEST_GLOBAL_ADMIN_PASSWORD);
const newStudent = await login(env.IRGIB_TEST_NEW_STUDENT_EMAIL, env.IRGIB_TEST_NEW_STUDENT_PASSWORD);
const representative = await login(env.IRGIB_TEST_REP_EMAIL, env.IRGIB_TEST_REP_PASSWORD);
const bannedTarget = await login(env.IRGIB_TEST_BANNED_REP_TARGET_EMAIL, env.IRGIB_TEST_BANNED_REP_TARGET_PASSWORD);

if (studentA.id !== env.IRGIB_TEST_STUDENT_A_ID || studentB.id !== env.IRGIB_TEST_STUDENT_B_ID
    || newStudent.id !== env.IRGIB_TEST_NEW_STUDENT_ID || representative.id !== env.IRGIB_TEST_REP_ID
    || bannedTarget.id !== env.IRGIB_TEST_BANNED_REP_TARGET_ID) {
  throw new Error("Un UUID fourni ne correspond pas au compte de test connecté.");
}

const profileA = await profile(studentA.token, studentA.id);
const profileB = await profile(studentB.token, studentB.id);
const profileNew = await profile(newStudent.token, newStudent.id);
if (!profileA || !profileB || !profileNew || !profileNew.birth_date || profileA.site === profileB.site) {
  throw new Error("Prépare deux étudiants de sites différents et un étudiant neuf avec date de naissance.");
}

// RLS: students see their own rows, not another student's profile.
check("un étudiant lit son propre profil", (await profile(studentA.token, studentA.id))?.user_id === studentA.id);
check("un étudiant ne lit pas le profil d’un autre site", !(await profile(studentA.token, studentB.id)));

// Site administrator can see the assigned student's site only; general admin sees both.
const memberships = await select(siteAdmin.token, "admin_site_members", `select=site&user_id=eq.${encodeURIComponent(siteAdmin.id)}`);
const assignedSite = memberships[0]?.site;
if (!assignedSite || profileA.site !== assignedSite || profileB.site === assignedSite) {
  throw new Error("Prépare l’admin de site sur le même site que l’étudiant A, l’étudiant B sur un autre site.");
}
check("l’admin de site lit son site", Boolean(await profile(siteAdmin.token, studentA.id)));
check("l’admin de site ne lit pas un autre site", !(await profile(siteAdmin.token, studentB.id)));
check("l’admin général lit les deux sites", Boolean(await profile(globalAdmin.token, studentA.id)) && Boolean(await profile(globalAdmin.token, studentB.id)));
const leakedDigest = await api("/rest/v1/attendance_sessions?select=token_digest&limit=1", { token: globalAdmin.token });
check("l’empreinte du jeton de présence n’est pas lisible par les clients", !leakedDigest.ok);

const deniedProfileEdit = await api(`/rest/v1/student_profiles?user_id=eq.${encodeURIComponent(studentA.id)}`, {
  token: studentA.token, method: "PATCH", body: { site: profileA.site },
});
check("modification directe du profil étudiant refusée", !deniedProfileEdit.ok);

const openApplications = await select(newStudent.token, "badge_applications", `select=id,status&student_id=eq.${encodeURIComponent(newStudent.id)}&status=in.(pending,approved)`);
if (openApplications.length) throw new Error("L’étudiant neuf doit ne pas avoir de demande en attente ou approuvée.");
if (profileNew.site === profileB.site) throw new Error("L’étudiant B doit être sur un autre site que l’étudiant neuf.");
const applicationUrl = "/rest/v1/badge_applications";
await expectReject("demande avec un autre site refusée", api(applicationUrl, {
  token: newStudent.token, method: "POST", body: applicationPayload(profileNew, profileB.site, `${newStudent.id}/test-photo.png`),
}));
await expectReject("demande avec le dossier photo d’un autre étudiant refusée", api(applicationUrl, {
  token: newStudent.token, method: "POST", body: applicationPayload(profileNew, profileNew.site, `${studentB.id}/foreign-test-photo.png`),
}));

// Disposable attendance account: the valid QR must be unused before this script runs.
await expectReject("QR de séance expiré refusé", rpc(studentA.token, "submit_attendance", { p_token: env.IRGIB_TEST_QR_EXPIRED }));
await expectReject("QR d’un autre groupe refusé", rpc(studentA.token, "submit_attendance", { p_token: env.IRGIB_TEST_QR_OTHER_GROUP }));
const firstAttendance = await rpc(studentA.token, "submit_attendance", { p_token: env.IRGIB_TEST_QR_VALID });
check("QR actif du groupe accepté une fois", firstAttendance.ok);
await expectReject("rejeu du même QR refusé", rpc(studentA.token, "submit_attendance", { p_token: env.IRGIB_TEST_QR_VALID }));

// Representative attendance: the designated classmate must be absent and in the rep's group.
const representativeTarget = env.IRGIB_TEST_REP_CLASSMATE_ID;
const representativeMatricule = env.IRGIB_TEST_REP_CLASSMATE_MATRICULE;
const absentList = await rpc(representative.token, "list_representative_groupmates", {});
if (!absentList.ok || !Array.isArray(absentList.data)
    || !absentList.data.some(row => row.student_id === representativeTarget)
    || !absentList.data.some(row => row.student_id === bannedTarget.id)) {
  throw new Error("Les deux étudiants cibles doivent être absents aujourd’hui et appartenir au groupe du responsable de test.");
}
if (representativeTarget && representativeMatricule) {
  const wrongGroup = await rpc(representative.token, "mark_classmate_attendance", {
    p_student_id: studentB.id, p_scanned_qr: "IRGIB-CARTE:IRGIB-9999F",
  });
  check("responsable ne peut pas pointer un étudiant d’un autre groupe", !wrongGroup.ok);
  const marked = await rpc(representative.token, "mark_classmate_attendance", {
    p_student_id: representativeTarget, p_scanned_qr: `IRGIB-CARTE:${representativeMatricule}`,
  });
  check("responsable pointe le camarade absent avec le bon badge", marked.ok);
  await expectReject("second pointage du camarade refusé", rpc(representative.token, "mark_classmate_attendance", {
    p_student_id: representativeTarget, p_scanned_qr: `IRGIB-CARTE:${representativeMatricule}`,
  }));
}

// Lock the disposable representative after five wrong PINs; the sixth request must remain blocked.
const pinStatus = await rpc(representative.token, "representative_daily_qr_pin_status", {});
if (!pinStatus.ok || pinStatus.data !== true) throw new Error("Le responsable de test doit déjà avoir configuré son PIN.");
for (let attempt = 0; attempt < 5; attempt++) {
  const response = await rpc(representative.token, "representative_daily_attendance_qr", { p_pin: env.IRGIB_TEST_WRONG_PIN });
  check(`essai PIN incorrect ${attempt + 1}/5 refusé`, response.ok && response.data?.ok === false);
}
await expectReject("verrouillage temporaire après cinq erreurs PIN", rpc(representative.token, "representative_daily_attendance_qr", { p_pin: env.IRGIB_TEST_WRONG_PIN }));

// Ban two disposable accounts through the same Edge Function used by the admin UI.
const manage = async id => api("/functions/v1/manage-student-account", {
  token: globalAdmin.token, method: "POST", body: { action: "ban", studentId: id },
});
const targetBan = await manage(bannedTarget.id);
check("bannissement du camarade de test enregistré", targetBan.ok);
await expectReject("étudiant banni bloqué pour sa propre présence", rpc(bannedTarget.token, "submit_attendance", { p_token: env.IRGIB_TEST_QR_VALID }));
const bannedProfile = await profile(globalAdmin.token, bannedTarget.id);
if (!bannedProfile) throw new Error("Profil du compte banni de test introuvable.");
await expectReject("étudiant banni bloqué pour modifier son profil", rpc(bannedTarget.token, "student_update_profile", {
  p_first_name: bannedProfile.first_name, p_last_name: bannedProfile.last_name, p_phone: bannedProfile.phone,
  p_sex: bannedProfile.sex, p_program: bannedProfile.program, p_level: bannedProfile.level,
  p_site: bannedProfile.site, p_birth_date: bannedProfile.birth_date,
}));
const bannedTargetMark = await rpc(representative.token, "mark_classmate_attendance", {
  p_student_id: bannedTarget.id, p_scanned_qr: `IRGIB-CARTE:${env.IRGIB_TEST_BANNED_REP_TARGET_MATRICULE}`,
});
check("un étudiant banni ne peut pas être pointé par un responsable", !bannedTargetMark.ok);

const repBan = await manage(representative.id);
check("bannissement du responsable de test enregistré", repBan.ok);
await expectReject("compte banni bloqué sur la liste du groupe", rpc(representative.token, "list_representative_groupmates", {}));
await expectReject("compte banni bloqué sur le statut du PIN", rpc(representative.token, "representative_daily_qr_pin_status", {}));
await expectReject("compte banni bloqué sur la configuration du PIN", rpc(representative.token, "set_representative_daily_qr_pin", { p_pin: "1234" }));
await expectReject("compte banni bloqué sur le QR quotidien", rpc(representative.token, "representative_daily_attendance_qr", { p_pin: env.IRGIB_TEST_WRONG_PIN }));
await expectReject("responsable banni bloqué pour pointer un camarade", rpc(representative.token, "mark_classmate_attendance", {
  p_student_id: studentB.id, p_scanned_qr: "IRGIB-CARTE:IRGIB-9999F",
}));

console.log(`\n${passed} vérifications réussies, ${failed} échec(s). Comptes de test bannis et présence de l’étudiant A modifiée; recrée les comptes jetables avant un nouveau passage.`);
if (failed) process.exitCode = 1;
