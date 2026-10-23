(() => {
  const D = window.IRGIB_DATA;
  const byId = id => document.getElementById(id);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const fullName = item => `${item.firstName || ""} ${item.lastName || ""}`.trim();
  const safeName = /^[\p{L}\p{M} .’'-]+$/u;
  let currentView = "dashboard";
  let reviewedId = "";
  let toastTimer;
  let applicationsCache = [];
  let studentProfilesCache = [];
  let attendanceCache = [];
  let announcementsCache = [];
  let representativesCache = [];
  let adminSite = null;
  let currentAdminId = "";
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
    studentProfilesCache = profiles.map(row => ({ studentId: row.user_id, firstName: row.first_name, lastName: row.last_name, email: row.email, phone: row.phone, sex: row.sex, program: row.program, level: row.level, site: row.site, birthDate: row.birth_date, bannedAt: row.banned_at || null }));
    const records = [];
    for (let from = 0; ; from += 500) {
      const { data, error } = await adminClient.from("attendance_records")
        .select("status,attended_at,session_id,marked_by,student_profiles!inner(user_id,first_name,last_name,email,program,level,site),attendance_sessions!inner(site,program,level,session_day,course_title)")
        .eq("attendance_sessions.session_day", D.todayKey())
        .order("attended_at", { ascending: false, nullsFirst: false }).order("id", { ascending: false }).range(from, from + 499);
      if (error) throw error;
      records.push(...(data || []));
      if (!data || data.length < 500) break;
    }
    const byStudent = new Map(applicationsCache.map(item => [item.studentId, item]));
    attendanceCache = (records || []).map(row => {
      const person = row.student_profiles; const app = byStudent.get(person.user_id); const actor = row.marked_by ? byStudent.get(row.marked_by) : null;
      return { studentId: person.user_id, markedBy: row.marked_by, markedByName: actor ? fullName(actor) : "Étudiant", createdAt: row.attended_at, day: row.attendance_sessions.session_day, sessionCode: row.session_id.slice(0, 8), courseTitle: row.attendance_sessions.course_title, present: row.status === "present", firstName: person.first_name, lastName: person.last_name, email: person.email, matricule: app?.finalMatricule || app?.temporaryMatricule || "", program: person.program, level: person.level, site: person.site };
    });
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
    const labels = { dashboard: "Vue d’ensemble", requests: "Demandes de badge", students: "Étudiants", attendance: "Présences", groups: "Groupes", representatives: "Responsables de classe", catalog: "Catalogue", announcements: "Actualités", cards: "Cartes" };
    byId("breadcrumb").textContent = `Campus / ${labels[view]}`;
    ({ dashboard: renderDashboard, requests: renderRequests, students: () => void loadRepresentatives().then(renderStudents), attendance: renderAttendance, groups: renderGroups, representatives: () => void loadRepresentatives(), catalog: renderCatalog, announcements: () => void loadAnnouncements(), cards: renderCards })[view]?.();
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
    const list = studentProfilesCache.filter(person => {
      const app = applications().find(item => item.studentId === person.studentId);
      return [fullName(person), person.email, app?.finalMatricule, app?.temporaryMatricule, programName(person.program), person.level, siteName(person.site)].join(" ").toLowerCase().includes(query);
    });
    byId("student-count").textContent = `${list.length} étudiant${list.length === 1 ? "" : "s"}`;
    byId("student-rows").innerHTML = list.map(person => {
      const app = applications().find(item => item.studentId === person.studentId);
      const rep = representativesCache.find(item => item.user_id === person.studentId);
      const inGroupRep = representativesCache.some(item => item.site === person.site && item.program === person.program && item.level === person.level);
      return `<tr><td>${app ? photoCell(app) : `<span class="table-photo photo-empty">—</span>`}</td><td><strong>${esc(fullName(person))}</strong><span class="sub">${esc(person.email)}</span>${person.bannedAt ? `<span class="sub status rejected">Compte banni</span>` : ""}</td><td><strong>${esc(app?.finalMatricule || app?.temporaryMatricule || "—")}</strong><span class="sub">${app ? statusText(app.status) : "Inscrit · demande non envoyée"}</span></td><td>${esc(person.sex)}</td><td>${esc(programName(person.program))}<span class="sub">${esc(person.level)}</span></td><td>${esc(siteName(person.site))}</td><td>${esc(keyFor(person))}</td><td class="student-admin-actions"><button class="btn secondary sm" type="button" data-student-role="${esc(person.studentId)}" ${person.bannedAt || rep ? "disabled" : ""}>${rep ? "Déjà responsable" : inGroupRep ? "Remplacer responsable" : "Nommer responsable"}</button>${person.bannedAt ? `<span class="small muted">Banni</span>` : `<button class="btn danger sm" type="button" data-student-ban="${esc(person.studentId)}">Bannir</button>`}<button class="btn danger sm" type="button" data-student-delete="${esc(person.studentId)}">Supprimer</button></td></tr>`;
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
    byId("group-site").innerHTML = `<option value="">Toutes les villes</option>${D.sites.map(item => `<option value="${item.id}">${esc(item.city)}</option>`).join("")}`;
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
    byId("program-grid").innerHTML = D.programs.map(program => `<article class="program-card"><span class="program-code">${esc(program.code)}</span><div class="program-title">${esc(program.name)}</div><div class="program-meta"><span>${esc(program.note)}</span><span class="status ${program.status === "Confirmé" ? "active" : "pending"}">${esc(program.status)}</span></div></article>`).join("");
    byId("site-grid").innerHTML = D.sites.map(site => `<article class="site-card"><span class="site-code">Zone ${esc(site.zone)}</span><strong>${esc(site.city)}</strong>${site.points.map(point => `<p>${esc(point.address)}<br>${esc(point.phone)}</p>`).join("")}</article>`).join("");
  }
  function renderAnnouncements() {
    const host = byId("announcement-admin-rows");
    if (!announcementsCache.length) {
      host.innerHTML = `<div class="news-empty"><strong>Aucune publication pour le moment</strong><p>Les annonces que vous publiez apparaîtront ici.</p></div>`;
      return;
    }
    host.innerHTML = announcementsCache.map(item => `<article class="announcement-admin-item"><div class="announcement-admin-meta"><span class="news-tag">${item.site ? esc(siteName(item.site)) : "Tous les campus"}</span><span class="status ${item.status === "published" ? "active" : "pending"}">${item.status === "published" ? "Publiée" : item.status === "archived" ? "Archivée" : "Brouillon"}</span></div><h3>${esc(item.title)}</h3><p>${esc(item.body)}</p>${item.mediaUrl ? (item.media_type === "video" ? `<video class="news-media" src="${esc(item.mediaUrl)}" controls playsinline preload="metadata"></video>` : `<img class="news-media" src="${esc(item.mediaUrl)}" alt="Aperçu : ${esc(item.title)}" loading="lazy">`) : ""}<small>${item.published_at ? new Date(item.published_at).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" }) : "Pas encore publiée"}</small><button class="btn secondary sm" type="button" data-announcement-toggle="${esc(item.id)}">${item.status === "published" ? "Retirer de l’espace étudiant" : "Publier maintenant"}</button></article>`).join("");
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
    const { data, error } = await adminClient.from("campus_announcements").select("id,title,body,site,status,published_at,expires_at,created_at,media_path,media_type").order("created_at", { ascending: false }).limit(50);
    if (error) { host.innerHTML = `<div class="notice">Impossible de charger les actualités. Vérifiez que la migration des annonces est appliquée.</div>`; return; }
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
    button.disabled = true;
    message.textContent = "Publication en cours…";
    let mediaPath = null;
    try {
      const id = crypto.randomUUID();
      const site = byId("announcement-site").value || null;
      if (file) {
        const extension = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4", "video/webm": "webm" })[file.type];
        mediaPath = `${site || "all"}/${id}/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await adminClient.storage.from("campus-announcement-media").upload(mediaPath, file, { contentType: file.type, cacheControl: "3600", upsert: false });
        if (uploadError) throw uploadError;
      }
      const { error } = await adminClient.from("campus_announcements").insert({ id, title, body, site, status: "published", published_at: new Date().toISOString(), expires_at: byId("announcement-expiry").value || null, created_by: currentAdminId, media_path: mediaPath, media_type: file?.type.startsWith("video/") ? "video" : file ? "image" : null });
      if (error) {
        if (mediaPath) await adminClient.storage.from("campus-announcement-media").remove([mediaPath]).catch(() => {});
        message.textContent = error.message || "La publication n’a pas pu être enregistrée."; return;
      }
      form.reset();
      byId("announcement-media-preview").innerHTML = "";
      const push = await dispatchCampusPush({ kind: "announcement", id });
      message.textContent = push.error ? "Actualité publiée. Les étudiants connectés la verront; l’envoi en arrière-plan est momentanément indisponible." : push.data?.sent ? `Actualité publiée et notification envoyée à ${push.data.sent} appareil${push.data.sent === 1 ? "" : "s"}${push.data.failed ? ` · ${push.data.failed} échec(s)` : ""}.` : "Actualité publiée. Aucun appareil étudiant n’a encore activé les notifications.";
      await loadAnnouncements();
    } catch (error) {
      if (mediaPath) await adminClient.storage.from("campus-announcement-media").remove([mediaPath]).catch(() => {});
      message.textContent = error?.message || "Connexion interrompue : l’actualité n’a pas pu être publiée. Réessayez.";
    } finally {
      button.disabled = false;
    }
  }
  async function loadRepresentatives() {
    const host = byId("representative-manager");
    host.innerHTML = `<div class="news-empty"><strong>Chargement…</strong></div>`;
    const { data, error } = await adminClient.from("class_representatives").select("site,program,level,user_id,assigned_at").order("site").order("program").order("level");
    if (error) { host.innerHTML = `<div class="notice">Le registre des responsables est indisponible. Appliquez la nouvelle migration Supabase.</div>`; return; }
    representativesCache = data || [];
    renderRepresentativeManager();
  }
  function renderRepresentativeManager() {
    const site = byId("rep-site").value || adminSite || D.sites[0].id;
    const program = byId("rep-program").value || D.programs[0].code;
    const level = byId("rep-level").value || D.levels[0];
    const assignment = representativesCache.find(item => item.site === site && item.program === program && item.level === level);
    const candidates = studentProfilesCache.filter(item => item.site === site && item.program === program && item.level === level && !item.bannedAt);
    const current = assignment && studentProfilesCache.find(item => item.studentId === assignment.user_id);
    const select = `<label for="rep-student">Étudiant du groupe</label><select id="rep-student"><option value="">${candidates.length ? "Choisir dans le groupe" : "Aucun étudiant disponible"}</option>${candidates.map(item => `<option value="${esc(item.studentId)}" ${assignment?.user_id === item.studentId ? "selected" : ""}>${esc(fullName(item))} · ${esc(applications().find(app => app.studentId === item.studentId)?.finalMatricule || applications().find(app => app.studentId === item.studentId)?.temporaryMatricule || "Sans matricule")}</option>`).join("")}</select>`;
    byId("representative-manager").innerHTML = `<div class="representative-group-summary"><span class="news-tag">${esc(siteName(site))}</span><span class="news-tag">${esc(programName(program))}</span><span class="news-tag">${esc(level)}</span></div>${assignment ? `<div class="representative-current"><div><small>Responsable actuel</small><strong>${esc(current ? fullName(current) : "Compte affecté, étudiant non trouvé")}</strong><span>${esc(applications().find(app => app.studentId === assignment.user_id)?.finalMatricule || "")}</span></div><button class="btn secondary sm" type="button" data-rep-reset-pin="${esc(`${site}|${program}|${level}`)}">Réinitialiser son code QR</button><button class="btn danger sm" type="button" data-rep-remove="${esc(`${site}|${program}|${level}`)}">Retirer</button></div>` : `<div class="notice">Aucun responsable n’est encore désigné pour ce groupe.</div>`}<div class="representative-assign">${select}<button class="btn" type="button" data-rep-assign="${esc(`${site}|${program}|${level}`)}">${assignment ? "Remplacer le responsable" : "Désigner le responsable"}</button></div><p class="field-help">L’administrateur peut désigner tout étudiant actif de ce groupe, même si sa carte n’est pas encore approuvée. Un responsable actif est associé à un seul groupe.</p>`;
  }
  async function assignRepresentative(key) {
    const [site, program, level] = key.split("|");
    const userId = byId("rep-student").value;
    if (!userId) { toast("Choisissez un étudiant approuvé dans ce groupe."); return; }
    const student = studentProfilesCache.find(item => item.studentId === userId && item.site === site && item.program === program && item.level === level && !item.bannedAt);
    if (!student) { toast("Cet étudiant n’appartient pas au groupe sélectionné."); return; }
    const { error } = await adminClient.rpc("admin_assign_class_representative", { p_student_id: userId, p_site: site, p_program: program, p_level: level });
    if (error) {
      const message = /permission denied|row-level security/i.test(error.message || "")
        ? "Votre compte admin n’est pas autorisé sur ce site."
        : error.message || "Le responsable n’a pas pu être désigné.";
      toast(message);
      return;
    }
    toast(`${fullName(student)} est maintenant responsable de ce groupe.`);
    await loadRepresentatives();
  }
  async function assignStudentFromRegistry(userId) {
    const person = studentProfilesCache.find(item => item.studentId === userId);
    if (!person) return;
    if (person.bannedAt) { toast("Un compte banni ne peut pas être responsable."); return; }
    const { error } = await adminClient.rpc("admin_assign_class_representative", { p_student_id: person.studentId, p_site: person.site, p_program: person.program, p_level: person.level });
    if (error) { toast(error.message || "Le rôle n’a pas pu être modifié."); return; }
    toast(`${fullName(person)} est maintenant responsable de ${keyFor(person)}.`);
    await loadRepresentatives();
    renderStudents();
  }
  async function manageStudentAccount(userId, action) {
    const person = studentProfilesCache.find(item => item.studentId === userId);
    if (!person) return;
    const actionLabel = action === "ban" ? "Bannir" : "Supprimer définitivement";
    const warning = action === "ban"
      ? `Bannir ${fullName(person)} ? Sa session sera fermée et son accès sera bloqué.`
      : `Supprimer définitivement le compte de ${fullName(person)} ? Ses demandes, photos et présences liées seront supprimées. Cette action est irréversible.`;
    if (!window.confirm(warning)) return;
    const { data, error } = await adminClient.functions.invoke("manage-student-account", { body: { action, studentId: userId } });
    if (error || data?.error) { toast(data?.error || error?.message || "L’action n’a pas abouti."); return; }
    toast(action === "ban" ? `${fullName(person)} a été banni et déconnecté.` : `Le compte de ${fullName(person)} a été supprimé.`);
    await refreshCurrent();
  }
  async function removeRepresentative(key) {
    const [site, program, level] = key.split("|");
    const { error } = await adminClient.from("class_representatives").delete().eq("site", site).eq("program", program).eq("level", level);
    if (error) { toast(error.message || "Le responsable n’a pas pu être retiré."); return; }
    toast("Responsable retiré du groupe.");
    await loadRepresentatives();
  }
  async function resetRepresentativePin(key) {
    if (!window.confirm("Réinitialiser le code secret du responsable ? Il devra en créer un nouveau.")) return;
    const [site, program, level] = key.split("|");
    const { error } = await adminClient.rpc("admin_reset_representative_daily_qr_pin", { p_site: site, p_program: program, p_level: level });
    if (error) { toast(error.message || "Le code secret n’a pas pu être réinitialisé."); return; }
    toast("Code secret réinitialisé. Le responsable devra en créer un nouveau.");
  }
  async function toggleAnnouncement(id) {
    const item = announcementsCache.find(row => row.id === id);
    if (!item) return;
    const publish = item.status !== "published";
    try {
      const { data, error } = await adminClient.from("campus_announcements").update({ status: publish ? "published" : "draft", published_at: publish ? (item.published_at || new Date().toISOString()) : item.published_at }).eq("id", id).select("id").maybeSingle();
      if (error || !data) { toast(error?.message || "Cette actualité n’a pas pu être modifiée. Vérifiez les droits du site."); return; }
      const push = publish ? await dispatchCampusPush({ kind: "announcement", id }) : null;
      await loadAnnouncements();
      toast(!publish ? "Actualité retirée de l’espace étudiant." : push?.error ? "Actualité publiée; notification en arrière-plan indisponible." : push.data?.sent ? `Actualité publiée; notification envoyée à ${push.data.sent} appareil(s).` : "Actualité publiée; aucun appareil n’a activé les notifications.");
    } catch {
      toast("Connexion interrompue : cette actualité n’a pas pu être modifiée.");
    }
  }
  function renderCards() {
    const query = (byId("card-search").value || "").trim().toLowerCase();
    const list = approved().filter(item => [fullName(item), item.finalMatricule, programName(item.program), siteName(item.site)].join(" ").toLowerCase().includes(query));
    byId("card-rows").innerHTML = list.map(item => `<tr><td>${photoCell(item)}</td><td><strong>${esc(fullName(item))}</strong></td><td>${esc(item.finalMatricule)}</td><td>${esc(programName(item.program))}<span class="sub">${esc(item.level)}</span></td><td>${esc(siteName(item.site))}</td><td><button class="btn secondary sm" data-preview-card="${esc(item.id)}">Prévisualiser</button></td></tr>`).join("") || `<tr><td colspan="6" class="table-empty">Aucune carte approuvée.</td></tr>`;
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
    byId("review-content").innerHTML = `<div class="review-grid"><div class="review-photo-wrap">${item.photo ? `<img class="review-photo" src="${esc(item.photo)}" alt="Photo d’identité de ${esc(fullName(item))}">` : `<div class="review-photo photo-missing">Photo d’identité<br>non fournie</div>`}<span class="field-help">${esc(item.photoFileName || "Aucun nom de fichier")}</span></div><div><h3>Renseignements soumis</h3><div class="review-info"><div><span>Nom</span><strong>${esc(item.lastName)}</strong></div><div><span>Prénom(s)</span><strong>${esc(item.firstName)}</strong></div><div><span>E-mail</span><strong>${esc(item.email)}</strong></div><div><span>Téléphone</span><strong>${esc(item.phone)}</strong></div><div><span>Sexe</span><strong>${esc(item.sex)}</strong></div><div><span>Naissance</span><strong>${esc(item.birthDate || "—")}</strong></div><div><span>Filière</span><strong>${esc(D.getProgram(item.program).name)}</strong></div><div><span>Niveau</span><strong>${esc(item.level)}</strong></div><div><span>Ville / site</span><strong>${esc(site.city)}</strong></div><div><span>Clé du groupe</span><strong>${esc(keyFor(item))}</strong></div><div><span>Matricule temporaire</span><strong>${esc(item.temporaryMatricule)}</strong></div></div></div></div><div class="audit-box"><div class="audit-heading"><div><div class="eyebrow">Rapport de vérification</div><h3>Contrôles du dossier</h3></div><span class="status ${report.ok ? "active" : "pending"}">${report.ok ? "Prêt à valider" : "À corriger"}</span></div><div class="audit-list">${report.checks.map(check => `<div class="audit-check ${check.ok ? "pass" : "fail"}"><span>${check.ok ? "OK" : "Non"}</span>${esc(check.name)}</div>`).join("")}</div><p class="small muted" style="margin:10px 0 0">Le rapport aide au contrôle : l’approbation reste une décision de l’administration. Le matricule final doit être unique, tous sites et promotions confondus.</p></div>${item.status === "rejected" ? `<div class="notice" style="margin-top:12px"><strong>Motif enregistré :</strong> ${esc(item.rejectionReason || "—")}</div>` : ""}`;
    if (item.status === "pending") {
      byId("review-actions").innerHTML = `<label class="manual-photo-check"><input type="checkbox" id="photo-check" ${report.ok ? "" : "disabled"}><span>J’ai vérifié visuellement la tenue de l’école, la netteté de la photo, le visage visible et les cheveux bien peignés.</span></label><div class="field full"><label for="reject-reason">Motif de rejet (obligatoire pour rejeter)</label><textarea id="reject-reason" rows="2" placeholder="Expliquez brièvement la décision afin que l’étudiant sache quoi faire."></textarea></div><div class="review-buttons"><button class="btn danger" id="reject-request" type="button">Rejeter la demande</button><button class="btn" id="approve-request" type="button" disabled>Valider et attribuer le matricule</button></div><span class="field-help">Après approbation ou rejet, la demande ne revient pas à l’état en attente.</span>`;
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
    const button = byId("approve-request"); button.disabled = true;
    const { data, error } = await adminClient.rpc("admin_decide_application", { p_application_id: item.id, p_decision: "approved", p_reason: null });
    if (error) { button.disabled = false; toast(error.message || "La décision n’a pas pu être enregistrée."); return; }
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
    const button = byId("reject-request"); button.disabled = true;
    const { error } = await adminClient.rpc("admin_decide_application", { p_application_id: item.id, p_decision: "rejected", p_reason: reason });
    if (error) { button.disabled = false; toast(error.message || "Le rejet n’a pas pu être enregistré."); return; }
    closeReview();
    await refreshCurrent();
    toast(`Demande rejetée · ${item.temporaryMatricule}.`);
  }
  function closeReview() { byId("review-modal").classList.remove("open"); reviewedId = ""; }
  async function refreshCurrent() {
    try { await loadAdminData(); }
    catch (error) { toast(error.message || "Les données ne sont pas joignables. Réessayez."); return; }
    renderDashboard(); if (currentView === "requests") renderRequests(); if (currentView === "students") renderStudents(); if (currentView === "attendance") renderAttendance(); if (currentView === "groups") renderGroups(); if (currentView === "representatives") await loadRepresentatives(); if (currentView === "announcements") await loadAnnouncements(); if (currentView === "cards") renderCards();
  }
  async function drawAdminCard(item) {
    const { data: signedPhoto, error } = await adminClient.storage.from("student-photos").createSignedUrl(item.photoPath, 600);
    if (error || !signedPhoto?.signedUrl) { toast("La photo privée ne peut pas être chargée pour cette carte."); return; }
    item.photo = signedPhoto.signedUrl;
    byId("admin-card-zone").innerHTML = D.cardHtml(item, "admin-card-qr");
    const qrHost = byId("admin-card-qr");
    if (window.QRCode) {
      qrHost.innerHTML = "";
      new QRCode(qrHost, { text: `IRGIB-CARTE:${item.finalMatricule}`, width: 180, height: 180, colorDark: "#102a39", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M });
      const canvas = qrHost.querySelector("canvas");
      if (canvas) {
        const image = document.createElement("img");
        image.className = "card-qr-image";
        image.alt = "QR de vérification du badge";
        image.src = canvas.toDataURL("image/png");
        qrHost.querySelectorAll("canvas, img").forEach(node => node.remove());
        qrHost.append(image);
      }
    } else qrHost.innerHTML = '<div class="qr-fallback">QR indisponible</div>';
    byId("card-preview-title").textContent = `${fullName(item)} · ${item.finalMatricule}`;
    byId("card-preview-panel").style.display = "block";
    byId("card-preview-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function exportCsv(kind) {
    let rows = [];
    let filename = "";
    if (kind === "groups") {
      const counts = approved().reduce((memo, item) => { const key = keyFor(item); memo[key] = (memo[key] || 0) + 1; return memo; }, {});
      rows = [["cle_groupe", "ville", "code_filiere", "filiere", "niveau", "effectif"], ...D.allGroups().map(group => [group.key, siteName(group.site), group.program, programName(group.program), group.level, counts[group.key] || 0])]; filename = "groupes-irgib.csv";
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
  function showAdminGate(message = "") {
    byId("admin-app").hidden = true;
    byId("admin-auth-screen").hidden = false;
    byId("admin-auth-message").textContent = message;
  }
  function initAdminApp() {
    if (appInitialized) return;
    appInitialized = true;
    const studentHeading = document.querySelector("#view-students .table-tools h3");
    if (studentHeading) studentHeading.textContent = "Étudiants inscrits";
    document.querySelectorAll(".side-nav [data-view]").forEach(button => button.addEventListener("click", () => setView(button.dataset.view)));
    document.querySelectorAll("[data-go]").forEach(button => button.addEventListener("click", () => setView(button.dataset.go)));
    document.querySelectorAll("[data-close-review]").forEach(button => button.addEventListener("click", closeReview));
    byId("review-modal").addEventListener("click", event => { if (event.target === byId("review-modal")) closeReview(); });
    byId("request-search").addEventListener("input", renderRequests);
    byId("request-filter").addEventListener("change", renderRequests);
    byId("student-search").addEventListener("input", renderStudents);
    byId("attendance-search").addEventListener("input", renderAttendance);
    ["attendance-site", "attendance-program", "attendance-level", "attendance-status"].forEach(id => byId(id).addEventListener("change", renderAttendance));
    byId("card-search").addEventListener("input", renderCards);
    ["group-site", "group-program", "group-level"].forEach(id => byId(id).addEventListener("change", renderGroups));
    byId("announcement-form").addEventListener("submit", event => void publishAnnouncement(event));
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
      const studentBan = target?.closest("[data-student-ban]");
      if (studentBan) void manageStudentAccount(studentBan.dataset.studentBan, "ban");
      const studentDelete = target?.closest("[data-student-delete]");
      if (studentDelete) void manageStudentAccount(studentDelete.dataset.studentDelete, "delete");
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
    });
    byId("print-admin-card").addEventListener("click", () => { document.body.classList.add("print-card-mode", "admin-print-mode"); window.print(); setTimeout(() => document.body.classList.remove("print-card-mode", "admin-print-mode"), 900); });
    byId("admin-logout").addEventListener("click", async () => {
      const { error } = await adminClient.auth.signOut();
      showAdminGate(error ? "La déconnexion a échoué. Réessayez." : "Vous êtes déconnecté.");
    });
    initGroupFilters();
    byId("rep-site").innerHTML = (adminSite ? D.sites.filter(site => site.id === adminSite) : D.sites).map(site => `<option value="${esc(site.id)}">${esc(site.city)}</option>`).join("");
    byId("rep-program").innerHTML = D.programs.map(item => `<option value="${esc(item.code)}">${esc(item.code)} · ${esc(programName(item.code))}</option>`).join("");
    byId("rep-level").innerHTML = D.levels.map(level => `<option value="${esc(level)}">${esc(level)}</option>`).join("");
    ["rep-site", "rep-program", "rep-level"].forEach(id => byId(id).addEventListener("change", renderRepresentativeManager));
    const announcementSite = byId("announcement-site");
    announcementSite.innerHTML = adminSite
      ? `<option value="${esc(adminSite)}">${esc(siteName(adminSite))} uniquement</option>`
      : `<option value="">Tous les campus</option>${D.sites.map(site => `<option value="${esc(site.id)}">${esc(site.city)}</option>`).join("")}`;
    renderDashboard();
  }
  async function authorizeAdmin(session) {
    if (!session) { showAdminGate("Connectez-vous avec votre compte administrateur."); return false; }
    currentAdminId = session.user.id;
    const { data: globalMembership, error: globalError } = await adminClient.from("admin_members").select("user_id").eq("user_id", session.user.id).maybeSingle();
    if (globalError) { showAdminGate("La vérification du rôle admin Supabase a échoué."); return false; }
    if (globalMembership) adminSite = null;
    else {
      const { data: siteMemberships, error: siteError } = await adminClient.from("admin_site_members").select("site").eq("user_id", session.user.id);
      if (siteError) { showAdminGate("La vérification du site administrateur a échoué. Appliquez la migration des accès par site."); return false; }
      if (siteMemberships?.length !== 1) {
        await adminClient.auth.signOut();
        showAdminGate(siteMemberships?.length ? "Ce compte est associé à plusieurs sites. Contactez l’administrateur principal." : "Ce compte n’est pas autorisé à accéder à l’administration.");
        return false;
      }
      adminSite = siteMemberships[0].site;
    }
    if (!globalMembership && !adminSite) {
      await adminClient.auth.signOut();
      showAdminGate("Ce compte n’est pas autorisé à accéder à l’administration.");
      return false;
    }
    try { await loadAdminData(); }
    catch (error) {
      showAdminGate("Base de données indisponible. Appliquez les migrations Supabase et vérifiez les autorisations RLS avant de réessayer.");
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
      .on("postgres_changes", { event: "*", schema: "public", table: "campus_announcements" }, () => { if (currentView === "announcements") void loadAnnouncements(); })
      .subscribe();
    return true;
  }
  async function bootAdminAuth() {
    const config = window.IRGIB_SUPABASE_CONFIG;
    if (!config?.url || !config?.anonKey) {
      showAdminGate("L’accès admin est verrouillé. Configurez les variables Supabase du projet Vercel et autorisez le compte dans admin_members.");
      return;
    }
    if (!window.supabase?.createClient) { showAdminGate("Le service d’authentification n’a pas pu se charger. Vérifiez la connexion Internet puis rechargez la page."); return; }
    try {
      adminClient = window.supabase.createClient(config.url, config.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
      const { data, error } = await adminClient.auth.getSession();
      if (error) throw error;
      await authorizeAdmin(data.session);
      adminClient.auth.onAuthStateChange(event => {
        if (event === "SIGNED_OUT") showAdminGate("Vous êtes déconnecté.");
      });
    } catch {
      showAdminGate("Impossible de vérifier la session Supabase. Vérifiez l’URL et la clé publique configurées.");
    }
  }
  byId("admin-login-form").addEventListener("submit", async event => {
    event.preventDefault();
    const email = byId("admin-email").value.trim();
    const password = byId("admin-password").value;
    const button = byId("admin-login-submit");
    if (!email || !password) { byId("admin-auth-message").textContent = "Saisissez votre adresse e-mail et votre mot de passe."; return; }
    if (!adminClient) { byId("admin-auth-message").textContent = "L’authentification Supabase n’est pas configurée pour ce site."; return; }
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
        byId("admin-auth-message").textContent = "Cette adresse e-mail n’est pas encore confirmée dans Supabase.";
      } else if (code === "invalid_credentials" || message.includes("invalid login credentials")) {
        byId("admin-auth-message").textContent = "Adresse e-mail ou mot de passe incorrect. Vérifiez le compte créé dans Supabase.";
      } else if (code === "user_not_found" || message.includes("user not found")) {
        byId("admin-auth-message").textContent = "Aucun compte Supabase ne correspond à cette adresse e-mail.";
      } else {
        byId("admin-auth-message").textContent = "Connexion refusée : " + (error?.message || "erreur Supabase inconnue");
      }
    } finally { button.disabled = false; }
  });
  bootAdminAuth();
})();
