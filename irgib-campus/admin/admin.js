(() => {
  const D = window.IRGIB_DATA;
  const byId = id => document.getElementById(id);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const fullName = item => `${item.firstName || ""} ${item.lastName || ""}`.trim();
  const safeName = /^[\p{L}\p{M} .’'-]+$/u;
  let currentView = "dashboard";
  let reviewedId = "";
  let toastTimer;
  const applications = () => D.loadApplications();
  const approved = () => applications().filter(item => item.status === "approved");
  const siteName = id => D.getSite(id).city;
  const programName = code => D.getProgram(code).shortName;
  const keyFor = item => D.groupKey(item.site, item.program, item.level);
  const statusText = status => ({ pending: "En attente", approved: "Approuvée", rejected: "Rejetée" }[status] || status);
  const statusHtml = status => `<span class="status ${status === "approved" ? "active" : status === "rejected" ? "rejected" : "pending"}">${statusText(status)}</span>`;
  const photoCell = item => item.photo ? `<img class="table-photo" src="${item.photo}" alt="Photo de ${esc(fullName(item))}">` : `<span class="table-photo photo-empty">—</span>`;

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
    const today = D.loadAttendance().filter(item => item.day === D.todayKey());
    byId("dashboard-stats").innerHTML = [["Demandes en attente", pending.length, "À vérifier par l’administration", "◷"], ["Cartes approuvées", active.length, "Matricules définitifs attribués", "✓"], ["Demandes rejetées", rejected.length, "Décisions enregistrées", "×"], ["Présences aujourd’hui", today.length, D.todayKey(), "▦"]].map(([label, value, note, icon]) => `<article class="stat-card"><div class="stat-top"><span>${label}</span><span class="stat-icon">${icon}</span></div><div class="stat-value">${value}</div><div class="stat-note">${note}</div></article>`).join("");
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
  function renderAttendance() {
    const query = (byId("attendance-search").value || "").trim().toLowerCase();
    const all = D.loadAttendance().filter(item => item.day === D.todayKey());
    const list = all.filter(item => [item.firstName, item.lastName, item.matricule, item.sessionCode, programName(item.program), siteName(item.site)].join(" ").toLowerCase().includes(query));
    byId("attendance-title").textContent = `Liste du ${D.todayKey()}`;
    byId("attendance-count").textContent = `${list.length} présence${list.length === 1 ? "" : "s"}`;
    byId("attendance-rows").innerHTML = list.map(item => `<tr><td>${new Date(item.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</td><td><strong>${esc(`${item.firstName} ${item.lastName}`)}</strong><span class="sub">${esc(item.email)}</span></td><td>${esc(item.matricule || "—")}</td><td>${esc(item.sessionCode)}</td><td>${esc(programName(item.program))}<span class="sub">${esc(item.level)}</span></td><td>${esc(siteName(item.site))}</td><td><span class="status active">Présent</span></td></tr>`).join("") || `<tr><td colspan="7" class="table-empty">Aucune présence enregistrée aujourd’hui.</td></tr>`;
  }
  function initGroupFilters() {
    byId("group-site").innerHTML = `<option value="">Toutes les villes</option>${D.sites.map(item => `<option value="${item.id}">${esc(item.city)}</option>`).join("")}`;
    byId("group-program").innerHTML = `<option value="">Toutes les filières</option>${D.programs.map(item => `<option value="${item.code}">${item.code} · ${esc(item.shortName)}</option>`).join("")}`;
    byId("group-level").innerHTML = `<option value="">Tous les niveaux</option>${D.levels.map(level => `<option value="${level}">${level}</option>`).join("")}`;
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
      { name: "Photo d’identité présente", ok: Boolean(item.photo) }
    ];
    return { checks, ok: required.every(Boolean) && checks.every(check => check.ok) };
  }
  function openReview(id) {
    const item = applications().find(application => application.id === id);
    if (!item) return;
    reviewedId = id;
    const site = D.getSite(item.site);
    const report = auditReport(item);
    byId("review-title").textContent = fullName(item) || "Demande de badge";
    byId("review-subtitle").textContent = `Matricule temporaire ${item.temporaryMatricule} · reçue ${new Date(item.submittedAt).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}`;
    byId("review-content").innerHTML = `<div class="review-grid"><div class="review-photo-wrap">${item.photo ? `<img class="review-photo" src="${item.photo}" alt="Photo d’identité de ${esc(fullName(item))}">` : `<div class="review-photo photo-missing">Photo d’identité<br>non fournie</div>`}<span class="field-help">${esc(item.photoFileName || "Aucun nom de fichier")}</span></div><div><h3>Renseignements soumis</h3><div class="review-info"><div><span>Nom</span><strong>${esc(item.lastName)}</strong></div><div><span>Prénom(s)</span><strong>${esc(item.firstName)}</strong></div><div><span>E-mail</span><strong>${esc(item.email)}</strong></div><div><span>Téléphone</span><strong>${esc(item.phone)}</strong></div><div><span>Sexe</span><strong>${esc(item.sex)}</strong></div><div><span>Filière</span><strong>${esc(D.getProgram(item.program).name)}</strong></div><div><span>Niveau</span><strong>${esc(item.level)}</strong></div><div><span>Ville / site</span><strong>${esc(site.city)}</strong></div><div><span>Clé du groupe</span><strong>${esc(keyFor(item))}</strong></div><div><span>Matricule temporaire</span><strong>${esc(item.temporaryMatricule)}</strong></div></div></div></div><div class="audit-box"><div class="audit-heading"><div><div class="eyebrow">Rapport de vérification</div><h3>Contrôles du dossier</h3></div><span class="status ${report.ok ? "active" : "pending"}">${report.ok ? "Prêt à valider" : "À corriger"}</span></div><div class="audit-list">${report.checks.map(check => `<div class="audit-check ${check.ok ? "pass" : "fail"}"><span>${check.ok ? "✓" : "!"}</span>${esc(check.name)}</div>`).join("")}</div><p class="small muted" style="margin:10px 0 0">Le rapport aide au contrôle : l’approbation reste une décision de l’administration. Le matricule final doit être unique, tous sites et promotions confondus.</p></div>${item.status === "rejected" ? `<div class="notice" style="margin-top:12px"><strong>Motif enregistré :</strong> ${esc(item.rejectionReason || "—")}</div>` : ""}`;
    if (item.status === "pending") {
      byId("review-actions").innerHTML = `<label class="manual-photo-check"><input type="checkbox" id="photo-check" ${report.ok ? "" : "disabled"}><span>J’ai vérifié visuellement la tenue de l’école, la netteté de la photo, le visage visible et les cheveux bien peignés.</span></label><div class="field full"><label for="reject-reason">Motif de rejet (facultatif)</label><textarea id="reject-reason" rows="2" placeholder="Expliquez brièvement la décision afin que l’étudiant sache quoi faire."></textarea></div><div class="review-buttons"><button class="btn danger" id="reject-request" type="button">Rejeter la demande</button><button class="btn" id="approve-request" type="button" disabled>Valider et attribuer le matricule</button></div><span class="field-help">Après approbation ou rejet, la demande ne revient pas à l’état « en attente ».</span>`;
      byId("photo-check").addEventListener("change", event => { byId("approve-request").disabled = !event.target.checked || !report.ok; });
      byId("approve-request").addEventListener("click", approveRequest);
      byId("reject-request").addEventListener("click", rejectRequest);
    } else {
      const final = item.finalMatricule ? `Matricule définitif : ${item.finalMatricule}` : "Aucun matricule définitif attribué.";
      byId("review-actions").innerHTML = `<div class="decision-summary">${statusHtml(item.status)} <strong>${esc(final)}</strong></div><span class="field-help">Cette décision est enregistrée et ne peut pas être remise en attente.</span>`;
    }
    byId("review-modal").classList.add("open");
  }
  function approveRequest() {
    const list = applications();
    const item = list.find(application => application.id === reviewedId);
    if (!item || item.status !== "pending") return;
    const report = auditReport(item);
    if (!report.ok || !byId("photo-check")?.checked) { toast("Terminez les contrôles et confirmez la vérification visuelle de la photo."); return; }
    try { item.finalMatricule = D.makeFinalMatricule(list); }
    catch { toast("Plus de matricules disponibles dans le format actuel."); return; }
    item.status = "approved";
    item.approvedAt = new Date().toISOString();
    D.saveApplications(list);
    closeReview();
    refreshCurrent();
    toast(`Demande approuvée · ${item.finalMatricule}. Notification étudiante créée.`);
  }
  function rejectRequest() {
    const list = applications();
    const item = list.find(application => application.id === reviewedId);
    if (!item || item.status !== "pending") return;
    item.status = "rejected";
    item.rejectionReason = byId("reject-reason").value.trim() || "Demande rejetée. Contactez l’administration de votre site d’apprentissage pour connaître la suite.";
    item.rejectedAt = new Date().toISOString();
    D.saveApplications(list);
    closeReview();
    refreshCurrent();
    toast(`Demande rejetée · ${item.temporaryMatricule}.`);
  }
  function closeReview() { byId("review-modal").classList.remove("open"); reviewedId = ""; }
  function refreshCurrent() { renderDashboard(); if (currentView === "requests") renderRequests(); if (currentView === "students") renderStudents(); if (currentView === "attendance") renderAttendance(); if (currentView === "groups") renderGroups(); if (currentView === "cards") renderCards(); }
  function drawAdminCard(item) {
    const program = D.getProgram(item.program);
    const site = D.getSite(item.site);
    const contacts = site.points.map(point => `<div class="card-v2-contact"><strong>${esc(point.name)}</strong><span>${esc(point.address)}</span><b>${esc(point.phone)}</b></div>`).join("");
    byId("admin-card-zone").innerHTML = `<article class="student-card id-card-front card-v2 card-v2-front"><header class="card-v2-header"><div class="card-v2-brand"><img src="../assets/blason.jpg" alt="Blason IRGIB AFRICA"><div><strong>IRGIB AFRICA</strong><span>UNIVERSITÉ POLYTECHNIQUE · BÉNIN</span><small>CARTE ÉTUDIANTE <i>/</i> STUDENT CARD</small></div></div><span class="card-v2-sex">${esc(item.sex)}</span></header><div class="card-v2-main"><div class="card-v2-portrait">${item.photo ? `<img src="${item.photo}" alt="Photo de ${esc(fullName(item))}">` : `<div class="card-v2-photo-placeholder">PHOTO</div>`}<div class="card-v2-matricule"><small>MATRICULE <i>/</i> STUDENT ID</small><strong>${esc(item.finalMatricule)}</strong></div></div><div class="card-v2-details"><div class="card-v2-field"><small>NOM <i>/</i> SURNAME</small><strong>${esc(item.lastName)}</strong></div><div class="card-v2-field"><small>PRÉNOM(S) <i>/</i> FIRST NAME</small><strong>${esc(item.firstName)}</strong></div><div class="card-v2-field"><small>SEXE <i>/</i> SEX</small><strong>${esc(item.sex === "F" ? "Féminin / Female" : "Masculin / Male")}</strong></div><div class="card-v2-field"><small>FILIÈRE <i>/</i> PROGRAM</small><strong>${esc(program.shortName)}</strong></div><div class="card-v2-field"><small>NIVEAU <i>/</i> LEVEL</small><strong>${esc(item.level)}</strong></div></div><div class="card-v2-verification"><div class="card-v2-qr" id="admin-card-qr"></div><strong>SCANNEZ POUR IDENTIFIER</strong><small>SCAN TO IDENTIFY</small><a href="https://www.irgibafrica.university/" target="_blank" rel="noopener noreferrer">www.irgibafrica.university</a></div></div><footer class="card-v2-footer"><strong>${esc(site.city.toUpperCase())} · BÉNIN</strong><span>CARTE PERSONNELLE · ${esc(item.level)}</span></footer></article><article class="student-card id-card-front card-back card-v2 card-v2-back"><header class="card-v2-back-head"><span>INFORMATIONS PRATIQUES</span><span>CONTACTS DU SITE</span></header><div class="card-v2-back-title">${esc(site.city)} <i>/</i> Votre centre de formation</div><div class="card-v2-contacts">${contacts}</div><div class="card-v2-back-note">Cette carte est strictement personnelle. En cas de perte, merci de la remettre à l’administration du site indiqué au recto.</div><footer class="card-v2-back-footer"><span>CONTACTER LE SITE INDIQUÉ AU RECTO</span><span>DOCUMENT PERSONNEL · BÉNIN</span></footer></article>`;
    if (window.QRCode) new QRCode(byId("admin-card-qr"), { text: `IRGIB-CARTE:${item.finalMatricule}`, width: 128, height: 128, colorDark: "#102a39", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M });
    else byId("admin-card-qr").innerHTML = `<div class="qr-fallback">QR indisponible</div>`;
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
      rows = [["date", "heure", "etudiant", "matricule", "seance_qr", "filiere", "niveau", "ville"], ...D.loadAttendance().filter(item => item.day === D.todayKey()).map(item => [item.day, new Date(item.createdAt).toLocaleTimeString("fr-FR"), `${item.firstName} ${item.lastName}`, item.matricule, item.sessionCode, programName(item.program), item.level, siteName(item.site)])]; filename = "presences-jour.csv";
    } else {
      rows = [["matricule_final", "matricule_temporaire", "nom", "prenom", "email", "sexe", "code_filiere", "filiere", "niveau", "ville", "groupe"], ...approved().map(item => [item.finalMatricule, item.temporaryMatricule, item.lastName, item.firstName, item.email, item.sex, item.program, programName(item.program), item.level, siteName(item.site), keyFor(item)])]; filename = "etudiants-irgib.csv";
    }
    const csv = "\uFEFF" + rows.map(row => row.map(value => `"${String(value ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); toast("Export CSV préparé.");
  }

  document.querySelectorAll(".side-nav [data-view]").forEach(button => button.addEventListener("click", () => setView(button.dataset.view)));
  document.querySelectorAll("[data-go]").forEach(button => button.addEventListener("click", () => setView(button.dataset.go)));
  document.querySelectorAll("[data-close-review]").forEach(button => button.addEventListener("click", closeReview));
  byId("review-modal").addEventListener("click", event => { if (event.target === byId("review-modal")) closeReview(); });
  byId("request-search").addEventListener("input", renderRequests);
  byId("request-filter").addEventListener("change", renderRequests);
  byId("student-search").addEventListener("input", renderStudents);
  byId("attendance-search").addEventListener("input", renderAttendance);
  byId("card-search").addEventListener("input", renderCards);
  ["group-site", "group-program", "group-level"].forEach(id => byId(id).addEventListener("change", renderGroups));
  byId("group-search").addEventListener("input", renderGroups);
  document.addEventListener("click", event => {
    const review = event.target.closest("[data-review]");
    if (review) openReview(review.dataset.review);
    const preview = event.target.closest("[data-preview-card]");
    if (preview) { const item = approved().find(application => application.id === preview.dataset.previewCard); if (item) drawAdminCard(item); }
    const exportButton = event.target.closest("[data-export]");
    if (exportButton) exportCsv(exportButton.dataset.export);
  });
  byId("print-admin-card").addEventListener("click", () => { document.body.classList.add("print-card-mode", "admin-print-mode"); window.print(); setTimeout(() => document.body.classList.remove("print-card-mode", "admin-print-mode"), 900); });
  initGroupFilters();
  renderDashboard();
})();
