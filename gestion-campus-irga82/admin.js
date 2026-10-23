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
  let attendanceCache = [];
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
    const start = new Date(`${D.todayKey()}T00:00:00+01:00`).toISOString();
    const end = new Date(`${D.todayKey()}T00:00:00+01:00`); end.setUTCDate(end.getUTCDate() + 1);
    const records = [];
    for (let from = 0; ; from += 500) {
      const { data, error } = await adminClient.from("attendance_records")
        .select("attended_at,session_id,student_profiles!inner(user_id,first_name,last_name,email,program,level,site),attendance_sessions!inner(site,program,level)")
        .gte("attended_at", start).lt("attended_at", end.toISOString())
        .order("attended_at", { ascending: false }).order("id", { ascending: false }).range(from, from + 499);
      if (error) throw error;
      records.push(...(data || []));
      if (!data || data.length < 500) break;
    }
    const byStudent = new Map(applicationsCache.map(item => [item.studentId, item]));
    attendanceCache = (records || []).map(row => {
      const person = row.student_profiles; const app = byStudent.get(person.user_id);
      return { studentId: person.user_id, createdAt: row.attended_at, day: D.todayKey(), sessionCode: row.session_id.slice(0, 8), firstName: person.first_name, lastName: person.last_name, email: person.email, matricule: app?.finalMatricule || app?.temporaryMatricule || "", program: person.program, level: person.level, site: person.site };
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
  function setView(view) {
    currentView = view;
    document.querySelectorAll(".view").forEach(node => node.classList.toggle("active", node.id === `view-${view}`));
    document.querySelectorAll(".side-nav [data-view]").forEach(node => node.classList.toggle("active", node.dataset.view === view));
    const labels = { dashboard: "Vue d’ensemble", requests: "Demandes de badge", students: "Étudiants", attendance: "Présences", groups: "Groupes", catalog: "Catalogue", cards: "Cartes" };
    byId("breadcrumb").textContent = `Campus / ${labels[view]}`;
    ({ dashboard: renderDashboard, requests: renderRequests, students: renderStudents, attendance: renderAttendance, groups: renderGroups, catalog: renderCatalog, cards: renderCards })[view]?.();
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
    const today = attendanceCache.filter(item => item.day === D.todayKey());
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
    const list = approved().filter(item => [fullName(item), item.finalMatricule, programName(item.program), item.level, siteName(item.site)].join(" ").toLowerCase().includes(query));
    byId("student-count").textContent = `${list.length} étudiant${list.length === 1 ? "" : "s"}`;
    byId("student-rows").innerHTML = list.map(item => `<tr><td>${photoCell(item)}</td><td><strong>${esc(fullName(item))}</strong><span class="sub">${esc(item.email)}</span></td><td><strong>${esc(item.finalMatricule)}</strong></td><td>${esc(item.sex)}</td><td>${esc(programName(item.program))}<span class="sub">${esc(item.level)}</span></td><td>${esc(siteName(item.site))}</td><td>${esc(keyFor(item))}</td></tr>`).join("") || `<tr><td colspan="7" class="table-empty">Aucun étudiant approuvé trouvé.</td></tr>`;
  }
  const careerCycles = [
    { name: "Licence", levels: ["LP1", "LP2", "LP3"] },
    { name: "Master", levels: ["M1", "M2"] }
  ];
  const careerYear = { LP1: "1re année", LP2: "2e année", LP3: "3e année", M1: "1re année", M2: "2e année" };
  function attendanceRoster() {
    const today = attendanceCache.filter(item => item.day === D.todayKey());
    const presentByStudent = new Map(today.map(item => [item.studentId, item]));
    const rows = approved().map(student => {
      const mark = presentByStudent.get(student.studentId);
      return { studentId: student.studentId, firstName: student.firstName, lastName: student.lastName, email: student.email, matricule: student.finalMatricule || "", program: student.program, level: student.level, site: student.site, present: Boolean(mark), attendedAt: mark?.createdAt || "" };
    });
    const known = new Set(rows.map(row => row.studentId));
    today.forEach(item => {
      if (known.has(item.studentId)) return;
      rows.push({ studentId: item.studentId, firstName: item.firstName, lastName: item.lastName, email: item.email, matricule: item.matricule || "", program: item.program, level: item.level, site: item.site, present: true, attendedAt: item.createdAt });
    });
    return rows;
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
            const body = rows.map(item => `<tr><td><strong>${esc(fullName(item))}</strong><span class="sub">${esc(item.email)}</span></td><td>${esc(item.matricule || "—")}</td><td>${item.present && item.attendedAt ? new Date(item.attendedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "—"}</td><td><span class="status ${item.present ? "active" : "absent"}">${item.present ? "Présent" : "Absent"}</span></td></tr>`).join("");
            blocks.push(`<section class="roll-section"><header><strong>${esc(programName(programCode))}</strong><span>${esc(siteName(siteId))}</span><span>${here} / ${rows.length}</span></header><div class="table-scroll"><table><thead><tr><th>Étudiant</th><th>Matricule</th><th>Heure</th><th>Statut</th></tr></thead><tbody>${body}</tbody></table></div></section>`);
          });
        });
      });
    });
    byId("attendance-board").innerHTML = blocks.join("") || `<p class="table-empty">Aucun étudiant pour ces critères. L’appel compte les cartes approuvées.</p>`;
  }
  function initGroupFilters() {
    byId("group-site").innerHTML = `<option value="">Toutes les villes</option>${D.sites.map(item => `<option value="${item.id}">${esc(item.city)}</option>`).join("")}`;
    byId("group-program").innerHTML = `<option value="">Toutes les filières</option>${D.programs.map(item => `<option value="${item.code}">${item.code} · ${esc(item.shortName)}</option>`).join("")}`;
    byId("group-level").innerHTML = `<option value="">Tous les niveaux</option>${D.levels.map(level => `<option value="${level}">${level} · ${careerYear[level] || level}</option>`).join("")}`;
    byId("attendance-site").innerHTML = `<option value="">Tous les sites</option>${D.sites.map(item => `<option value="${item.id}">${esc(item.city)}</option>`).join("")}`;
    byId("attendance-program").innerHTML = `<option value="">Toutes les filières</option>${D.programs.map(item => `<option value="${item.code}">${item.code} · ${esc(item.shortName)}</option>`).join("")}`;
    byId("attendance-level").innerHTML = `<option value="">Toutes les années</option>${D.levels.map(level => `<option value="${level}">${level} · ${careerYear[level] || level}</option>`).join("")}`;
  }
  let activeSessionToken = "";
  function initSessionForm() {
    byId("session-site").innerHTML = D.sites.map(site => `<option value="${esc(site.id)}">${esc(site.city)}</option>`).join("");
    byId("session-program").innerHTML = D.programs.map(program => `<option value="${esc(program.code)}">${esc(program.code)} · ${esc(program.shortName)}</option>`).join("");
    byId("session-level").innerHTML = D.levels.map(level => `<option value="${esc(level)}">${esc(level)}</option>`).join("");
    byId("session-create-form").addEventListener("submit", async event => {
      event.preventDefault();
      const button = byId("session-create-button"); button.disabled = true;
      byId("session-create-message").textContent = "Création du code…";
      try {
        const { data, error } = await adminClient.rpc("admin_create_attendance_session", {
          p_site: byId("session-site").value, p_program: byId("session-program").value,
          p_level: byId("session-level").value, p_duration_minutes: Number(byId("session-duration").value)
        });
        if (error) throw error;
        const session = Array.isArray(data) ? data[0] : data;
        activeSessionToken = session.token;
        const host = byId("session-qr-code"); host.replaceChildren();
        if (!window.QRCode) throw new Error("Le générateur QR n’est pas chargé. Rechargez la page.");
        new QRCode(host, { text: activeSessionToken, width: 220, height: 220, colorDark: "#102a39", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M });
        byId("session-qr-info").textContent = `${siteName(session.site)} · ${programName(session.program)} · ${session.level} · expire à ${new Date(session.ends_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}. Gardez ce QR réservé au groupe sélectionné.`;
        byId("session-qr-panel").hidden = false;
        byId("session-create-message").textContent = "QR créé. Le code complet n’est affiché qu’ici.";
      } catch (error) { byId("session-create-message").textContent = error.message || "La séance n’a pas pu être créée."; }
      finally { button.disabled = false; }
    });
    byId("copy-session-token").addEventListener("click", async () => {
      if (!activeSessionToken) return;
      try { await navigator.clipboard.writeText(activeSessionToken); toast("Code de secours copié."); }
      catch { toast("La copie automatique est bloquée par le navigateur."); }
    });
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
    byId("site-grid").innerHTML = D.sites.map(site => `<article class="site-card"><span class="site-code">ZONE ${esc(site.zone)} · ${esc(site.id)}</span><strong>${esc(site.city)}</strong>${site.points.map(point => `<p><b>${esc(point.name)}</b> · ${esc(point.address)}<br>${esc(point.phone)}</p>`).join("")}</article>`).join("");
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
    const button = byId("approve-request"); button.disabled = true;
    const { data, error } = await adminClient.rpc("admin_decide_application", { p_application_id: item.id, p_decision: "approved", p_reason: null });
    if (error) { button.disabled = false; toast(error.message || "La décision n’a pas pu être enregistrée."); return; }
    closeReview();
    await refreshCurrent();
    const decided = Array.isArray(data) ? data[0] : data;
    toast(`Demande approuvée · ${decided.final_matricule}.`);
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
    renderDashboard(); if (currentView === "requests") renderRequests(); if (currentView === "students") renderStudents(); if (currentView === "attendance") renderAttendance(); if (currentView === "groups") renderGroups(); if (currentView === "cards") renderCards();
  }
  async function drawAdminCard(item) {
    const { data: signedPhoto, error } = await adminClient.storage.from("student-photos").createSignedUrl(item.photoPath, 600);
    if (error || !signedPhoto?.signedUrl) { toast("La photo privée ne peut pas être chargée pour cette carte."); return; }
    item.photo = signedPhoto.signedUrl;
    byId("admin-card-zone").innerHTML = D.cardHtml(item, "admin-card-qr");
    if (window.QRCode) new QRCode(byId("admin-card-qr"), { text: `IRGIB-CARTE:${item.finalMatricule}`, width: 128, height: 128, colorDark: "#102a39", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M });
    else byId("admin-card-qr").innerHTML = '<div class="qr-fallback">QR indisponible</div>';
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
      rows = [["date", "heure", "etudiant", "matricule", "statut", "cycle", "annee", "code_filiere", "filiere", "niveau", "site"], ...attendanceRoster().map(item => [D.todayKey(), item.attendedAt ? new Date(item.attendedAt).toLocaleTimeString("fr-FR") : "", fullName(item), item.matricule, item.present ? "present" : "absent", item.level.startsWith("M") ? "Master" : "Licence", careerYear[item.level] || item.level, item.program, programName(item.program), item.level, siteName(item.site)])]; filename = "presences-jour.csv";
    } else {
      rows = [["matricule_final", "matricule_temporaire", "nom", "prenom", "email", "sexe", "code_filiere", "filiere", "niveau", "ville", "groupe"], ...approved().map(item => [item.finalMatricule, item.temporaryMatricule, item.lastName, item.firstName, item.email, item.sex, item.program, programName(item.program), item.level, siteName(item.site), keyFor(item)])]; filename = "etudiants-irgib.csv";
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
    byId("group-search").addEventListener("input", renderGroups);
    document.addEventListener("click", event => {
      const target = event.target instanceof Element ? event.target : event.target?.parentElement;
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
    initSessionForm();
    renderDashboard();
  }
  async function authorizeAdmin(session) {
    if (!session) { showAdminGate("Connectez-vous avec votre compte administrateur."); return false; }
    const { data: membership, error } = await adminClient.from("admin_members").select("user_id").eq("user_id", session.user.id).maybeSingle();
    if (error) { showAdminGate("La vérification du rôle admin Supabase a échoué. Vérifiez la configuration de la table admin_members."); return false; }
    if (!membership) {
      await adminClient.auth.signOut();
      showAdminGate("Ce compte n’est pas autorisé à accéder à l’administration.");
      return false;
    }
    try { await loadAdminData(); }
    catch (error) {
      showAdminGate("Base de données indisponible. Appliquez les migrations Supabase et vérifiez les autorisations RLS avant de réessayer.");
      return false;
    }
    byId("admin-user-label").textContent = session.user.email || "Administration";
    byId("admin-profile-mark").textContent = (session.user.email || "A").trim().charAt(0).toUpperCase();
    byId("admin-auth-screen").hidden = true;
    byId("admin-app").hidden = false;
    initAdminApp();
    adminClient.channel("irgib-admin-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "badge_applications" }, () => { void refreshCurrent(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "attendance_records" }, () => { void refreshCurrent(); })
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
