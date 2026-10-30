(() => {
  const D = window.IRGIB_DATA;
  const byId = id => document.getElementById(id);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const fullName = item => `${item.firstName || ""} ${item.lastName || ""}`.trim();
  const friendlyError = (error, fallback) => {
    const message = String(error?.message || "").toLowerCase();
    if (/permission denied|row-level security|not authorized|unauthorized/.test(message)) return "Votre compte ne dispose pas des droits nécessaires pour cette action.";
    if (/network|failed to fetch|fetcherror|timeout/.test(message)) return "Connexion interrompue. Vérifiez votre connexion puis réessayez.";
    return fallback;
  };
  const safeName = /^[\p{L}\p{M} .’'-]+$/u;
  let currentView = "dashboard";
  let reviewedId = "";
  let toastTimer;
  let applicationsCache = [];
  let studentProfilesCache = [];
  let attendanceCache = [];
  let announcementsCache = [];
  let representativesCache = [];
  let siteContactsCache = [];
  let siteContactsAvailable = false;
  let adminSite = null;
  let currentAdminId = "";
  const selectedCardIds = new Set();
  const applications = () => applicationsCache;
  const approved = () => applications().filter(item => item.status === "approved");
  const siteName = id => D.getSite(id).city;
  const programName = code => D.getProgram(code).shortName;
  const keyFor = item => D.groupKey(item.site, item.program, item.level);
  const mapApplication = row => ({ id: row.id, studentId: row.student_id, firstName: row.first_name, lastName: row.last_name, email: row.email, phone: row.phone, sex: row.sex, birthDate: row.birth_date, program: row.program, level: row.level, site: row.site, status: row.status, temporaryMatricule: row.temporary_matricule, finalMatricule: row.final_matricule, photoPath: row.photo_path, photoFileName: row.photo_path.split("/").at(-1), rejectionReason: row.rejection_reason, submittedAt: row.submitted_at, approvedAt: row.decided_at });
  async function loadAdminData() {
    const rows = [];
    for (let from = 0; ; from += 500) {
      const { data, error } = await adminClient.from("badge_applications").select("*")
        .order("submitted_at", { ascending: false }).order("id", { ascending: false }).range(from, from + 499);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < 500) break;
    }
    applicationsCache = rows.map(mapApplication);
    const profiles = [];
    for (let from = 0; ; from += 500) {
      const { data, error } = await adminClient.from("student_profiles").select("*").order("created_at", { ascending: false }).range(from, from + 499);
      if (error) throw error;
      profiles.push(...(data || []));
      if (!data || data.length < 500) break;
    }
    studentProfilesCache = profiles.filter(row => row.email_verified_at).map(row => ({ studentId: row.user_id, firstName: row.first_name, lastName: row.last_name, email: row.email, phone: row.phone, sex: row.sex, originGroup: row.origin_group || "", countryOfOrigin: row.country_of_origin || "", program: row.program, level: row.level, site: row.site, birthDate: row.birth_date, accountStatus: row.account_status || "pending", accountRejectionReason: row.account_rejection_reason || "", emailVerifiedAt: row.email_verified_at, accountReviewedAt: row.account_reviewed_at || null, bannedAt: row.banned_at || null, cardSuspendedAt: row.card_suspended_at || null }));
    const records = [];
    for (let from = 0; ; from += 500) {
      const { data, error } = await adminClient.from("attendance_records")
        .select("status,attended_at,session_id,marked_by,student_profiles!inner(user_id,first_name,last_name,email,program,level,site,banned_at,card_suspended_at),attendance_sessions!inner(site,program,level,session_day,course_title)")
        .eq("attendance_sessions.session_day", D.todayKey())
        .order("attended_at", { ascending: false, nullsFirst: false }).order("id", { ascending: false }).range(from, from + 499);
      if (error) throw error;
      records.push(...(data || []));
      if (!data || data.length < 500) break;
    }
    const byStudent = new Map(applicationsCache.map(item => [item.studentId, item]));
    attendanceCache = (records || []).filter(row => !row.student_profiles.banned_at && !row.student_profiles.card_suspended_at).map(row => {
      const person = row.student_profiles; const app = byStudent.get(person.user_id); const actor = row.marked_by ? byStudent.get(row.marked_by) : null;
      return { studentId: person.user_id, markedBy: row.marked_by, markedByName: actor ? fullName(actor) : "Étudiant", createdAt: row.attended_at, day: row.attendance_sessions.session_day, sessionCode: row.session_id.slice(0, 8), courseTitle: row.attendance_sessions.course_title, present: row.status === "present", firstName: person.first_name, lastName: person.last_name, email: person.email, matricule: app?.finalMatricule || app?.temporaryMatricule || "", program: person.program, level: person.level, site: person.site };
    });
    const { data: contacts, error: contactsError } = await adminClient.from("campus_site_contacts").select("site,contact_name,address,phone,updated_at");
    siteContactsAvailable = !contactsError;
    if (!contactsError) {
      siteContactsCache = contacts || [];
      D.applySiteContacts(siteContactsCache);
    }
  }
  const statusText = status => ({ pending: "En attente", approved: "Approuvée", rejected: "Rejetée" }[status] || status);
  const statusHtml = status => `<span class="status ${status === "approved" ? "active" : status === "rejected" ? "rejected" : "pending"}">${statusText(status)}</span>`;
  const photoCell = item => item.photo ? `<img class="table-photo" src="${esc(item.photo)}" alt="Photo de ${esc(fullName(item))}">` : `<span class="table-photo photo-empty">${item.photoPath ? "Photo" : "—"}</span>`;

  function toast(message) {
    const element = byId("toast");
    element.textContent = message;
    element.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove("show"), 2800);
  }
  async function dispatchCampusPush(body) {
    try {
      const { data, error } = await adminClient.functions.invoke("send-campus-push", { body });
      return { data, error: error || (data?.error ? new Error(data.error) : null) };
    } catch (error) { return { data: null, error }; }
  }
  function setView(view) {
    currentView = view;
    document.querySelectorAll(".view").forEach(node => node.classList.toggle("active", node.id === `view-${view}`));
    document.querySelectorAll(".side-nav [data-view]").forEach(node => node.classList.toggle("active", node.dataset.view === view));
    const labels = { dashboard: "Vue d’ensemble", requests: "Demandes de badge", accounts: "Comptes étudiants", students: "Étudiants", attendance: "Présences", groups: "Groupes", representatives: "Responsables de classe", catalog: "Catalogue", announcements: "Actualités", cards: "Cartes" };
    byId("breadcrumb").textContent = `Campus / ${labels[view]}`;
    ({ dashboard: renderDashboard, requests: renderRequests, accounts: renderStudentAccounts, students: () => void loadRepresentatives().then(renderStudents), attendance: renderAttendance, groups: renderGroups, representatives: () => void loadRepresentatives(), catalog: renderCatalog, announcements: () => void loadAnnouncements(), cards: renderCards })[view]?.();
  }
  function renderStudentAccounts() {
    const query = (byId("account-search").value || "").trim().toLowerCase();
    const status = byId("account-filter").value;
    const list = studentProfilesCache.filter(person => (status === "all"
      || (status === "banned" ? Boolean(person.bannedAt) : status === "approved" ? person.accountStatus === "approved" && !person.bannedAt : person.accountStatus === status))
      && [fullName(person), person.email, programName(person.program), person.level, siteName(person.site), person.originGroup, person.countryOfOrigin].join(" ").toLowerCase().includes(query))
      .sort((a, b) => (b.accountReviewedAt || "").localeCompare(a.accountReviewedAt || "") || fullName(a).localeCompare(fullName(b), "fr"));
    byId("account-count").textContent = `${list.length} compte${list.length === 1 ? "" : "s"}`;
    byId("account-rows").innerHTML = list.map(person => {
      const label = person.bannedAt ? "Banni" : person.accountStatus === "approved" ? "Confirmé" : person.accountStatus === "rejected" ? "Refusé" : "À confirmer";
      const tone = person.bannedAt || person.accountStatus === "rejected" ? "rejected" : person.accountStatus === "approved" ? "active" : "pending";
      const reviewAction = person.accountStatus === "approved"
        ? `<span class="small muted">${person.bannedAt ? "Accès suspendu" : "Accès autorisé"}</span>`
        : person.accountStatus === "pending"
          ? `<button class="btn sm" type="button" data-account-approve="${esc(person.studentId)}">Confirmer le compte</button><button class="btn danger sm" type="button" data-account-reject="${esc(person.studentId)}">Refuser</button>`
          : `<button class="btn sm" type="button" data-account-approve="${esc(person.studentId)}">Réexaminer</button>`;
      const accountActions = person.accountStatus === "approved"
        ? `<button class="btn ${person.bannedAt ? "secondary" : "danger"} sm" type="button" data-account-${person.bannedAt ? "unban" : "ban"}="${esc(person.studentId)}">${person.bannedAt ? "Débannir" : "Bannir"}</button>`
        : "";
      const destructiveActions = `<div class="table-actions" style="flex-wrap:wrap;align-items:center">${reviewAction}${accountActions}<button class="btn danger sm" type="button" data-account-delete="${esc(person.studentId)}">Supprimer</button></div>`;
      const origin = person.originGroup === "anglophone" ? "Anglophone" : person.originGroup === "francophone" ? "Francophone" : "À renseigner";
      return `<tr><td><strong>${esc(fullName(person))}</strong>${person.accountRejectionReason ? `<span class="sub">Motif : ${esc(person.accountRejectionReason)}</span>` : ""}</td><td>${esc(person.email)}</td><td>${esc(programName(person.program))}<span class="sub">${esc(person.level)}</span></td><td>${esc(origin)}<span class="sub">${esc(person.countryOfOrigin || "Pays d’origine non renseigné")}</span></td><td>${esc(siteName(person.site))}</td><td><span class="status ${tone}">${label}</span></td><td>${destructiveActions}</td></tr>`;
    }).join("") || `<tr><td colspan="7" class="table-empty">Aucun compte ne correspond à ces critères.</td></tr>`;
  }
  async function decideStudentAccount(studentId, approve) {
    const person = studentProfilesCache.find(item => item.studentId === studentId);
    if (!person) return;
    const actionLabel = approve ? "confirmer" : "refuser";
    let reason = "";
    if (!approve) {
      reason = window.prompt(`Motif du refus pour ${fullName(person)} (facultatif) :`) || "";
      if (!window.confirm(`Refuser le compte étudiant de ${fullName(person)} ?`)) return;
    } else if (!window.confirm(`Confirmer que ${fullName(person)} est bien étudiant à ${siteName(person.site)} et autoriser son accès à l’espace étudiant ?`)) return;
    const { error } = await adminClient.rpc("admin_decide_student_account", { p_student_id: studentId, p_approve: approve, p_reason: reason });
    if (error) { toast(friendlyError(error, `Le compte n’a pas pu être ${actionLabel}. Vérifiez la migration Supabase puis réessayez.`)); return; }
    if (approve) {
      const push = await dispatchCampusPush({ kind: "student_account_approved", id: studentId });
      toast(push.error ? "Compte confirmé. L’étudiant verra l’accès ouvert à sa prochaine connexion ; la notification push n’a pas pu partir." : push.data?.sent ? "Compte confirmé et notification envoyée à l’étudiant." : "Compte confirmé. L’étudiant pourra se connecter ; aucune notification push n’est activée sur son appareil.");
    } else toast("Compte refusé. L’étudiant ne peut pas accéder à son espace.");
    await refreshCurrent();
  }
  function requestTableRows(list, recent = false) {
    const count = recent ? 6 : 7;
    if (!list.length) return `<tr><td colspan="${count}" class="table-empty">Aucune demande ne correspond aux critères.</td></tr>`;
    return list.map(item => `<tr><td>${photoCell(item)}</td><td><strong>${esc(fullName(item))}</strong><span class="sub">${esc(item.email)}</span></td><td>${esc(item.temporaryMatricule || "—")}${item.finalMatricule ? `<span class="sub">Final : ${esc(item.finalMatricule)}</span>` : ""}</td><td>${esc(programName(item.program))}<span class="sub">${esc(item.level)} · ${esc(item.sex)}</span></td><td>${esc(siteName(item.site))}</td><td>${statusHtml(item.status)}</td>${recent ? "" : `<td><button class="btn ${item.status === "pending" ? "" : "secondary"} sm" data-review="${esc(item.id)}">${item.status === "pending" ? "Examiner" : "Consulter"}</button></td>`}</tr>`).join("");
  }
  function renderDashboard() {
    const list = applications();
    const pending = list.filter(item => item.status === "pending");
    const active = list.filter(item => item.status === "approved");
    const rejected = list.filter(item => item.status === "rejected");
    const today = attendanceCache.filter(item => item.day === D.todayKey() && item.present);
    byId("dashboard-stats").innerHTML = [["Demandes en attente", pending.length, "À vérifier par l’administration"], ["Cartes approuvées", active.length, "Matricules définitifs attribués"], ["Demandes rejetées", rejected.length, "Décisions enregistrées"], ["Présences aujourd’hui", today.length, D.todayKey()]].map(([label, value, note]) => `<article class="stat-card"><div class="stat-top"><span>${label}</span></div><div class="stat-value">${value}</div><div class="stat-note">${note}</div></article>`).join("");
    byId("today-attendance-summary").innerHTML = `<div class="attendance-count-big">${today.length}</div><p class="muted small">présence${today.length === 1 ? "" : "s"} validée${today.length === 1 ? "" : "s"} aujourd’hui</p>`;
    byId("pending-summary").innerHTML = pending.slice(0, 3).map(item => `<button class="quick-item" data-review="${esc(item.id)}" style="width:100%;text-align:left;background:#fff"><span class="q-icon">${photoCell(item)}</span><span><strong>${esc(fullName(item))}</strong><span>${esc(item.temporaryMatricule)} · ${esc(siteName(item.site))}</span></span></button>`).join("") || `<div class="muted small">Aucune demande en attente.</div>`;
    byId("recent-rows").innerHTML = requestTableRows(list.slice(0, 5), true);
  }
  function renderRequests() {
    const query = (byId("request-search").value || "").trim().toLowerCase();
    const status = byId("request-filter").value;
    const list = applications().filter(item => (status === "all" || item.status === status) && [fullName(item), item.email, item.temporaryMatricule, item.finalMatricule, programName(item.program), item.level, siteName(item.site)].join(" ").toLowerCase().includes(query)).sort((a, b) => (b.submittedAt || "").localeCompare(a.submittedAt || ""));
    byId("request-count").textContent = `${list.length} demande${list.length === 1 ? "" : "s"}`;
    byId("request-rows").innerHTML = requestTableRows(list);
  }
  function renderStudents() {
    const query = (byId("student-search").value || "").trim().toLowerCase();
    const program = byId("student-program-filter").value;
    const level = byId("student-level-filter").value;
    const list = studentProfilesCache.filter(person => person.accountStatus === "approved" && !person.bannedAt
      && (!program || person.program === program) && (!level || person.level === level)).filter(person => {
      const app = applications().find(item => item.studentId === person.studentId);
      return [fullName(person), person.email, app?.finalMatricule, app?.temporaryMatricule, programName(person.program), person.level, siteName(person.site)].join(" ").toLowerCase().includes(query);
    });
    byId("student-count").textContent = `${list.length} étudiant${list.length === 1 ? "" : "s"}`;
    byId("student-rows").innerHTML = list.map(person => {
      const app = applications().find(item => item.studentId === person.studentId);
      const rep = representativesCache.find(item => item.user_id === person.studentId);
      return `<tr><td>${app ? photoCell(app) : `<span class="table-photo photo-empty">—</span>`}</td><td><strong>${esc(fullName(person))}</strong><span class="sub">${esc(person.email)}</span>${person.cardSuspendedAt ? `<span class="sub status rejected">Carte désactivée</span>` : ""}</td><td><strong>${esc(app?.finalMatricule || app?.temporaryMatricule || "—")}</strong><span class="sub">${app ? statusText(app.status) : "Inscrit · demande non envoyée"}</span></td><td>${esc(person.sex)}</td><td>${esc(programName(person.program))}<span class="sub">${esc(person.level)}</span></td><td>${esc(siteName(person.site))}</td><td>${esc(keyFor(person))}</td><td class="student-admin-actions"><button class="btn secondary sm" type="button" data-student-role="${esc(person.studentId)}" ${person.cardSuspendedAt || rep ? "disabled" : ""}>${rep ? "Déjà responsable" : "Nommer responsable"}</button></td></tr>`;
    }).join("") || `<tr><td colspan="8" class="table-empty">Aucun étudiant inscrit trouvé.</td></tr>`;
  }
  const careerCycles = [
    { name: "Licence", levels: ["LP1", "LP2", "LP3"] },
    { name: "Master", levels: ["M1", "M2"] }
  ];
  const careerYear = { LP1: "1re année", LP2: "2e année", LP3: "3e année", M1: "1re année", M2: "2e année" };
  function attendanceRoster() {
    return attendanceCache.filter(item => item.day === D.todayKey());
  }
  function renderAttendance() {
    const query = (byId("attendance-search").value || "").trim().toLowerCase();
    const site = byId("attendance-site").value;
    const program = byId("attendance-program").value;
    const level = byId("attendance-level").value;
    const status = byId("attendance-status").value;
    const people = attendanceRoster().filter(item => {
      if (site && item.site !== site) return false;
      if (program && item.program !== program) return false;
      if (level && item.level !== level) return false;
      if (status === "present" && !item.present) return false;
      if (status === "absent" && item.present) return false;
      return [fullName(item), item.matricule, item.email, programName(item.program), item.level, siteName(item.site)].join(" ").toLowerCase().includes(query);
    });
    const presentCount = people.filter(item => item.present).length;
    const absentCount = people.length - presentCount;
    byId("attendance-title").textContent = `Appel du ${D.todayKey()} · ${D.academicYear}`;
    byId("attendance-count").textContent = `${presentCount} présent${presentCount === 1 ? "" : "s"} · ${absentCount} absent${absentCount === 1 ? "" : "s"}`;
    const blocks = [];
    careerCycles.forEach(cycle => {
      const levels = cycle.levels.filter(code => people.some(item => item.level === code));
      if (!levels.length) return;
      blocks.push(`<h2 class="roll-cycle">${esc(cycle.name)} · ${esc(D.academicYear)}</h2>`);
      levels.forEach(code => {
        const atLevel = people.filter(item => item.level === code);
        blocks.push(`<h3 class="roll-level">${esc(code)} · ${esc(careerYear[code] || code)}</h3>`);
        const programs = [...new Set(atLevel.map(item => item.program))].sort();
        programs.forEach(programCode => {
          const sites = [...new Set(atLevel.filter(item => item.program === programCode).map(item => item.site))];
          sites.forEach(siteId => {
            const rows = atLevel.filter(item => item.program === programCode && item.site === siteId).sort((a, b) => fullName(a).localeCompare(fullName(b), "fr"));
            const here = rows.filter(item => item.present).length;
            const body = rows.map(item => `<tr><td><strong>${esc(fullName(item))}</strong><span class="sub">${esc(item.email)}</span></td><td>${esc(item.matricule || "—")}</td><td>${item.present && item.createdAt ? new Date(item.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "—"}</td><td>${item.present ? esc(item.markedByName || "Étudiant") : "—"}</td><td><span class="status ${item.present ? "active" : "absent"}">${item.present ? "Présent" : "Absent"}</span></td></tr>`).join("");
            blocks.push(`<section class="roll-section"><header><strong>${esc(programName(programCode))}</strong><span>${esc(siteName(siteId))}</span><span>${here} / ${rows.length}</span></header><div class="table-scroll"><table><thead><tr><th>Étudiant</th><th>Matricule</th><th>Heure</th><th>Saisi par</th><th>Statut</th></tr></thead><tbody>${body}</tbody></table></div></section>`);
          });
        });
      });
    });
    byId("attendance-board").innerHTML = blocks.join("") || `<p class="table-empty">Aucune séance active aujourd’hui pour ces critères.</p>`;
  }
  function initGroupFilters() {
    const scopedSites = D.sites.filter(item => !adminSite || item.id === adminSite);
    byId("student-program-filter").innerHTML = `<option value="">Toutes les filières</option>${D.programs.map(item => `<option value="${item.code}">${item.code} · ${esc(item.shortName)}</option>`).join("")}`;
    byId("student-level-filter").innerHTML = `<option value="">Toutes les années</option>${D.levels.map(level => `<option value="${level}">${level} · ${careerYear[level] || level}</option>`).join("")}`;
    byId("group-site").innerHTML = `${adminSite ? "" : `<option value="">Tous les sites</option>`}${scopedSites.map(item => `<option value="${item.id}">${esc(item.city)}</option>`).join("")}`;
    byId("group-program").innerHTML = `<option value="">Toutes les filières</option>${D.programs.map(item => `<option value="${item.code}">${item.code} · ${esc(item.shortName)}</option>`).join("")}`;
    byId("group-level").innerHTML = `<option value="">Tous les niveaux</option>${D.levels.map(level => `<option value="${level}">${level} · ${careerYear[level] || level}</option>`).join("")}`;
    byId("attendance-site").innerHTML = `${adminSite ? "" : `<option value="">Tous les sites · 200 QR</option>`}${scopedSites.map(item => `<option value="${item.id}">${esc(item.city)} · 40 QR</option>`).join("")}`;
    byId("attendance-program").innerHTML = `<option value="">Toutes les filières</option>${D.programs.map(item => `<option value="${item.code}">${item.code} · ${esc(item.shortName)}</option>`).join("")}`;
    byId("attendance-level").innerHTML = `<option value="">Toutes les années</option>${D.levels.map(level => `<option value="${level}">${level} · ${careerYear[level] || level}</option>`).join("")}`;
  }
  function renderGroups() {
    const site = byId("group-site").value;
    const program = byId("group-program").value;
    const level = byId("group-level").value;
    const query = (byId("group-search").value || "").trim().toLowerCase();
    const counts = approved().reduce((memo, item) => { const key = keyFor(item); memo[key] = (memo[key] || 0) + 1; return memo; }, {});
    const list = D.allGroups().filter(group => (!site || group.site === site) && (!program || group.program === program) && (!level || group.level === level) && (!query || group.key.toLowerCase().includes(query)));
    byId("group-count").textContent = `${list.length} groupe${list.length === 1 ? "" : "s"}`;
    byId("group-rows").innerHTML = list.map(group => `<tr><td><strong>${esc(group.key)}</strong></td><td>${esc(siteName(group.site))}</td><td>${esc(group.program)} · ${esc(programName(group.program))}</td><td>${esc(group.level)}</td><td>${counts[group.key] || 0}</td></tr>`).join("") || `<tr><td colspan="5" class="table-empty">Aucun groupe.</td></tr>`;
  }
  function renderCatalog() {
    byId("program-grid").innerHTML = D.programs.map(program => `<article class="program-card"><span class="program-code">${esc(program.code)}</span><div class="program-title">${esc(program.name)}</div></article>`).join("");
    const sites = D.sites.filter(site => !adminSite || site.id === adminSite);
    byId("site-grid").innerHTML = sites.map(site => {
      const point = site.points?.[0] || {};
      const contact = siteContactsCache.find(row => row.site === site.id) || {};
      return `<article class="site-card"><span class="site-code">ZONE ${esc(site.zone)} · ${esc(site.id)}</span><strong>${esc(site.city)}</strong>${siteContactsAvailable ? `<form class="site-contact-form" data-site-contact="${esc(site.id)}"><label>Contact / zone<input name="contact_name" maxlength="80" value="${esc(contact.contact_name || point.name || site.city)}" required></label><label>Adresse<input name="address" maxlength="200" value="${esc(contact.address || point.address || "")}" required></label><label>Téléphone<input name="phone" type="tel" maxlength="40" value="${esc(contact.phone || point.phone || "")}" required></label><button class="btn secondary sm" type="submit">Enregistrer les contacts</button></form>` : `<p>La gestion centralisée des contacts sera disponible après l’activation de la migration Supabase.</p>`}</article>`;
    }).join("");
  }
  function renderAnnouncements() {
    const host = byId("announcement-admin-rows");
    if (!announcementsCache.length) {
      host.innerHTML = `<div class="news-empty"><strong>Aucune publication pour le moment</strong><p>Les annonces que vous publiez apparaîtront ici.</p></div>`;
      return;
    }
    host.innerHTML = announcementsCache.map(item => `<article class="announcement-admin-item"><div class="announcement-admin-meta"><span class="news-tag">${item.site ? esc(siteName(item.site)) : "Tous les sites"}</span><span class="status ${item.status === "published" ? "active" : "pending"}">${item.status === "published" ? "Publiée" : item.status === "archived" ? "Archivée" : "Brouillon"}</span></div><small class="announcement-publisher">${item.published_by_site ? `Publié par l’administration de ${esc(siteName(item.published_by_site))}` : "Publié par l’administration générale"}</small><h3>${esc(item.title)}</h3><p>${esc(item.body)}</p>${item.mediaUrl ? (item.media_type === "video" ? `<video class="news-media" src="${esc(item.mediaUrl)}" controls playsinline preload="metadata"></video>` : `<img class="news-media" src="${esc(item.mediaUrl)}" alt="Aperçu : ${esc(item.title)}" loading="lazy">`) : ""}<small>${item.published_at ? new Date(item.published_at).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" }) : "Pas encore publiée"}</small><button class="btn secondary sm" type="button" data-announcement-toggle="${esc(item.id)}">${item.status === "published" ? "Retirer de l’espace étudiant" : "Publier maintenant"}</button></article>`).join("");
  }
  async function signedAnnouncementRows(rows) {
    return Promise.all((rows || []).map(async item => {
      if (!item.media_path) return item;
      const { data } = await adminClient.storage.from("campus-announcement-media").createSignedUrl(item.media_path, 3600);
      return { ...item, mediaUrl: data?.signedUrl || "" };
    }));
  }
  async function loadAnnouncements() {
    const host = byId("announcement-admin-rows");
    host.innerHTML = `<div class="news-empty"><strong>Chargement…</strong></div>`;
    const { data, error } = await adminClient.from("campus_announcements").select("id,title,body,site,published_by_site,status,published_at,expires_at,created_at,media_path,media_type").order("created_at", { ascending: false }).limit(50);
    if (error) { host.innerHTML = `<div class="notice">Les actualités ne sont pas disponibles pour le moment. Réessayez plus tard.</div>`; return; }
    announcementsCache = await signedAnnouncementRows(data || []);
    renderAnnouncements();
  }
  async function publishAnnouncement(event) {
    event.preventDefault();
    const form = byId("announcement-form");
    const button = byId("announcement-submit");
    const message = byId("announcement-message");
    const title = byId("announcement-title").value.trim();
    const body = byId("announcement-body").value.trim();
    const file = byId("announcement-media").files?.[0] || null;
    if (title.length < 4 || body.length < 10) { message.textContent = "Ajoutez un titre précis et une information d’au moins 10 caractères."; return; }
    if (file && (!/^(image\/(jpeg|png|webp)|video\/(mp4|webm))$/.test(file.type) || file.size > 50 * 1024 * 1024)) { message.textContent = "Choisissez une image ou vidéo JPG, PNG, WebP, MP4 ou WebM de 50 Mo maximum."; return; }
    if (!window.confirm(`Publier l’actualité « ${title} » aux destinataires sélectionnés ?`)) return;
    button.disabled = true;
    message.textContent = "Publication en cours…";
    let mediaPath = null;
    try {
      const id = crypto.randomUUID();
      const selectedSite = byId("announcement-site").value;
      const site = selectedSite === "all" ? null : selectedSite;
      const publisherSite = adminSite || null;
      if (file) {
        const extension = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4", "video/webm": "webm" })[file.type];
        mediaPath = `${publisherSite || site || "all"}/${id}/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await adminClient.storage.from("campus-announcement-media").upload(mediaPath, file, { contentType: file.type, cacheControl: "3600", upsert: false });
        if (uploadError) throw uploadError;
      }
      const { error } = await adminClient.from("campus_announcements").insert({ id, title, body, site, published_by_site: publisherSite, status: "published", published_at: new Date().toISOString(), expires_at: byId("announcement-expiry").value || null, created_by: currentAdminId, media_path: mediaPath, media_type: file?.type.startsWith("video/") ? "video" : file ? "image" : null });
      if (error) {
        if (mediaPath) await adminClient.storage.from("campus-announcement-media").remove([mediaPath]).catch(() => {});
        message.textContent = friendlyError(error, "La publication n’a pas pu être enregistrée. Réessayez."); return;
      }
      form.reset();
      byId("announcement-media-preview").innerHTML = "";
      const push = await dispatchCampusPush({ kind: "announcement", id });
      message.textContent = push.error ? "Actualité publiée. Les étudiants connectés la verront; l’envoi en arrière-plan est momentanément indisponible." : push.data?.sent ? `Actualité publiée et notification envoyée à ${push.data.sent} appareil${push.data.sent === 1 ? "" : "s"}${push.data.failed ? ` · ${push.data.failed} échec(s)` : ""}.` : "Actualité publiée. Aucun appareil étudiant n’a encore activé les notifications.";
      await loadAnnouncements();
    } catch (error) {
      if (mediaPath) await adminClient.storage.from("campus-announcement-media").remove([mediaPath]).catch(() => {});
      message.textContent = friendlyError(error, "L’actualité n’a pas pu être publiée. Vérifiez votre connexion puis réessayez.");
    } finally {
      button.disabled = false;
    }
  }
  async function loadRepresentatives() {
    const host = byId("representative-manager");
    host.innerHTML = `<div class="news-empty"><strong>Chargement…</strong></div>`;
    const { data, error } = await adminClient.from("class_representatives").select("site,program,level,user_id,assigned_at").order("site").order("program").order("level");
    if (error) { host.innerHTML = `<div class="notice">La liste des responsables n’est pas disponible pour le moment. Réessayez plus tard.</div>`; return; }
    representativesCache = data || [];
    renderRepresentativeManager();
  }
  function renderRepresentativeManager() {
    const site = byId("rep-site").value || adminSite || D.sites[0].id;
    const program = byId("rep-program").value || D.programs[0].code;
    const level = byId("rep-level").value || D.levels[0];
    const assignments = representativesCache.filter(item => item.site === site && item.program === program && item.level === level);
    const assignedIds = new Set(assignments.map(item => item.user_id));
    const candidates = studentProfilesCache.filter(item => item.site === site && item.program === program && item.level === level && !item.bannedAt && !item.cardSuspendedAt && !assignedIds.has(item.studentId));
    const select = `<label for="rep-student">Étudiant du groupe</label><select id="rep-student"><option value="">${candidates.length ? "Choisir dans le groupe" : "Aucun autre étudiant disponible"}</option>${candidates.map(item => `<option value="${esc(item.studentId)}">${esc(fullName(item))} · ${esc(applications().find(app => app.studentId === item.studentId)?.finalMatricule || applications().find(app => app.studentId === item.studentId)?.temporaryMatricule || "Sans matricule")}</option>`).join("")}</select>`;
    const cards = assignments.map(assignment => {
      const current = studentProfilesCache.find(item => item.studentId === assignment.user_id);
      const matricule = applications().find(app => app.studentId === assignment.user_id)?.finalMatricule || applications().find(app => app.studentId === assignment.user_id)?.temporaryMatricule || "";
      const key = `${site}|${program}|${level}|${assignment.user_id}`;
      return `<div class="representative-current"><div><small>Responsable</small><strong>${esc(current ? fullName(current) : "Compte affecté, étudiant non trouvé")}</strong><span>${esc(matricule)}</span></div><button class="btn secondary sm" type="button" data-rep-reset-pin="${esc(key)}">Réinitialiser son code QR</button><button class="btn danger sm" type="button" data-rep-remove="${esc(key)}">Retirer</button></div>`;
    }).join("");
    byId("representative-manager").innerHTML = `<div class="representative-group-summary"><span class="news-tag">${esc(siteName(site))}</span><span class="news-tag">${esc(programName(program))}</span><span class="news-tag">${esc(level)}</span></div>${cards ? `<div class="representative-list">${cards}</div>` : `<div class="notice">Aucun responsable n’est encore désigné pour ce groupe.</div>`}<div class="representative-assign">${select}<button class="btn" type="button" data-rep-assign="${esc(`${site}|${program}|${level}`)}" ${candidates.length ? "" : "disabled"}>Ajouter un responsable</button></div><p class="field-help">Vous pouvez nommer plusieurs responsables pour le même groupe. Chacun garde son propre code pour afficher le QR du jour. Un étudiant ne peut être responsable que d’un seul groupe.</p>`;
  }
  async function assignRepresentative(key) {
    const [site, program, level] = key.split("|");
    const userId = byId("rep-student").value;
    if (!userId) { toast("Choisissez un étudiant approuvé dans ce groupe."); return; }
    const student = studentProfilesCache.find(item => item.studentId === userId && item.site === site && item.program === program && item.level === level && !item.bannedAt);
    if (!student) { toast("Cet étudiant n’appartient pas au groupe sélectionné."); return; }
    if (!window.confirm(`Désigner ${fullName(student)} comme responsable du groupe ${siteName(site)} · ${programName(program)} · ${level} ?`)) return;
    const { error } = await adminClient.rpc("admin_assign_class_representative", { p_student_id: userId, p_site: site, p_program: program, p_level: level });
    if (error) {
      toast(friendlyError(error, "Le responsable n’a pas pu être désigné. Vérifiez le groupe puis réessayez."));
      return;
    }
    toast(`${fullName(student)} a été ajouté aux responsables de ce groupe.`);
    await loadRepresentatives();
  }
  async function assignStudentFromRegistry(userId) {
    const person = studentProfilesCache.find(item => item.studentId === userId);
    if (!person) return;
    if (person.bannedAt) { toast("Un compte banni ne peut pas être responsable."); return; }
    if (!window.confirm(`Désigner ${fullName(person)} comme responsable de ${keyFor(person)} ? Les autres responsables de ce groupe restent en place.`)) return;
    const { error } = await adminClient.rpc("admin_assign_class_representative", { p_student_id: person.studentId, p_site: person.site, p_program: person.program, p_level: person.level });
    if (error) { toast(friendlyError(error, "Le rôle n’a pas pu être modifié. Réessayez.")); return; }
    toast(`${fullName(person)} est maintenant responsable de ${keyFor(person)}.`);
    await loadRepresentatives();
    renderStudents();
  }
  async function manageStudentAccount(userId, action) {
    const person = studentProfilesCache.find(item => item.studentId === userId);
    if (!person) return;
    const actionLabel = action === "ban" ? "Bannir" : action === "unban" ? "Débannir" : "Supprimer définitivement";
    const warning = action === "ban"
      ? `Bannir ${fullName(person)} ? Son accès étudiant sera bloqué.`
      : action === "unban"
        ? `Débannir ${fullName(person)} et rétablir son accès étudiant ?`
        : `Supprimer définitivement le compte de ${fullName(person)} ? Ses demandes, photos et présences liées seront supprimées. Cette action est irréversible.`;
    if (!window.confirm(warning)) return;
    const { data, error } = await adminClient.functions.invoke("manage-student-account", { body: { action, studentId: userId } });
    if (error || data?.error) {
      let detail = data?.error || "";
      if (!detail && error?.context?.json) { try { detail = (await error.context.json())?.error || ""; } catch {} }
      toast(detail || friendlyError(error, "L’action n’a pas abouti. Vérifiez que la fonction de gestion est déployée et réessayez."));
      return;
    }
    toast(action === "ban" ? `${fullName(person)} a été banni.` : action === "unban" ? `${fullName(person)} a été débanni et son accès est rétabli.` : `Le compte de ${fullName(person)} a été supprimé.`);
    await refreshCurrent();
  }
  async function removeRepresentative(key) {
    const [site, program, level, userId] = key.split("|");
    const person = studentProfilesCache.find(item => item.studentId === userId);
    const name = person ? fullName(person) : "ce responsable";
    if (!window.confirm(`Retirer ${name} des responsables du groupe ${siteName(site)} · ${programName(program)} · ${level} ?`)) return;
    const { error } = await adminClient.from("class_representatives").delete().eq("site", site).eq("program", program).eq("level", level).eq("user_id", userId);
    if (error) { toast(friendlyError(error, "Le responsable n’a pas pu être retiré. Réessayez.")); return; }
    toast("Responsable retiré du groupe.");
    await loadRepresentatives();
  }
  async function resetRepresentativePin(key) {
    const [site, program, level, userId] = key.split("|");
    const person = studentProfilesCache.find(item => item.studentId === userId);
    const name = person ? fullName(person) : "ce responsable";
    if (!window.confirm(`Réinitialiser le code secret de ${name} ? Cette personne devra en créer un nouveau.`)) return;
    const { error } = await adminClient.rpc("admin_reset_representative_daily_qr_pin", { p_site: site, p_program: program, p_level: level, p_student_id: userId });
    if (error) {
      const message = String(error.message || "").toLowerCase();
      const detail = message.includes("aucun responsable") ? "Aucun responsable n’est actuellement affecté à ce groupe. Actualisez la liste." : message.includes("site") || message.includes("permission") ? "Votre compte n’est pas autorisé à réinitialiser le code de ce site." : message.includes("function") || message.includes("schema cache") ? "La migration de réinitialisation n’est pas encore appliquée dans Supabase." : friendlyError(error, "Le code secret n’a pas pu être réinitialisé. Réessayez.");
      toast(detail); return;
    }
    toast("Code secret réinitialisé. Le responsable devra en créer un nouveau.");
  }
  async function toggleAnnouncement(id) {
    const item = announcementsCache.find(row => row.id === id);
    if (!item) return;
    const publish = item.status !== "published";
    if (!window.confirm(publish ? `Publier « ${item.title} » dans l’espace étudiant ?` : `Retirer « ${item.title} » de l’espace étudiant ?`)) return;
    try {
      const { data, error } = await adminClient.rpc("admin_set_campus_announcement_status", { p_announcement_id: id, p_status: publish ? "published" : "draft" });
      if (error || !data) { toast(friendlyError(error, "Cette actualité n’a pas pu être modifiée. Vérifiez que la migration du module Actualités est appliquée.")); return; }
      const push = publish ? await dispatchCampusPush({ kind: "announcement", id }) : null;
      await loadAnnouncements();
      toast(!publish ? "Actualité retirée de l’espace étudiant." : push?.error ? "Actualité publiée; notification en arrière-plan indisponible." : push.data?.sent ? `Actualité publiée; notification envoyée à ${push.data.sent} appareil(s).` : "Actualité publiée; aucun appareil n’a activé les notifications.");
    } catch {
      toast("Connexion interrompue : cette actualité n’a pas pu être modifiée.");
    }
  }
  async function setStudentCardSuspension(studentId, wasSuspended) {
    const person = studentProfilesCache.find(item => item.studentId === studentId);
    if (!person) return;
    const suspended = !wasSuspended;
    const question = suspended
      ? `Désactiver temporairement la carte de ${fullName(person)} ? Son QR ne fonctionnera plus et il sera retiré des listes de pointage. Son inscription et son matricule seront conservés.`
      : `Réactiver la carte de ${fullName(person)} ? Le même QR redeviendra valide.`;
    if (!window.confirm(question)) return;
    const { error } = await adminClient.rpc("admin_set_student_card_suspension", { p_student_id: studentId, p_suspended: suspended });
    if (error) { toast(friendlyError(error, "La carte n’a pas pu être mise à jour. Vérifiez que la migration de gestion des cartes est appliquée.")); return; }
    await refreshCurrent();
    toast(suspended ? "Carte désactivée temporairement; le QR est désormais refusé." : "Carte réactivée; son QR est de nouveau valide.");
  }
  async function saveSiteContact(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const site = form.dataset.siteContact;
    if (adminSite && site !== adminSite) { toast("Vous ne pouvez modifier que les contacts de votre site."); return; }
    const values = new FormData(form);
    if (!window.confirm(`Enregistrer les coordonnées de ${siteName(site)} ? Elles seront visibles par les étudiants de ce site.`)) return;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    const { data, error } = await adminClient.from("campus_site_contacts").update({ contact_name: String(values.get("contact_name")).trim(), address: String(values.get("address")).trim(), phone: String(values.get("phone")).trim(), updated_at: new Date().toISOString() }).eq("site", site).select("site,contact_name,address,phone,updated_at").maybeSingle();
    button.disabled = false;
    if (error || !data) { toast(friendlyError(error, "Les contacts n’ont pas été enregistrés. Vérifiez que la migration du catalogue est appliquée.")); return; }
    siteContactsCache = [...siteContactsCache.filter(row => row.site !== site), data];
    D.applySiteContacts([data]);
    renderCatalog();
    toast(`Contacts de ${siteName(site)} enregistrés pour les étudiants.`);
  }
  function renderCards() {
    const query = (byId("card-search").value || "").trim().toLowerCase();
    const list = approved().filter(item => [fullName(item), item.finalMatricule, programName(item.program), siteName(item.site)].join(" ").toLowerCase().includes(query));
    const selectableIds = new Set(approved().filter(item => !studentProfilesCache.find(row => row.studentId === item.studentId)?.cardSuspendedAt && item.photoPath).map(item => item.id));
    for (const id of selectedCardIds) if (!selectableIds.has(id)) selectedCardIds.delete(id);
    byId("card-rows").innerHTML = list.map(item => { const person = studentProfilesCache.find(row => row.studentId === item.studentId); const suspended = Boolean(person?.cardSuspendedAt); const selectable = !suspended && Boolean(item.photoPath); return `<tr><td><input type="checkbox" data-card-select="${esc(item.id)}" ${selectedCardIds.has(item.id) ? "checked" : ""} ${selectable ? "" : "disabled"} aria-label="Sélectionner le badge de ${esc(fullName(item))}"></td><td>${photoCell(item)}</td><td><strong>${esc(fullName(item))}</strong>${suspended ? `<span class="sub status rejected">Carte temporairement désactivée</span>` : ""}</td><td>${esc(item.finalMatricule)}</td><td>${esc(programName(item.program))}<span class="sub">${esc(item.level)}</span></td><td>${esc(siteName(item.site))}</td><td><div class="table-actions"><button class="btn secondary sm" data-preview-card="${esc(item.id)}">Prévisualiser</button><button class="btn ${suspended ? "" : "danger"} sm" data-card-suspension="${esc(item.studentId)}" data-suspended="${suspended ? "1" : "0"}">${suspended ? "Réactiver la carte" : "Désactiver temporairement"}</button></div></td></tr>`; }).join("") || `<tr><td colspan="7" class="table-empty">Aucune carte approuvée.</td></tr>`;
    const visibleChecks = [...byId("card-rows").querySelectorAll("[data-card-select]:not(:disabled)")];
    const checkedVisible = visibleChecks.filter(input => input.checked).length;
    byId("card-select-visible").checked = visibleChecks.length > 0 && checkedVisible === visibleChecks.length;
    byId("card-select-visible").indeterminate = checkedVisible > 0 && checkedVisible < visibleChecks.length;
    byId("card-selection-count").textContent = `${selectedCardIds.size} badge${selectedCardIds.size === 1 ? "" : "s"} sélectionné${selectedCardIds.size === 1 ? "" : "s"}`;
    byId("download-selected-cards").disabled = selectedCardIds.size === 0;
  }
  function auditReport(item) {
    const required = [item.firstName, item.lastName, item.email, item.phone, item.program, item.level, item.site, item.sex];
    const checks = [
      { name: "Prénom renseigné", ok: Boolean(item.firstName?.trim()) },
      { name: "Nom renseigné", ok: Boolean(item.lastName?.trim()) },
      { name: "Nom/prénom sans caractères inattendus", ok: safeName.test(item.firstName || "") && safeName.test(item.lastName || "") },
      { name: "E-mail au format valide", ok: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.email || "") },
      { name: "Sexe M ou F", ok: ["M", "F"].includes(item.sex) },
      { name: "Filière et niveau renseignés", ok: Boolean(item.program && D.levels.includes(item.level)) },
      { name: "Site renseigné", ok: D.sites.some(site => site.id === item.site) },
      { name: "Photo d’identité présente", ok: Boolean(item.photoPath) }
    ];
    return { checks, ok: required.every(Boolean) && checks.every(check => check.ok) };
  }
  async function openReview(id) {
    const item = applications().find(application => application.id === id);
    if (!item) return;
    const { data: signedPhoto, error: photoError } = await adminClient.storage.from("student-photos").createSignedUrl(item.photoPath, 600);
    if (photoError || !signedPhoto?.signedUrl) { toast("La photo privée n’a pas pu être ouverte. Vérifiez l’accès au bucket student-photos."); return; }
    item.photo = signedPhoto.signedUrl;
    reviewedId = id;
    const site = D.getSite(item.site);
    const report = auditReport(item);
    byId("review-title").textContent = fullName(item) || "Demande de badge";
    byId("review-subtitle").textContent = `Matricule temporaire ${item.temporaryMatricule} · reçue ${new Date(item.submittedAt).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}`;
    byId("review-content").innerHTML = `<div class="review-grid"><div class="review-photo-wrap">${item.photo ? `<img class="review-photo" src="${esc(item.photo)}" alt="Photo d’identité de ${esc(fullName(item))}">` : `<div class="review-photo photo-missing">Photo d’identité<br>non fournie</div>`}</div><div><h3>Renseignements soumis</h3><div class="review-info"><div><span>Nom</span><strong>${esc(item.lastName)}</strong></div><div><span>Prénom(s)</span><strong>${esc(item.firstName)}</strong></div><div><span>E-mail</span><strong>${esc(item.email)}</strong></div><div><span>Téléphone</span><strong>${esc(item.phone)}</strong></div><div><span>Sexe</span><strong>${esc(item.sex)}</strong></div><div><span>Naissance</span><strong>${esc(item.birthDate || "—")}</strong></div><div><span>Filière</span><strong>${esc(D.getProgram(item.program).name)}</strong></div><div><span>Niveau</span><strong>${esc(item.level)}</strong></div><div><span>Ville / site</span><strong>${esc(site.city)}</strong></div><div><span>Clé du groupe</span><strong>${esc(keyFor(item))}</strong></div><div><span>Matricule temporaire</span><strong>${esc(item.temporaryMatricule)}</strong></div></div></div></div><div class="audit-box"><div class="audit-heading"><div><div class="eyebrow">Rapport de vérification</div><h3>Contrôles du dossier</h3></div><span class="status ${report.ok ? "active" : "pending"}">${report.ok ? "Prêt à valider" : "À corriger"}</span></div><div class="audit-list">${report.checks.map(check => `<div class="audit-check ${check.ok ? "pass" : "fail"}"><span>${check.ok ? "OK" : "Non"}</span>${esc(check.name)}</div>`).join("")}</div></div>${item.status === "rejected" ? `<div class="notice" style="margin-top:12px"><strong>Motif enregistré :</strong> ${esc(item.rejectionReason || "—")}</div>` : ""}`;
    if (item.status === "pending") {
      byId("review-actions").innerHTML = `<label class="manual-photo-check"><input type="checkbox" id="photo-check" ${report.ok ? "" : "disabled"}><span>J’ai vérifié visuellement la tenue de l’école, la netteté de la photo, le visage visible et les cheveux bien peignés.</span></label><div class="field full"><label for="reject-reason">Motif de rejet (obligatoire pour rejeter)</label><textarea id="reject-reason" rows="2" placeholder="Expliquez brièvement la décision afin que l’étudiant sache quoi faire."></textarea></div><div class="review-buttons"><button class="btn danger" id="reject-request" type="button">Rejeter la demande</button><button class="btn" id="approve-request" type="button" disabled>Valider et attribuer le matricule</button></div><span class="field-help">Après approbation ou rejet, la demande ne revient pas à l’état « en attente ».</span>`;
      byId("photo-check").addEventListener("change", event => { byId("approve-request").disabled = !event.target.checked || !report.ok; });
      byId("approve-request").addEventListener("click", approveRequest);
      byId("reject-request").addEventListener("click", rejectRequest);
    } else {
      const final = item.finalMatricule ? `Matricule définitif : ${item.finalMatricule}` : "Aucun matricule définitif attribué.";
      byId("review-actions").innerHTML = `<div class="decision-summary">${statusHtml(item.status)} <strong>${esc(final)}</strong></div><span class="field-help">Cette décision est enregistrée et ne peut pas être remise en attente.</span>`;
    }
    byId("review-modal").classList.add("open");
  }
  async function approveRequest() {
    const list = applications();
    const item = list.find(application => application.id === reviewedId);
    if (!item || item.status !== "pending") return;
    const report = auditReport(item);
    if (!report.ok || !byId("photo-check")?.checked) { toast("Terminez les contrôles et confirmez la vérification visuelle de la photo."); return; }
    if (!window.confirm(`Approuver la demande de ${fullName(item)} et attribuer son matricule définitif ?`)) return;
    const button = byId("approve-request"); button.disabled = true;
    const { data, error } = await adminClient.rpc("admin_decide_application", { p_application_id: item.id, p_decision: "approved", p_reason: null });
    if (error) { button.disabled = false; toast(friendlyError(error, "La décision n’a pas pu être enregistrée. Réessayez.")); return; }
    closeReview();
    await refreshCurrent();
    const decided = Array.isArray(data) ? data[0] : data;
    const push = await dispatchCampusPush({ kind: "badge_approved", id: item.id });
    toast(push.error ? `Demande approuvée · ${decided.final_matricule}. Notification en arrière-plan indisponible.` : push.data?.sent ? `Demande approuvée · ${decided.final_matricule}. Notification envoyée${push.data.failed ? ` avec ${push.data.failed} échec(s)` : ""}.` : `Demande approuvée · ${decided.final_matricule}. Aucun appareil n’a activé les notifications.`);
  }
  async function rejectRequest() {
    const list = applications();
    const item = list.find(application => application.id === reviewedId);
    if (!item || item.status !== "pending") return;
    const reason = byId("reject-reason").value.trim();
    if (!reason) { toast("Indiquez un motif de rejet pour informer l’étudiant."); byId("reject-reason").focus(); return; }
    if (!window.confirm(`Rejeter la demande de ${fullName(item)} avec le motif indiqué ?`)) return;
    const button = byId("reject-request"); button.disabled = true;
    const { error } = await adminClient.rpc("admin_decide_application", { p_application_id: item.id, p_decision: "rejected", p_reason: reason });
    if (error) { button.disabled = false; toast(friendlyError(error, "Le rejet n’a pas pu être enregistré. Réessayez.")); return; }
    closeReview();
    await refreshCurrent();
    toast(`Demande rejetée · ${item.temporaryMatricule}.`);
  }
  function closeReview() { byId("review-modal").classList.remove("open"); reviewedId = ""; }
  async function refreshCurrent() {
    try { await loadAdminData(); }
    catch (error) { toast(friendlyError(error, "Les informations ne sont pas disponibles pour le moment. Réessayez.")); return; }
    renderDashboard(); if (currentView === "requests") renderRequests(); if (currentView === "accounts") renderStudentAccounts(); if (currentView === "students") renderStudents(); if (currentView === "attendance") renderAttendance(); if (currentView === "groups") renderGroups(); if (currentView === "representatives") await loadRepresentatives(); if (currentView === "catalog") renderCatalog(); if (currentView === "announcements") await loadAnnouncements(); if (currentView === "cards") renderCards();
  }
  async function drawAdminCard(item) {
    const { data: signedPhoto, error } = await adminClient.storage.from("student-photos").createSignedUrl(item.photoPath, 600);
    if (error || !signedPhoto?.signedUrl) { toast("La photo privée ne peut pas être chargée pour cette carte."); return; }
    item.photo = signedPhoto.signedUrl;
    byId("admin-card-zone").innerHTML = D.cardHtml(item, "admin-card-qr");
    const person = studentProfilesCache.find(profile => profile.studentId === item.studentId);
    if (person?.cardSuspendedAt) byId("admin-card-qr").innerHTML = '<span class="card-suspended-qr">CARTE DÉSACTIVÉE</span>';
    else if (window.QRCode) new QRCode(byId("admin-card-qr"), { text: `IRGIB-CARTE:${item.finalMatricule}`, width: 128, height: 128, colorDark: "#102a39", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M });
    else byId("admin-card-qr").innerHTML = '<div class="qr-fallback">QR indisponible</div>';
    byId("card-preview-title").textContent = `${fullName(item)} · ${item.finalMatricule}`;
    byId("card-preview-panel").style.display = "block";
    byId("card-preview-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function printableCardFace(face) {
    const clone = face.cloneNode(true);
    clone.querySelectorAll(".card-v2-qr").forEach(qrHost => {
      const canvas = qrHost.querySelector("canvas");
      const sourceImage = [...qrHost.querySelectorAll("img")].find(image => image.naturalWidth > 0);
      let qrSource = "";
      try { if (canvas?.width && canvas?.height) qrSource = canvas.toDataURL("image/png"); } catch {}
      if (!qrSource && sourceImage) qrSource = sourceImage.currentSrc || sourceImage.src;
      qrHost.replaceChildren();
      if (qrSource) {
        const image = document.createElement("img");
        image.src = qrSource;
        image.alt = "QR de vérification du badge";
        image.style.cssText = "display:block;width:100%;height:100%;max-width:100%;max-height:100%;object-fit:contain;background:#fff;filter:none";
        qrHost.append(image);
      } else {
        const fallback = document.createElement("span");
        fallback.className = "qr-fallback";
        fallback.textContent = "QR indisponible";
        qrHost.append(fallback);
      }
    });
    clone.querySelectorAll("img").forEach(image => {
      const src = image.getAttribute("src");
      if (src && !src.startsWith("data:")) image.src = new URL(src, location.href).href;
    });
    return clone.outerHTML;
  }
  async function downloadSelectedCards() {
    const selected = approved().filter(item => selectedCardIds.has(item.id));
    if (!selected.length) { toast("Sélectionnez au moins un badge actif."); return; }
    if (!window.QRCode) { toast("Le générateur QR n’est pas chargé. Rechargez la page puis réessayez."); return; }
    const printWindow = window.open("", "irgib-admin-bulk-cards", "popup,width=980,height=820");
    if (!printWindow) { toast("Autorisez l’ouverture de la fenêtre d’impression pour préparer le PDF."); return; }
    printWindow.opener = null;
    printWindow.document.open();
    printWindow.document.write("<!doctype html><html lang=\"fr\"><head><meta charset=\"utf-8\"><title>Préparation des badges</title></head><body style=\"font:16px Arial,sans-serif;padding:32px;color:#102a39\">Préparation des badges sélectionnés…</body></html>");
    printWindow.document.close();
    const staging = document.createElement("div");
    staging.style.cssText = "position:fixed;left:-100000px;top:0;width:85.6mm;pointer-events:none";
    document.body.append(staging);
    try {
      const sheets = [];
      for (let index = 0; index < selected.length; index += 1) {
        const item = selected[index];
        const person = studentProfilesCache.find(profile => profile.studentId === item.studentId);
        if (person?.cardSuspendedAt) throw new Error(`La carte de ${fullName(item)} est temporairement désactivée.`);
        const { data: signedPhoto, error } = await adminClient.storage.from("student-photos").createSignedUrl(item.photoPath, 3600);
        if (error || !signedPhoto?.signedUrl) throw new Error(`La photo de ${fullName(item)} n’a pas pu être chargée.`);
        const qrId = `admin-bulk-qr-${index}`;
        staging.innerHTML = D.cardHtml({ ...item, photo: signedPhoto.signedUrl }, qrId);
        const qrHost = staging.querySelector(`#${qrId}`);
        if (!qrHost) throw new Error(`Le QR de ${fullName(item)} n’a pas pu être préparé.`);
        new QRCode(qrHost, { text: `IRGIB-CARTE:${item.finalMatricule}`, width: 256, height: 256, colorDark: "#102a39", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M });
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const faces = [...staging.querySelectorAll(".card-v2")];
        if (faces.length !== 2) throw new Error(`Le recto et le verso de ${fullName(item)} ne sont pas prêts.`);
        const portrait = staging.querySelector(".card-v2-portrait img");
        if (portrait) {
          try { await portrait.decode(); } catch { throw new Error(`La photo de ${fullName(item)} ne peut pas être imprimée. Actualisez la liste et réessayez.`); }
          if (!portrait.naturalWidth) throw new Error(`La photo de ${fullName(item)} ne peut pas être imprimée. Actualisez la liste et réessayez.`);
        }
        const qrHostInCard = staging.querySelector(`#${qrId}`);
        const qrImage = [...(qrHostInCard?.querySelectorAll("img") || [])].find(image => image.naturalWidth > 0);
        if (!qrHostInCard?.querySelector("canvas") && !qrImage) throw new Error(`Le QR de ${fullName(item)} n’a pas été généré. Aucun PDF incomplet n’a été préparé.`);
        faces.forEach(face => sheets.push(`<section class=\"card-print-sheet\">${printableCardFace(face)}</section>`));
        staging.replaceChildren();
      }
      const stylesUrl = new URL("../assets/styles.css?v=20261030b", location.href).href;
      printWindow.document.open();
      printWindow.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Badges IRGIB AFRICA</title><link rel="stylesheet" href="${stylesUrl}"><style>@page{size:A4 portrait;margin:0}*{box-sizing:border-box}html,body{margin:0!important;padding:0!important;width:210mm!important;min-width:210mm!important;background:#fff!important}.card-print-sheet{width:210mm;height:297mm;display:grid;place-items:center;overflow:hidden;break-after:page;page-break-after:always}.card-print-sheet:last-child{break-after:auto;page-break-after:auto}.card-print-sheet .card-v2{width:85.6mm!important;height:53.98mm!important;min-width:85.6mm!important;max-width:85.6mm!important;aspect-ratio:auto!important;margin:0!important;padding:2.2mm 2.4mm!important;border-radius:2mm!important;box-shadow:none!important;overflow:hidden!important;break-inside:avoid!important;page-break-inside:avoid!important;print-color-adjust:exact!important;-webkit-print-color-adjust:exact!important}.card-print-sheet .card-v2-front{break-after:auto!important;page-break-after:auto!important}.card-print-sheet .card-v2.card-back{display:grid!important;break-before:auto!important;page-break-before:auto!important}.card-print-sheet img{print-color-adjust:exact;-webkit-print-color-adjust:exact}@media print{html,body{width:210mm!important;min-width:210mm!important}.card-print-sheet{height:297mm!important;break-after:page!important;page-break-after:always!important}.card-print-sheet:last-child{break-after:auto!important;page-break-after:auto!important}}.card-print-sheet .card-v2-qr{width:18mm!important;height:18mm!important;min-width:18mm!important;min-height:18mm!important;padding:.5mm!important;background:#fff!important;overflow:hidden!important;display:grid!important;place-items:center!important}.card-print-sheet .card-v2-verification{overflow:hidden!important;align-content:center!important;justify-items:center!important}.card-print-sheet .card-v2-qr img{display:block!important;width:100%!important;height:100%!important;max-width:100%!important;max-height:100%!important;object-fit:contain!important;background:#fff!important;filter:none!important;print-color-adjust:exact!important;-webkit-print-color-adjust:exact!important}</style></head><body>${sheets.join("")}<script>window.addEventListener('load',async()=>{await Promise.all([...document.images].map(i=>i.decode?.().catch(()=>{})));if(document.fonts?.ready)await document.fonts.ready;window.focus();setTimeout(()=>window.print(),250)});window.addEventListener('afterprint',()=>window.close());</script></body></html>`);
      printWindow.document.close();
      toast(`PDF préparé pour ${selected.length} badge${selected.length === 1 ? "" : "s"}.`);
    } catch (error) {
      printWindow.close();
      toast(error.message || "Les badges sélectionnés n’ont pas pu être préparés.");
    } finally { staging.remove(); }
  }
  function exportCsv(kind) {
    let rows = [];
    let filename = "";
    if (kind === "groups") {
      const counts = approved().reduce((memo, item) => { const key = keyFor(item); memo[key] = (memo[key] || 0) + 1; return memo; }, {});
      rows = [["cle_groupe", "ville", "code_filiere", "filiere", "niveau", "effectif"], ...D.allGroups().filter(group => !adminSite || group.site === adminSite).map(group => [group.key, siteName(group.site), group.program, programName(group.program), group.level, counts[group.key] || 0])]; filename = "groupes-irgib.csv";
    } else if (kind === "attendance") {
      rows = [["date", "heure", "cours", "etudiant", "matricule", "statut", "saisi_par", "cycle", "annee", "code_filiere", "filiere", "niveau", "site"], ...attendanceRoster().map(item => [D.todayKey(), item.createdAt ? new Date(item.createdAt).toLocaleTimeString("fr-FR") : "", item.courseTitle, fullName(item), item.matricule, item.present ? "present" : "absent", item.markedByName || "", item.level.startsWith("M") ? "Master" : "Licence", careerYear[item.level] || item.level, item.program, programName(item.program), item.level, siteName(item.site)])]; filename = "presences-jour.csv";
    } else {
      rows = [["matricule_final", "matricule_temporaire", "nom", "prenom", "email", "sexe", "code_filiere", "filiere", "niveau", "ville", "groupe", "statut_demande"], ...studentProfilesCache.map(person => { const app = applications().find(item => item.studentId === person.studentId); return [app?.finalMatricule || "", app?.temporaryMatricule || "", person.lastName, person.firstName, person.email, person.sex, person.program, programName(person.program), person.level, siteName(person.site), keyFor(person), app ? statusText(app.status) : "inscrit sans demande"]; })]; filename = "etudiants-irgib.csv";
    }
    const csv = "\uFEFF" + rows.map(row => row.map(value => `"${String(value ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); toast("Export CSV préparé.");
  }

  let adminClient = null;
  let appInitialized = false;
  function showAdminGate(message = "", canRetrySession = false) {
    byId("admin-app").hidden = true;
    byId("admin-auth-screen").hidden = false;
    byId("admin-auth-message").textContent = message;
    byId("admin-retry-session").hidden = !canRetrySession;
  }
  function initAdminApp() {
    // Rebuild scope-dependent options on every login. Event handlers are
    // installed once, but a new account must never inherit another site's filters.
    initGroupFilters();
    byId("rep-site").innerHTML = (adminSite ? D.sites.filter(site => site.id === adminSite) : D.sites).map(site => `<option value="${esc(site.id)}">${esc(site.city)}</option>`).join("");
    byId("rep-program").innerHTML = D.programs.map(item => `<option value="${esc(item.code)}">${esc(item.code)} · ${esc(programName(item.code))}</option>`).join("");
    byId("rep-level").innerHTML = D.levels.map(level => `<option value="${esc(level)}">${esc(level)}</option>`).join("");
    const announcementSite = byId("announcement-site");
    announcementSite.innerHTML = adminSite
      ? `<option value="${esc(adminSite)}">${esc(siteName(adminSite))} uniquement</option><option value="all">Tous les sites</option>`
      : `<option value="all">Tous les sites</option>${D.sites.map(site => `<option value="${esc(site.id)}">${esc(site.city)} uniquement</option>`).join("")}`;
    if (appInitialized) {
      setView(currentView);
      return;
    }
    appInitialized = true;
    const studentHeading = document.querySelector("#view-students .table-tools h3");
    if (studentHeading) studentHeading.textContent = "Étudiants inscrits";
    document.querySelectorAll(".side-nav [data-view]").forEach(button => button.addEventListener("click", () => setView(button.dataset.view)));
    document.querySelectorAll("[data-go]").forEach(button => button.addEventListener("click", () => setView(button.dataset.go)));
    document.querySelectorAll("[data-close-review]").forEach(button => button.addEventListener("click", closeReview));
    byId("review-modal").addEventListener("click", event => { if (event.target === byId("review-modal")) closeReview(); });
    byId("request-search").addEventListener("input", renderRequests);
    byId("request-filter").addEventListener("change", renderRequests);
    byId("account-search").addEventListener("input", renderStudentAccounts);
    byId("account-filter").addEventListener("change", renderStudentAccounts);
    byId("student-search").addEventListener("input", renderStudents);
    ["student-program-filter", "student-level-filter"].forEach(id => byId(id).addEventListener("change", renderStudents));
    byId("attendance-search").addEventListener("input", renderAttendance);
    ["attendance-site", "attendance-program", "attendance-level", "attendance-status"].forEach(id => byId(id).addEventListener("change", renderAttendance));
    byId("card-search").addEventListener("input", renderCards);
    byId("card-rows").addEventListener("change", event => {
      const input = event.target.closest("[data-card-select]");
      if (!input) return;
      if (input.checked) selectedCardIds.add(input.dataset.cardSelect);
      else selectedCardIds.delete(input.dataset.cardSelect);
      renderCards();
    });
    byId("card-select-visible").addEventListener("change", event => {
      byId("card-rows").querySelectorAll("[data-card-select]:not(:disabled)").forEach(input => {
        if (event.currentTarget.checked) selectedCardIds.add(input.dataset.cardSelect);
        else selectedCardIds.delete(input.dataset.cardSelect);
      });
      renderCards();
    });
    byId("download-selected-cards").addEventListener("click", () => void downloadSelectedCards());
    ["group-site", "group-program", "group-level"].forEach(id => byId(id).addEventListener("change", renderGroups));
    byId("announcement-form").addEventListener("submit", event => void publishAnnouncement(event));
    document.addEventListener("submit", event => {
      const contactForm = event.target instanceof HTMLFormElement ? event.target.closest("form[data-site-contact]") : null;
      if (contactForm) void saveSiteContact(event);
    });
    byId("announcement-media").addEventListener("change", event => {
      const preview = byId("announcement-media-preview");
      const file = event.currentTarget.files?.[0];
      if (!file) { preview.innerHTML = ""; return; }
      if (file.size > 50 * 1024 * 1024) { event.currentTarget.value = ""; preview.textContent = "Fichier trop volumineux : 50 Mo maximum."; return; }
      const url = URL.createObjectURL(file);
      preview.innerHTML = file.type.startsWith("video/") ? `<video class="news-media" src="${url}" controls muted playsinline></video>` : `<img class="news-media" src="${url}" alt="Aperçu de la pièce jointe">`;
    });
    byId("group-search").addEventListener("input", renderGroups);
    document.addEventListener("click", event => {
      const target = event.target instanceof Element ? event.target : event.target?.parentElement;
      const announcementToggle = target?.closest("[data-announcement-toggle]");
      if (announcementToggle) void toggleAnnouncement(announcementToggle.dataset.announcementToggle);
      const repAssign = target?.closest("[data-rep-assign]");
      if (repAssign) void assignRepresentative(repAssign.dataset.repAssign);
      const studentRole = target?.closest("[data-student-role]");
      if (studentRole) void assignStudentFromRegistry(studentRole.dataset.studentRole);
      const accountApprove = target?.closest("[data-account-approve]");
      if (accountApprove) void decideStudentAccount(accountApprove.dataset.accountApprove, true);
      const accountReject = target?.closest("[data-account-reject]");
      if (accountReject) void decideStudentAccount(accountReject.dataset.accountReject, false);
      const accountBan = target?.closest("[data-account-ban]");
      if (accountBan) void manageStudentAccount(accountBan.dataset.accountBan, "ban");
      const accountUnban = target?.closest("[data-account-unban]");
      if (accountUnban) void manageStudentAccount(accountUnban.dataset.accountUnban, "unban");
      const accountDelete = target?.closest("[data-account-delete]");
      if (accountDelete) void manageStudentAccount(accountDelete.dataset.accountDelete, "delete");
      const repRemove = target?.closest("[data-rep-remove]");
      if (repRemove) void removeRepresentative(repRemove.dataset.repRemove);
      const repResetPin = target?.closest("[data-rep-reset-pin]");
      if (repResetPin) void resetRepresentativePin(repResetPin.dataset.repResetPin);
      const review = target?.closest("[data-review]");
      if (review) void openReview(review.dataset.review);
      const preview = target?.closest("[data-preview-card]");
      if (preview) { const item = approved().find(application => application.id === preview.dataset.previewCard); if (item) void drawAdminCard(item); }
      const exportButton = target?.closest("[data-export]");
      if (exportButton) exportCsv(exportButton.dataset.export);
      const cardStatus = target?.closest("[data-card-suspension]");
      if (cardStatus) void setStudentCardSuspension(cardStatus.dataset.cardSuspension, cardStatus.dataset.suspended === "1");
    });
    byId("print-admin-card").addEventListener("click", () => { document.body.classList.add("print-card-mode", "admin-print-mode"); window.print(); setTimeout(() => document.body.classList.remove("print-card-mode", "admin-print-mode"), 900); });
    byId("admin-logout").addEventListener("click", async () => {
      if (!window.confirm("Voulez-vous vraiment vous déconnecter de l’espace administration ?")) return;
      const { error } = await adminClient.auth.signOut();
      showAdminGate(error ? "La déconnexion a échoué. Réessayez." : "Vous êtes déconnecté.");
    });
    ["rep-site", "rep-program", "rep-level"].forEach(id => byId(id).addEventListener("change", renderRepresentativeManager));
    renderDashboard();
  }
  async function authorizeAdmin(session) {
    if (!session) { showAdminGate("Connectez-vous avec votre compte administrateur."); return false; }
    currentAdminId = session.user.id;
    const { data: siteMemberships, error: siteError } = await adminClient.from("admin_site_members").select("site").eq("user_id", session.user.id);
    if (siteError) { showAdminGate("Votre session est conservée, mais le site n’a pas pu être vérifié. Réessayez sans vous reconnecter.", true); return false; }
    if (siteMemberships?.length > 1) {
      await adminClient.auth.signOut();
      showAdminGate("Ce compte est associé à plusieurs sites. Contactez l’administrateur principal.");
      return false;
    }
    if (siteMemberships?.length === 1) adminSite = siteMemberships[0].site;
    else {
      const { data: globalMembership, error: globalError } = await adminClient.from("admin_members").select("user_id").eq("user_id", session.user.id).maybeSingle();
      if (globalError) { showAdminGate("Votre session est conservée, mais l’autorisation n’a pas pu être vérifiée. Réessayez sans vous reconnecter.", true); return false; }
      if (!globalMembership) {
        await adminClient.auth.signOut();
        showAdminGate("Ce compte n’est pas autorisé à accéder à l’administration.");
        return false;
      }
      adminSite = null;
    }
    try { await loadAdminData(); }
    catch (error) {
      showAdminGate("Votre session est conservée, mais les données du campus ne sont pas disponibles. Réessayez sans vous reconnecter.", true);
      return false;
    }
    byId("admin-user-label").textContent = adminSite ? `${session.user.email || "Administration"} · ${siteName(adminSite)}` : (session.user.email || "Administration");
    byId("admin-profile-mark").textContent = (session.user.email || "A").trim().charAt(0).toUpperCase();
    byId("admin-auth-screen").hidden = true;
    byId("admin-app").hidden = false;
    initAdminApp();
    adminClient.channel("irgib-admin-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "badge_applications" }, () => { void refreshCurrent(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "student_profiles" }, () => { void refreshCurrent(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "attendance_records" }, () => { void refreshCurrent(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "attendance_sessions" }, () => { void refreshCurrent(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "class_representatives" }, () => { if (currentView === "representatives") void loadRepresentatives(); })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "campus_site_contacts" }, () => { void refreshCurrent(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "campus_announcements" }, () => { if (currentView === "announcements") void loadAnnouncements(); })
      .subscribe();
    return true;
  }
  async function bootAdminAuth() {
    const config = window.IRGIB_SUPABASE_CONFIG;
    if (!config?.url || !config?.anonKey) {
      showAdminGate("L’espace administration n’est pas disponible pour le moment. Contactez l’administration principale.");
      return;
    }
    if (!window.supabase?.createClient) { showAdminGate("Le service d’authentification n’a pas pu se charger. Vérifiez la connexion Internet puis rechargez la page."); return; }
    try {
      const projectRef = new URL(config.url).hostname.split(".")[0];
      const authStorageKey = `irgib-admin-${projectRef}-auth`;
      const legacyAuthStorageKey = `sb-${projectRef}-auth-token`;
      try {
        if (!localStorage.getItem(authStorageKey)) {
          const legacySession = localStorage.getItem(legacyAuthStorageKey);
          if (legacySession) {
            localStorage.setItem(authStorageKey, legacySession);
            localStorage.removeItem(legacyAuthStorageKey);
          }
        }
      } catch { /* Session persistence is handled by Supabase when browser storage is available. */ }
      adminClient = window.supabase.createClient(config.url, config.anonKey, { auth: { storageKey: authStorageKey, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
      const { data, error } = await adminClient.auth.getSession();
      if (error) throw error;
      await authorizeAdmin(data.session);
      adminClient.auth.onAuthStateChange(event => {
        if (event === "SIGNED_OUT") showAdminGate("Vous êtes déconnecté.");
      });
    } catch {
      showAdminGate("La session n’a pas pu être vérifiée pour le moment. Réessayez avant de saisir à nouveau vos identifiants.", true);
    }
  }
  byId("admin-retry-session").addEventListener("click", async () => {
    const button = byId("admin-retry-session");
    button.disabled = true;
    byId("admin-auth-message").textContent = "Vérification de la session conservée…";
    try {
      const { data, error } = await adminClient.auth.getSession();
      if (error) throw error;
      if (!data.session) { showAdminGate("La session a expiré. Connectez-vous pour continuer."); return; }
      await authorizeAdmin(data.session);
    } catch {
      showAdminGate("Impossible de joindre le service pour vérifier la session. Réessayez dans un instant.", true);
    } finally { button.disabled = false; }
  });
  byId("admin-login-form").addEventListener("submit", async event => {
    event.preventDefault();
    const email = byId("admin-email").value.trim();
    const password = byId("admin-password").value;
    const button = byId("admin-login-submit");
    if (!email || !password) { byId("admin-auth-message").textContent = "Saisissez votre adresse e-mail et votre mot de passe."; return; }
    if (!adminClient) { byId("admin-auth-message").textContent = "Le service de connexion est momentanément indisponible. Rechargez la page puis réessayez."; return; }
    button.disabled = true;
    byId("admin-auth-message").textContent = "Vérification du compte…";
    try {
      const { data, error } = await adminClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      const authorized = await authorizeAdmin(data.session);
      if (!authorized) byId("admin-password").value = "";
    } catch (error) {
      const code = String(error?.code || "");
      const message = String(error?.message || "").toLowerCase();
      if (code === "email_not_confirmed" || message.includes("email not confirmed")) {
        byId("admin-auth-message").textContent = "Confirmez votre adresse e-mail avant de vous connecter.";
      } else if (code === "invalid_credentials" || message.includes("invalid login credentials")) {
        byId("admin-auth-message").textContent = "Adresse e-mail ou mot de passe incorrect.";
      } else if (code === "user_not_found" || message.includes("user not found")) {
        byId("admin-auth-message").textContent = "Aucun compte ne correspond à cette adresse e-mail.";
      } else {
        byId("admin-auth-message").textContent = friendlyError(error, "Connexion refusée. Vérifiez vos identifiants ou contactez l’administration principale.");
      }
    } finally { button.disabled = false; }
  });
  bootAdminAuth();
})();
