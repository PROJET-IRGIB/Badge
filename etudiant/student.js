(() => {
  const D = window.IRGIB_DATA;
  const cfg = window.IRGIB_SUPABASE_CONFIG;
  const db = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  const byId = id => document.getElementById(id);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const fullName = person => `${person.firstName || ""} ${person.lastName || ""}`.trim();
  const friendlyError = (error, fallback) => {
    const message = String(error?.message || "").toLowerCase();
    if (error?.name === "StudentProfileMissingError") return error.message;
    if (/already registered|user already exists/.test(message)) return "Un compte utilise déjà cette adresse e-mail. Essayez de vous connecter.";
    if (/permission denied|row-level security|not authorized|unauthorized/.test(message)) return "Cette action n’est pas autorisée pour votre compte.";
    if (/network|failed to fetch|fetcherror|timeout/.test(message)) return "Connexion interrompue. Vérifiez votre connexion puis réessayez.";
    return fallback;
  };
  const initSelects = () => {
    const programOptions = D.programs.map(item => `<option value="${item.code}">${item.code} · ${esc(item.name)}</option>`).join("");
    const levelOptions = D.levels.map(level => `<option value="${level}">${level}</option>`).join("");
    const siteOptions = D.sites.map(site => `<option value="${site.id}">${esc(site.city)}</option>`).join("");
    const countryOptions = D.originCountries.map(country => `<option value="${esc(country)}"></option>`).join("");
    ["signup-program", "request-program"].forEach(id => byId(id).innerHTML = programOptions);
    ["signup-level", "request-level"].forEach(id => byId(id).innerHTML = levelOptions);
    ["signup-site", "request-site"].forEach(id => byId(id).innerHTML = siteOptions);
    ["signup-country-options", "request-country-options"].forEach(id => byId(id).innerHTML = countryOptions);
  };
  initSelects();

  let profile = null;
  let currentUser = null;
  let pendingSignupEmail = "";
  let application = null;
  let attendanceRows = [];
  let studentChannel = null;
  let selectedPhoto = "";
  let selectedPhotoName = "";
  let selectedPhotoBlob = null;
  let passwordChangeStage = 0;
  const passwordSuccessNotice = document.createElement("p");
  passwordSuccessNotice.id = "password-success-notice";
  passwordSuccessNotice.className = "notice notification-banner";
  passwordSuccessNotice.hidden = true;
  byId("password-open").after(passwordSuccessNotice);
  let scannedSession = "";
  let scannedSessionInfo = null;
  let announcements = [];
  const expandedNewsIds = new Set();
  let lastNewsRefresh = 0;
  let initialNewsLoaded = false;
  const knownAnnouncementIds = new Set();
  let cameraStream = null;
  let scanFrame = 0;
  let lastScanTime = 0;
  let representativeGroupmates = [];
  let selectedRepresentativeStudent = null;
  let representativeCameraStream = null;
  let representativeScanFrame = 0;
  let representativeRefreshTimer = 0;
  let representativeRefreshInFlight = false;
  let representativeAssigned = false;
  let representativeLastScanTime = 0;
  let representativeLastQr = "";
  let representativeBadgeVerified = false;
  let representativeVerifySequence = 0;
  let representativeHasPin = false;
  let blockedAccountNotice = "";
  let pendingAccountNotice = "";
  let renderedCardKey = "";
  let photoSignedUrl = "";
  let photoSignedPath = "";
  let photoSignedUntil = 0;

  const getApplication = () => application;
  const cardKey = app => app ? [app.id, app.status, app.finalMatricule, app.photoPath, app.firstName, app.lastName, app.birthDate, app.sex, app.program, app.level, app.site, profile?.cardSuspendedAt || ""].join("|") : "";
  const attendanceKey = rows => (rows || []).map(row => `${row.sessionId}:${row.status}:${row.createdAt}`).join(",");
  async function attachPhotoUrl(app) {
    if (!app?.photoPath) {
      if (app) app.photo = "";
      return;
    }
    if (photoSignedUrl && photoSignedPath === app.photoPath && photoSignedUntil - Date.now() > 120000) {
      app.photo = photoSignedUrl;
      return;
    }
    const { data } = await db.storage.from("student-photos").createSignedUrl(app.photoPath, 3600);
    photoSignedUrl = data?.signedUrl || "";
    photoSignedPath = app.photoPath;
    photoSignedUntil = Date.now() + 3600 * 1000;
    app.photo = photoSignedUrl;
  }
  const approvalNoticeKey = app => `irgib-approval-notice:${currentUser?.id || "student"}:${app?.id || "none"}`;
  const fromProfileRow = row => row && ({ userId: row.user_id, firstName: row.first_name, lastName: row.last_name, email: row.email, phone: row.phone, sex: row.sex, program: row.program, level: row.level, site: row.site, birthDate: row.birth_date, originGroup: row.origin_group || "", countryOfOrigin: row.country_of_origin || "", accountStatus: row.account_status || "pending", accountRejectionReason: row.account_rejection_reason || "", emailVerifiedAt: row.email_verified_at || null, bannedAt: row.banned_at || null, banReason: row.ban_reason || "", cardSuspendedAt: row.card_suspended_at || null });
  const fromApplicationRow = row => row && ({ id: row.id, studentId: row.student_id, firstName: row.first_name, lastName: row.last_name, email: row.email, phone: row.phone, sex: row.sex, birthDate: row.birth_date, program: row.program, level: row.level, site: row.site, status: row.status, temporaryMatricule: row.temporary_matricule, finalMatricule: row.final_matricule, photoPath: row.photo_path, rejectionReason: row.rejection_reason, submittedAt: row.submitted_at, decidedAt: row.decided_at });
  async function loadStudentData() {
    const { data: profileRow, error: profileError } = await db.from("student_profiles").select("*").eq("user_id", currentUser.id).maybeSingle();
    if (profileError) throw profileError;
    if (!profileRow) throw Object.assign(new Error("Les informations de votre compte ne sont pas encore disponibles. Contactez l’administration de votre site."), { name: "StudentProfileMissingError" });
    profile = fromProfileRow(profileRow);
    if (profile.bannedAt) {
      const site = D.getSite(profile.site)?.city || "votre site";
      throw Object.assign(new Error(profile.banReason || `Votre compte a été banni par l’administration de ${site}.`), { name: "AccountBannedError" });
    }
    if (profile.accountStatus === "rejected") {
      const site = D.getSite(profile.site)?.city || "votre site universitaire";
      throw Object.assign(new Error(`La demande de création de votre compte n’a pas été acceptée par l’administration de ${site}.${profile.accountRejectionReason ? ` Motif : ${profile.accountRejectionReason}.` : ""} Contactez l’administration de votre site.`), { name: "AccountRejectedError" });
    }
    if (profile.accountStatus !== "approved" || !profile.emailVerifiedAt) {
      const site = D.getSite(profile.site)?.city || "votre site universitaire";
      throw Object.assign(new Error(`Votre compte est en cours de confirmation par l’administration de ${site}. Le délai de traitement est de 72 h au maximum. Réessayez plus tard.`), { name: "AccountPendingError" });
    }
    try {
      const { data: contacts } = await db.from("campus_site_contacts").select("site,contact_name,address,phone").eq("site", profile.site);
      D.applySiteContacts(contacts || []);
    } catch { /* Le catalogue local reste disponible si la migration de contacts n’est pas encore appliquée. */ }
    const { data: apps, error: appError } = await db.from("badge_applications").select("*").eq("student_id", currentUser.id).order("submitted_at", { ascending: false }).limit(1);
    if (appError) throw appError;
    application = fromApplicationRow(apps?.[0]);
    await attachPhotoUrl(application);
    const { data: records, error: attendanceError } = await db.from("attendance_records").select("status,attended_at,session_id,marked_by,attendance_sessions!inner(site,program,level,session_day,course_title)").eq("student_id", currentUser.id).order("attended_at", { ascending: false, nullsFirst: false });
    if (attendanceError) throw attendanceError;
    attendanceRows = (records || []).map(row => ({ sessionId: row.session_id, markedBy: row.marked_by, createdAt: row.attended_at, sessionCode: row.session_id.slice(0, 8), courseTitle: row.attendance_sessions.course_title || "Séance du jour", status: row.status, site: row.attendance_sessions.site, program: row.attendance_sessions.program, level: row.attendance_sessions.level, day: row.attendance_sessions.session_day }));
  }
  const showAuthPage = page => {
    const login = page === "login";
    byId("login-panel").style.display = login ? "block" : "none";
    byId("signup-panel").style.display = login ? "none" : "block";
    byId("show-login").classList.toggle("active", login);
    byId("show-signup").classList.toggle("active", !login);
    byId("auth-title").textContent = login ? "Connexion" : "Inscription";
    byId("auth-intro").textContent = login ? "Connectez-vous avec l’adresse e-mail et le mot de passe utilisés lors de votre inscription." : "Créez votre compte étudiant en renseignant vos informations et en confirmant votre adresse e-mail avec un code.";
    byId("login-message").textContent = "";
    byId("signup-message").textContent = "";
  };
  const setScreen = screen => {
    ["loading-screen", "auth-screen", "verify-screen", "portal-screen", "banned-screen", "account-pending-screen"].forEach(id => byId(id).style.display = id === screen ? "block" : "none");
    byId("signout").style.display = screen === "portal-screen" ? "inline-flex" : "none";
  };
  function showBlockedAccount(message) {
    blockedAccountNotice = message || "Votre compte a été banni par l’administration de votre établissement. Contactez l’administration de votre site.";
    try { localStorage.setItem("irgib-banned-account-notice", blockedAccountNotice); } catch {}
    setScreen("banned-screen");
    byId("banned-account-message").textContent = blockedAccountNotice;
    currentUser = null;
    profile = null;
    void db.auth.signOut();
  }
  async function showPendingAccount(message, rejected = false) {
    pendingAccountNotice = message || "Votre compte est en cours de confirmation par l’administration de votre site. Réessayez plus tard.";
    byId("account-pending-title").textContent = rejected ? "Compte non confirmé" : "Confirmation en cours";
    byId("account-pending-message").textContent = pendingAccountNotice;
    setScreen("account-pending-screen");
    if (currentUser && "Notification" in window && Notification.permission === "granted" && profile) await registerPushSubscription();
    await db.auth.signOut();
  }
  function dayGreeting(date = new Date()) {
    const hour = date.getHours();
    if (hour < 12) return "Bonjour";
    if (hour < 19) return "Bon après-midi";
    return "Bonsoir";
  }
  function showHeroGreeting(name) {
    const greeting = byId("hello-greeting");
    if (greeting) greeting.textContent = dayGreeting();
    if (name) byId("hello-name").textContent = name;
    const hero = document.querySelector(".portal-hero");
    if (!hero) return;
    hero.classList.remove("hero-in");
    void hero.offsetWidth;
    hero.classList.add("hero-in");
  }
  const selectStudentView = view => {
    if (view === "request" && application?.status === "approved") view = "card";
    hideRepresentativeDailyQr();
    document.querySelectorAll(".student-view").forEach(section => section.classList.toggle("active", section.id === `student-view-${view}`));
    document.querySelectorAll(".student-tabs [data-student-view]").forEach(button => button.classList.toggle("active", button.dataset.studentView === view));
    if (view === "attendance") { renderAttendance(); }
    if (view === "news") { void loadAnnouncements(); }
    if (view === "card") {
      if (application?.status === "approved") {
        try { localStorage.setItem(approvalNoticeKey(application), "shown"); } catch {}
        byId("notification-banner").style.display = "none";
      }
      renderMyCard();
    }
    if (view === "profile") { renderProfile(); }
  };
  function configureStudentNavigation(app) {
    const approved = app?.status === "approved";
    const cardTab = byId("student-home-tab");
    const requestTab = byId("student-card-tab");
    cardTab.dataset.studentView = "card";
    cardTab.textContent = "Ma carte";
    requestTab.dataset.studentView = "request";
    requestTab.textContent = "Demande";
    requestTab.hidden = approved;
    if (approved && byId("student-view-request").classList.contains("active")) selectStudentView("card");
  }
  const populateRequestForm = () => {
    const app = getApplication();
    const source = app || profile;
    byId("request-first").value = source.firstName || "";
    byId("request-last").value = source.lastName || "";
    byId("request-sex").value = source.sex || "F";
    if (byId("request-birth")) byId("request-birth").value = source.birthDate || "";
    byId("request-phone").value = source.phone || "";
    byId("request-program").value = source.program || D.programs[0].code;
    byId("request-level").value = source.level || D.levels[0];
    byId("request-site").value = source.site || D.sites[0].id;
    byId("request-origin-group").value = source.originGroup || profile?.originGroup || "";
    byId("request-country-origin").value = source.countryOfOrigin || profile?.countryOfOrigin || "";
  };

  function renderNotification(app) {
    const node = byId("notification-banner");
    if (!app) { node.style.display = "none"; return; }
    if (app.status === "approved") {
      const noticeKey = approvalNoticeKey(app);
      let alreadyShown = false;
      try { alreadyShown = localStorage.getItem(noticeKey) === "shown"; } catch {}
      if (alreadyShown || document.querySelector("#student-view-card.active")) { node.style.display = "none"; return; }
      try { localStorage.setItem(noticeKey, "shown"); } catch {}
      node.innerHTML = `<strong>Votre carte est approuvée.</strong> Votre matricule définitif est <b>${esc(app.finalMatricule)}</b>. Votre carte est disponible dans « Ma carte ».`;
    } else if (app.status === "rejected") {
      node.innerHTML = `<strong>Votre demande a été rejetée.</strong> ${esc(app.rejectionReason || "Consultez l’administration de votre site d’apprentissage pour la suite.")}`;
    } else {
      node.innerHTML = `<strong>Demande envoyée.</strong> Votre matricule temporaire est <b>${esc(app.temporaryMatricule)}</b>. La demande attend l’examen de l’administration.`;
    }
    node.style.display = "block";
  }

  function applicationSummary(app) {
    const program = D.getProgram(app.program);
    const site = D.getSite(app.site);
    const statusText = app.status === "approved" ? "Approuvée" : app.status === "rejected" ? "Rejetée" : "En attente";
    const report = app.status === "approved" ? `Matricule définitif : <b>${esc(app.finalMatricule)}</b>` : app.status === "rejected" ? esc(app.rejectionReason || "Contactez l’administration de votre site pour connaître la suite.") : `Matricule temporaire : <b>${esc(app.temporaryMatricule)}</b>`;
    byId("request-form-wrap").style.display = "none";
    byId("request-readonly").style.display = "block";
    byId("request-readonly").innerHTML = `<div class="application-photo-row">${app.photo ? `<img class="identity-photo" src="${esc(app.photo)}" alt="Photo d’identité transmise">` : `<div class="identity-photo photo-missing">Photo<br>non fournie</div>`}<div><span class="status ${app.status === "approved" ? "active" : app.status === "rejected" ? "rejected" : "pending"}">${statusText}</span><h3 style="margin-top:10px">${esc(fullName(app))}</h3><p class="muted small">${report}</p></div></div><div class="readonly-grid"><div class="info-row"><span>Sexe</span><strong>${esc(app.sex)}</strong></div><div class="info-row"><span>Naissance</span><strong>${esc(app.birthDate || "—")}</strong></div><div class="info-row"><span>E-mail</span><strong>${esc(app.email)}</strong></div><div class="info-row"><span>Filière</span><strong>${esc(program.name)}</strong></div><div class="info-row"><span>Niveau</span><strong>${esc(app.level)}</strong></div><div class="info-row"><span>Ville / site</span><strong>${esc(site.city)}</strong></div><div class="info-row"><span>Demande envoyée</span><strong>${new Date(app.submittedAt).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}</strong></div></div><div class="notice" style="margin-top:16px">Ces renseignements sont en lecture seule après l’envoi. Pour corriger une erreur avant approbation, contactez l’administration de votre site dans les 24 heures.</div>${app.status === "rejected" ? `<p class="small muted" style="margin-top:12px">Une nouvelle demande pourra être préparée après échange avec l’administration.</p><button class="btn secondary sm" id="new-request-after-rejection" type="button">Préparer une nouvelle demande</button>` : ""}`;
    byId("request-status-box").innerHTML = `<span>Statut</span><strong>${statusText}</strong>`;
    if (app.status === "rejected") byId("new-request-after-rejection").addEventListener("click", () => {
      application = null;
      byId("request-form-wrap").style.display = "block";
      byId("request-readonly").style.display = "none";
      populateRequestForm();
      selectedPhoto = "";
      selectedPhotoName = "";
      byId("request-photo").required = true;
      byId("photo-preview").innerHTML = "<span>Aucune photo sélectionnée</span>";
    });
  }

  function drawCard(app) {
    const zone = byId("student-card-zone");
    const key = cardKey(app);
    if (renderedCardKey === key && zone.querySelector(".card-v2-front")) {
      const photo = zone.querySelector(".card-v2-portrait img");
      if (photo && app.photo && photo.getAttribute("src") !== app.photo) photo.src = app.photo;
      return;
    }
    renderedCardKey = key;
    const qrPayload = `IRGIB-CARTE:${app.finalMatricule}`;
    zone.innerHTML = D.cardHtml(app, "card-qr");
    const qrHost = byId("card-qr");
    if (profile?.cardSuspendedAt) {
      qrHost.innerHTML = `<span class="card-suspended-qr">Carte temporairement désactivée</span>`;
      return;
    }
    if (window.QRCode && app.finalMatricule) {
      new QRCode(qrHost, { text: qrPayload, width: 256, height: 256, colorDark: "#102a39", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M });
      const canvas = qrHost.querySelector("canvas");
      try {
        if (canvas?.width && canvas?.height) {
          const image = document.createElement("img");
          image.src = canvas.toDataURL("image/png");
          image.alt = "QR de vérification du badge";
          image.style.cssText = "display:block;width:100%;height:100%;object-fit:contain;background:#fff";
          qrHost.replaceChildren(image);
        }
      } catch { /* La sortie QR reste disponible via l’image créée par la bibliothèque. */ }
      if (!qrHost.querySelector("img")) qrHost.innerHTML = `<div class="qr-fallback">QR indisponible</div>`;
    } else qrHost.innerHTML = `<div class="qr-fallback">${app.finalMatricule ? "QR indisponible" : "QR après approbation"}</div>`;
  }

  function renderMyCard() {
    const app = getApplication();
    const status = byId("my-card-status");
    const zone = byId("student-card-zone");
    const actions = byId("card-print-actions");
    zone.closest(".student-card-panel")?.classList.toggle("has-approved-card", Boolean(app && app.status === "approved"));
    if (!app || app.status !== "approved") {
      renderedCardKey = "";
      zone.style.display = "none";
      actions.style.display = "none";
      status.innerHTML = app ? `<div class="pending-card"><span class="status ${app.status === "rejected" ? "rejected" : "pending"}">${app.status === "rejected" ? "Demande rejetée" : "En attente d’approbation"}</span><h3>${app.status === "rejected" ? "Votre carte n’est pas encore disponible." : "La carte apparaîtra après validation."}</h3><p>Matricule temporaire : <b>${esc(app.temporaryMatricule)}</b></p><p class="small muted">Le matricule définitif et le QR de la carte sont créés après approbation.</p></div>` : `<div class="pending-card"><h3>Envoyez d’abord votre demande de badge.</h3><p class="small muted">Un matricule temporaire sera créé à l’envoi. La carte et son QR seront disponibles après approbation.</p></div>`;
      return;
    }
    status.innerHTML = profile?.cardSuspendedAt
      ? `<div class="notice card-suspension-notice" role="status"><strong>Carte temporairement désactivée.</strong><p>Ce badge ne peut plus être utilisé pour le moment. Rapprochez-vous de l’administration de votre site pour régulariser votre situation.</p></div>`
      : "";
    if (zone.style.display !== "none" && renderedCardKey === cardKey(app) && zone.querySelector(".card-v2-front")) return;
    zone.style.display = "block";
    actions.style.display = profile?.cardSuspendedAt ? "none" : "flex";
    drawCard(app);
  }

  function renderProfile() {
    const app = getApplication();
    const person = app || profile;
    const site = D.getSite(person.site);
    const program = D.getProgram(person.program);
    const matricule = app ? app.finalMatricule || app.temporaryMatricule : "Pas encore attribué";
    const originLabel = (profile?.originGroup || person.originGroup) === "anglophone" ? "Anglophone · matricule A" : (profile?.originGroup || person.originGroup) === "francophone" ? "Francophone · matricule F" : app ? "Non renseignée · matricule historique conservé" : "À renseigner dans la demande de badge";
    const country = profile?.countryOfOrigin || person.countryOfOrigin || "À renseigner";
    byId("profile-details").innerHTML = `<div class="profile-summary"><div class="profile-monogram">${esc(`${person.firstName?.[0] || ""}${person.lastName?.[0] || ""}`.toUpperCase())}</div><div><h3>${esc(fullName(person))}</h3><span class="muted small">${esc(person.email)}</span></div></div><div class="readonly-grid"><div class="info-row"><span>Sexe</span><strong>${esc(person.sex)}</strong></div><div class="info-row"><span>Téléphone</span><strong>${esc(person.phone || "—")}</strong></div><div class="info-row"><span>Filière</span><strong>${esc(program.name)}</strong></div><div class="info-row"><span>Niveau</span><strong>${esc(person.level)}</strong></div><div class="info-row"><span>Origine</span><strong>${esc(originLabel)}</strong></div><div class="info-row"><span>Pays d’origine</span><strong>${esc(country)}</strong></div><div class="info-row"><span>Ville / site</span><strong>${esc(site.city)}</strong></div><div class="info-row"><span>Matricule</span><strong>${esc(matricule)}</strong></div></div>`;
    resetPasswordFlow();
  }

  function setPasswordStage(stage) {
    passwordChangeStage = stage;
    const stages = [byId("password-current-stage"), byId("password-new-stage"), byId("password-confirm-stage")];
    stages.forEach((element, index) => { element.hidden = index !== stage; });
    byId("new-password").disabled = stage < 1;
    byId("confirm-password").disabled = stage < 2;
  }

  function resetPasswordFlow(close = true) {
    const form = byId("password-form");
    if (!form) return;
    form.reset();
    form.hidden = close;
    byId("password-open").setAttribute("aria-expanded", String(!close));
    passwordSuccessNotice.hidden = true;
    passwordSuccessNotice.textContent = "";
    setPasswordStage(0);
    byId("password-message").textContent = "";
  }

  function renderSiteInfo() {
    const site = D.getSite((getApplication() || profile).site);
    byId("my-site-info").innerHTML = site.points.map(point => `<div class="info-row site-info-row"><span>${esc(point.name)}</span><strong>${esc(point.address)}<br>${esc(point.phone)}</strong></div>`).join("");
  }

  function todayAttendance() {
    const date = D.todayKey();
    return attendanceRows.filter(item => item.day === date);
  }
  function renderAttendance() {
    const app = getApplication();
    byId("today-label").textContent = D.todayKey();
    const rows = todayAttendance();
    byId("my-attendance-rows").innerHTML = rows.length ? rows.map(item => `<tr><td>${item.createdAt ? new Date(item.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "—"}</td><td>${esc(item.courseTitle)}</td><td>${esc(D.getProgram(item.program).shortName)} · ${esc(item.level)}</td><td>${esc(D.getSite(item.site).city)}</td><td>${item.status === "present" ? (item.markedBy ? "Responsable de classe" : "Moi") : "—"}</td><td><span class="status ${item.status === "present" ? "active" : "absent"}">${item.status === "present" ? "Présent" : "Absent"}</span></td></tr>`).join("") : `<tr><td colspan="6" class="table-empty">Aucune séance créée pour votre groupe aujourd’hui.</td></tr>`;
    const person = app || profile;
    const alreadyPresent = rows.some(item => item.status === "present" && item.site === person?.site && item.program === person?.program && item.level === person?.level);
    if (scannedSession && scannedSessionInfo) showAttendancePreview(scannedSession, scannedSessionInfo, app);
    byId("start-scan").disabled = alreadyPresent;
    if (alreadyPresent) {
      byId("attendance-message").textContent = "Votre présence du jour est déjà enregistrée. Le QR ne peut être validé qu’une fois.";
      byId("submit-attendance").disabled = true;
    }
  }
  function renderAnnouncements() {
    const node = byId("news-list");
    if (!announcements.length) {
      node.innerHTML = `<article class="news-empty"><span class="news-empty-icon" aria-hidden="true">✦</span><strong>Rien de nouveau pour le moment</strong><p>Les annonces importantes de votre campus apparaîtront ici.</p></article>`;
      return;
    }
    node.innerHTML = announcements.map(item => {
      const fullBody = String(item.body || "");
      const expandable = fullBody.length > 220 || Boolean(item.mediaUrl);
      const expanded = expandedNewsIds.has(item.id);
      const body = expandable && !expanded ? `${esc(fullBody.slice(0, 220).trimEnd())}${fullBody.length > 220 ? "…" : ""}` : esc(fullBody);
      const media = item.mediaUrl ? (item.media_type === "video" ? `<video class="news-media" src="${esc(item.mediaUrl)}" controls playsinline preload="metadata" aria-label="Vidéo : ${esc(item.title)}"></video>` : `<img class="news-media" src="${esc(item.mediaUrl)}" alt="Illustration : ${esc(item.title)}" loading="lazy">`) : "";
      return `<article class="news-card${expanded ? " expanded" : ""}"><div class="news-card-top"><span class="news-tag">${item.site ? esc(D.getSite(item.site).city) : "Tous les sites"}</span><span class="news-publisher">${item.published_by_site ? `Publié par l’administration de ${esc(D.getSite(item.published_by_site).city)}` : "Publié par l’administration générale"}</span><time datetime="${esc(item.published_at)}">${new Date(item.published_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}</time></div><h3>${esc(item.title)}</h3><p>${body}</p>${expanded ? media : ""}${expandable ? `<button type="button" class="news-expand-btn" data-news-expand="${esc(item.id)}">${expanded ? "Fermer" : "Voir plus"}</button>` : ""}</article>`;
    }).join("");
    node.querySelectorAll("[data-news-expand]").forEach(button => button.addEventListener("click", () => {
      const id = button.dataset.newsExpand;
      if (expandedNewsIds.has(id)) expandedNewsIds.delete(id); else expandedNewsIds.add(id);
      renderAnnouncements();
    }));
  }
  async function signAnnouncementMedia(rows) {
    return Promise.all((rows || []).map(async item => {
      if (!item.media_path) return item;
      const { data } = await db.storage.from("campus-announcement-media").createSignedUrl(item.media_path, 3600);
      return { ...item, mediaUrl: data?.signedUrl || "" };
    }));
  }
  async function loadAnnouncements() {
    if (!profile) return;
    const node = byId("news-list");
    if (!lastNewsRefresh) node.innerHTML = `<article class="news-empty"><span class="news-empty-icon" aria-hidden="true">✦</span><strong>Chargement des actualités…</strong><p>Nous récupérons les informations de votre campus.</p></article>`;
    const { data, error } = await db.from("campus_announcements").select("id,title,body,site,published_by_site,published_at,expires_at,media_path,media_type").eq("status", "published").or(`site.is.null,site.eq.${profile.site}`).or(`expires_at.is.null,expires_at.gte.${D.todayKey()}`).order("published_at", { ascending: false }).limit(15);
    if (error) {
      node.innerHTML = `<article class="news-empty"><strong>Actualités indisponibles</strong><p>La connexion aux informations du campus a échoué. Réessayez dans quelques instants.</p><button class="btn secondary sm" id="retry-news" type="button">Réessayer</button></article>`;
      byId("retry-news").addEventListener("click", () => void loadAnnouncements());
      return;
    }
    announcements = await signAnnouncementMedia(data || []);
    announcements.forEach(item => knownAnnouncementIds.add(item.id));
    initialNewsLoaded = true;
    lastNewsRefresh = Date.now();
    byId("news-campus-label").textContent = D.getSite(profile.site).city;
    renderAnnouncements();
  }

  async function showCampusNotification(title, body, tag, url) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const options = { body, icon: "/assets/pwa-192-v4.png", badge: "/assets/pwa-192-v4.png", tag, data: { url } };
    try {
      if ("serviceWorker" in navigator) (await navigator.serviceWorker.ready).showNotification(title, options);
      else { const notification = new Notification(title, options); notification.onclick = () => { window.focus(); window.location.href = url; }; }
    } catch { /* Notifications remain optional; the in-app feed still updates. */ }
  }
  let notificationPermissionRequested = false;
  function requestNotificationPermissionFromFirstInteraction(event) {
    if (!("Notification" in window) || Notification.permission !== "default") {
      document.removeEventListener("click", requestNotificationPermissionFromFirstInteraction, true);
      return;
    }
    if (!currentUser || !profile || byId("portal-screen").style.display === "none" || event.target.closest?.("#signout")) return;
    if (notificationPermissionRequested) return;
    notificationPermissionRequested = true;
    document.removeEventListener("click", requestNotificationPermissionFromFirstInteraction, true);
    // Browsers require a real user gesture before showing the system permission dialog.
    void Notification.requestPermission().then(permission => {
      if (permission === "granted" && currentUser && profile) void registerPushSubscription();
    }).catch(() => {});
  }
  function base64UrlBytes(value) {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
  }
  async function registerPushSubscription() {
    if (!("serviceWorker" in navigator) || !window.IRGIB_VAPID_PUBLIC_KEY || !profile || !currentUser) return false;
    try {
      const registration = await navigator.serviceWorker.ready;
      const applicationServerKey = base64UrlBytes(window.IRGIB_VAPID_PUBLIC_KEY);
      let subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const existingKey = subscription.options?.applicationServerKey;
        const existingBytes = existingKey ? new Uint8Array(existingKey) : null;
        const keyMatches = existingBytes && existingBytes.length === applicationServerKey.length
          && existingBytes.every((byte, index) => byte === applicationServerKey[index]);
        if (!keyMatches) {
          await db.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint).eq("user_id", currentUser.id);
          await subscription.unsubscribe();
          subscription = null;
        }
      }
      if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
      const row = subscription.toJSON();
      if (!row.endpoint || !row.keys?.p256dh || !row.keys?.auth) return false;
      const { error } = await db.from("push_subscriptions").upsert({ endpoint: row.endpoint, user_id: currentUser.id, site: profile.site, p256dh: row.keys.p256dh, auth_secret: row.keys.auth }, { onConflict: "endpoint" });
      return !error;
    } catch { return false; }
  }

  async function loadRepresentativeGroupmates() {
    const panel = byId("rep-attendance-panel");
    if (!currentUser || representativeRefreshInFlight) return;
    representativeRefreshInFlight = true;
    try {
      const { data: assignment, error: assignmentError } = await db.from("class_representatives").select("user_id").eq("user_id", currentUser.id).maybeSingle();
      if (assignmentError) {
        if (!representativeAssigned) panel.hidden = true;
        byId("rep-pin-message").textContent = "La vérification du rôle est temporairement indisponible. Réessayez dans un instant.";
        return;
      }
      if (!assignment) {
        representativeAssigned = false;
        panel.hidden = true;
        return;
      }
      representativeAssigned = true;
      panel.hidden = false;
      const { data: hasPin, error: pinError } = await db.rpc("representative_daily_qr_pin_status");
      if (!pinError) representativeHasPin = Boolean(hasPin);
      byId("rep-pin-label").textContent = representativeHasPin ? "Code secret à 4 chiffres" : "Créer votre code secret à 4 chiffres";
      byId("rep-pin-submit").textContent = representativeHasPin ? "Voir le QR du jour" : "Créer mon code";
      byId("rep-pin-submit").disabled = Boolean(pinError);
      byId("rep-pin-message").textContent = pinError ? "Le code du jour n’est pas disponible pour le moment. Réessayez plus tard." : "";
      if (!representativeGroupmates.length) byId("rep-absent-list").innerHTML = `<p class="muted small">Chargement de la liste des absents…</p>`;
      const { data, error } = await db.rpc("list_representative_groupmates");
      if (error) { byId("rep-absent-list").innerHTML = `<p class="form-message">Impossible de charger les absents. Réessayez dans un instant.</p>`; return; }
      representativeGroupmates = data || [];
      if (!representativeGroupmates.some(row => row.student_id === selectedRepresentativeStudent?.student_id)) selectedRepresentativeStudent = null;
      renderRepresentativeGroupmates();
    } finally {
      representativeRefreshInFlight = false;
    }
  }
  function startRepresentativeRefresh() {
    if (representativeRefreshTimer) window.clearInterval(representativeRefreshTimer);
    representativeRefreshTimer = window.setInterval(() => {
      if (currentUser && !document.hidden && !byId("rep-attendance-panel").hidden) void loadRepresentativeGroupmates();
    }, 10000);
  }
  function hideRepresentativeDailyQr() {
    const result = byId("rep-daily-qr-result");
    if (!result) return;
    result.hidden = true;
    byId("rep-daily-qr-image").replaceChildren();
    byId("rep-daily-pin").value = "";
  }
  async function revealRepresentativeDailyQr(pin) {
    if (representativeHasPin) hideRepresentativeDailyQr();
    const message = byId("rep-pin-message");
    const submit = byId("rep-pin-submit");
    submit.disabled = true;
    message.textContent = "Vérification…";
    try {
      const rpc = representativeHasPin ? "representative_daily_attendance_qr" : "set_representative_daily_qr_pin";
      const { data, error } = await db.rpc(rpc, { p_pin: pin });
      if (error) throw error;
      if (!representativeHasPin) {
        representativeHasPin = true;
        byId("rep-pin-label").textContent = "Code secret à 4 chiffres";
        byId("rep-pin-submit").textContent = "Voir le QR du jour";
        message.textContent = "Code créé. Saisissez-le à nouveau pour révéler le QR.";
        byId("rep-daily-pin").value = "";
        return;
      }
      if (!data?.ok) throw new Error(data?.message || "Code incorrect");
      const host = byId("rep-daily-qr-image");
      host.replaceChildren();
      if (!window.QRCode) throw new Error("Le générateur QR n’est pas chargé. Rechargez puis réessayez.");
      new QRCode(host, { text: data.token, width: 240, height: 240, colorDark: "#102a39", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M });
      byId("rep-daily-qr-title").textContent = `${data.program} · ${data.level} · ${D.getSite(data.site).city}`;
      byId("rep-daily-qr-date").textContent = `${data.course_title} · ${new Date(`${data.session_day}T12:00:00`).toLocaleDateString("fr-FR", { dateStyle: "long", timeZone: "Africa/Porto-Novo" })} · valable jusqu’à minuit`;
      byId("rep-daily-qr-result").hidden = false;
      message.textContent = "QR révélé. Masquez-le en quittant cette page ou après le pointage.";
      byId("rep-daily-pin").value = "";
    } catch (error) {
      message.textContent = friendlyError(error, "Le QR n’a pas pu être révélé. Vérifiez le code puis réessayez.");
    } finally { submit.disabled = false; }
  }
  function renderRepresentativeGroupmates() {
    const list = byId("rep-absent-list");
    const button = byId("rep-mark-attendance");
    button.disabled = !selectedRepresentativeStudent;
    if (!representativeGroupmates.length) {
      list.innerHTML = `<div class="notice">Aucun étudiant absent à confirmer dans votre groupe pour aujourd’hui.</div>`;
      return;
    }
    list.innerHTML = representativeGroupmates.map(row => `<button type="button" class="rep-absent-choice${row.student_id === selectedRepresentativeStudent?.student_id ? " selected" : ""}" data-rep-student="${esc(row.student_id)}" aria-pressed="${row.student_id === selectedRepresentativeStudent?.student_id}"><span><strong>${esc(`${row.last_name} ${row.first_name}`)}</strong><small>${esc(row.final_matricule || "Matricule indisponible")}</small></span><span class="status absent">Absent</span></button>`).join("");
  }
  function stopRepresentativeCamera(hide = true) {
    if (representativeScanFrame) cancelAnimationFrame(representativeScanFrame);
    representativeScanFrame = 0;
    if (representativeCameraStream) representativeCameraStream.getTracks().forEach(track => track.stop());
    representativeCameraStream = null;
    const video = byId("rep-camera-video");
    video.srcObject = null;
    video.style.display = "none";
    byId("rep-scanner-placeholder").style.display = "grid";
    if (hide) byId("rep-badge-scanner").hidden = true;
  }
  async function confirmRepresentativeBadge(rawValue) {
    if (!selectedRepresentativeStudent || representativeBadgeVerified || !rawValue) return;
    representativeLastQr = String(rawValue).trim();
    const sequence = ++representativeVerifySequence;
    stopRepresentativeCamera(false);
    const status = byId("rep-badge-verification");
    status.hidden = false;
    status.dataset.state = "checking";
    status.innerHTML = `<span class="verify-spinner" aria-hidden="true"></span><div><strong>Vérification du QR…</strong><span>Contrôle de la carte et du groupe autorisé.</span></div>`;
    byId("rep-badge-confirm-actions").hidden = true;
    const startedAt = performance.now();
    let error = null;
    try {
      const result = await db.rpc("verify_classmate_badge", { p_student_id: selectedRepresentativeStudent.student_id, p_scanned_qr: representativeLastQr });
      error = result.error || (result.data?.ok === false ? new Error(result.data.message || "QR non valide") : null);
    } catch (rpcError) { error = rpcError; }
    await new Promise(resolve => window.setTimeout(resolve, Math.max(0, 950 - (performance.now() - startedAt))));
    if (sequence !== representativeVerifySequence) return;
    if (error) {
      representativeBadgeVerified = false;
      status.dataset.state = "invalid";
      status.innerHTML = `<span class="verify-cross" aria-hidden="true">×</span><div><strong>QR non valide pour cet étudiant</strong><span>Le badge ne correspond pas au nom sélectionné ou n’est pas actif.</span></div>`;
      byId("rep-badge-confirm-actions").hidden = false;
      byId("rep-confirm-attendance").hidden = true;
      byId("rep-rescan-badge").textContent = "Scanner à nouveau";
      byId("rep-attendance-message").textContent = "Vérifiez l’étudiant sélectionné, puis recommencez le scan.";
      return;
    }
    representativeBadgeVerified = true;
    status.dataset.state = "valid";
    status.innerHTML = `<span class="verify-checkmark" aria-hidden="true"><svg viewBox="0 0 48 48"><path d="m12 25 8 8 17-19"/></svg></span><div><strong>QR confirmé</strong><span>Badge valide pour ${esc(`${selectedRepresentativeStudent.last_name} ${selectedRepresentativeStudent.first_name}`)}.</span></div>`;
    byId("rep-badge-confirm-actions").hidden = false;
    byId("rep-confirm-attendance").hidden = false;
    byId("rep-rescan-badge").textContent = "Recommencer";
    byId("rep-attendance-message").textContent = "Vérifiez le nom puis confirmez le pointage.";
  }
  async function markSelectedClassmateAttendance() {
    if (!selectedRepresentativeStudent || !representativeBadgeVerified || !representativeLastQr) return;
    const current = selectedRepresentativeStudent;
    if (!window.confirm(`Confirmer la présence de ${current.last_name} ${current.first_name} après vérification de son badge ?`)) return;
    const button = byId("rep-confirm-attendance");
    button.disabled = true;
    byId("rep-attendance-message").textContent = "Enregistrement de la présence…";
    try {
      const { error } = await db.rpc("mark_classmate_attendance", { p_student_id: current.student_id, p_scanned_qr: representativeLastQr });
      if (error) throw error;
      stopRepresentativeCamera();
      selectedRepresentativeStudent = null;
      representativeLastQr = "";
      representativeBadgeVerified = false;
      byId("rep-badge-confirm-actions").hidden = true;
      byId("rep-attendance-message").dataset.state = "success";
      byId("rep-attendance-message").textContent = `Présence mise à jour : ${current.last_name} ${current.first_name} est maintenant présent.`;
      await loadStudentData();
      renderAttendance();
      await loadRepresentativeGroupmates();
    } catch (error) {
      button.disabled = false;
      byId("rep-attendance-message").dataset.state = "error";
      byId("rep-attendance-message").textContent = friendlyError(error, "La présence n’a pas pu être mise à jour. Actualisez la liste puis recommencez.");
      representativeBadgeVerified = false;
      representativeLastQr = "";
      byId("rep-badge-confirm-actions").hidden = true;
      byId("rep-mark-attendance").disabled = !selectedRepresentativeStudent;
    }
  }
  async function startRepresentativeCamera() {
    const message = byId("rep-attendance-message");
    message.dataset.state = "";
    if (!selectedRepresentativeStudent) { message.textContent = "Sélectionnez d’abord un étudiant absent."; return; }
    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) { message.textContent = "Le scan nécessite un navigateur récent et une connexion HTTPS."; return; }
    if (!("BarcodeDetector" in window) && typeof window.jsQR !== "function") { message.textContent = "Le lecteur QR ne s’est pas chargé. Rechargez la page puis réessayez."; return; }
    try {
      byId("rep-badge-scanner").hidden = false;
      message.textContent = "Présentez le QR du badge de l’étudiant sélectionné devant la caméra.";
      representativeCameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      const video = byId("rep-camera-video");
      video.srcObject = representativeCameraStream;
      video.style.display = "block";
      await video.play();
      byId("rep-scanner-placeholder").style.display = "none";
      let detector = null;
      if ("BarcodeDetector" in window) { try { detector = new BarcodeDetector({ formats: ["qr_code"] }); } catch { detector = null; } }
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { willReadFrequently: true });
      representativeLastScanTime = 0;
      representativeLastQr = "";
      representativeBadgeVerified = false;
      let candidateValue = "";
      let candidateFrames = 0;
      const scan = async timestamp => {
        if (!representativeCameraStream) return;
        const now = timestamp || performance.now();
        if (now - representativeLastScanTime >= 260 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
          representativeLastScanTime = now;
          let rawValue = "";
          if (detector) { try { rawValue = (await detector.detect(video)).find(code => code.rawValue)?.rawValue || ""; } catch { detector = null; } }
          if (!rawValue && typeof window.jsQR === "function") {
            try {
              const scale = Math.min(1, 900 / video.videoWidth);
              canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
              canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
              context.drawImage(video, 0, 0, canvas.width, canvas.height);
              const frame = context.getImageData(0, 0, canvas.width, canvas.height);
              rawValue = window.jsQR(frame.data, frame.width, frame.height, { inversionAttempts: "attemptBoth" })?.data || "";
            } catch { /* La caméra peut ne pas encore fournir une image exploitable. */ }
          }
          if (rawValue && rawValue.trim() === candidateValue) candidateFrames++;
          else { candidateValue = rawValue.trim(); candidateFrames = rawValue ? 1 : 0; }
          if (candidateFrames >= 3) { await confirmRepresentativeBadge(candidateValue); return; }
        }
        if (representativeCameraStream) representativeScanFrame = requestAnimationFrame(scan);
      };
      representativeScanFrame = requestAnimationFrame(scan);
    } catch (error) {
      stopRepresentativeCamera();
      message.textContent = cameraErrorMessage(error);
    }
  }

  async function verifyStudentSessionQr(rawToken) {
    const preview = byId("attendance-preview");
    byId("attendance-message").textContent = "Vérification du QR de séance…";
    byId("submit-attendance").disabled = true;
    preview.innerHTML = `<div class="qr-checking"><span class="verify-spinner" aria-hidden="true"></span><strong>Vérification du QR de séance…</strong><span>Nous contrôlons qu’il correspond bien à votre groupe.</span></div>`;
    const startedAt = performance.now();
    const { data, error } = await db.rpc("student_attendance_session_info", { p_token: rawToken });
    await new Promise(resolve => window.setTimeout(resolve, Math.max(0, 850 - (performance.now() - startedAt))));
    if (error) {
      scannedSession = ""; scannedSessionInfo = null;
      preview.innerHTML = `<div class="qr-invalid"><strong>QR non confirmé</strong><span>Ce code ne correspond pas à votre groupe ou la séance est terminée. Vérifiez auprès du responsable.</span></div>`;
      byId("attendance-message").textContent = "Présentez le QR de présence actif de votre groupe.";
      byId("submit-attendance").disabled = true;
      stopCamera();
      return false;
    }
    showAttendancePreview(rawToken, data);
    byId("attendance-message").textContent = "QR confirmé. Validez pour enregistrer votre présence.";
    stopCamera();
    return true;
  }
  function showAttendancePreview(token, info, app = getApplication()) {
    scannedSession = token;
    scannedSessionInfo = info;
    const person = app || profile;
    const site = D.getSite(info.site || person.site);
    const program = D.getProgram(info.program || person.program);
    byId("attendance-preview").innerHTML = `<div class="qr-confirmed"><span class="qr-checkmark" aria-hidden="true"><svg viewBox="0 0 48 48"><path d="m12 25 8 8 17-19"/></svg></span><div><strong>QR confirmé</strong><span>${esc(info.course_title || "Séance du jour")} · ${esc(site.city)}</span></div></div><div class="readonly-grid"><div class="info-row"><span>Étudiant</span><strong>${esc(fullName(person))}</strong></div><div class="info-row"><span>Matricule</span><strong>${esc(app?.finalMatricule || app?.temporaryMatricule || "En attente de demande")}</strong></div><div class="info-row"><span>Filière · niveau</span><strong>${esc(program.shortName)} · ${esc(info.level || person.level)}</strong></div><div class="info-row"><span>Ville / site</span><strong>${esc(site.city)}</strong></div><div class="info-row"><span>Date</span><strong>${esc(info.session_day || D.todayKey())}</strong></div></div>`;
    byId("submit-attendance").disabled = false;
  }
  function decodeSession(raw) {
    let value = String(raw || "").trim();
    try { const parsed = JSON.parse(value); value = String(parsed.sessionId || parsed.session || parsed.code || value); } catch {}
    if (/^https?:\/\//i.test(value)) {
      try { const url = new URL(value); value = url.searchParams.get("sessionId") || url.searchParams.get("session") || url.searchParams.get("code") || url.pathname.split("/").filter(Boolean).at(-1) || value; } catch {}
    }
    if (!value || value.startsWith("IRGIB-CARTE:")) throw new Error("Ce QR n’est pas un code de séance de présence.");
    return value.slice(0, 180);
  }
  function stopCamera() {
    if (scanFrame) cancelAnimationFrame(scanFrame);
    scanFrame = 0;
    if (cameraStream) cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
    byId("camera-video").srcObject = null;
    byId("camera-video").style.display = "none";
    byId("scanner-placeholder").style.display = "grid";
    byId("stop-scan").style.display = "none";
    byId("start-scan").style.display = "inline-flex";
  }
  function cameraErrorMessage(error) {
    if (error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError") return "L’accès à la caméra est refusé. Autorisez la caméra pour ce site dans les réglages du navigateur, puis réessayez.";
    if (error?.name === "NotFoundError" || error?.name === "DevicesNotFoundError") return "Aucune caméra n’a été détectée sur cet appareil.";
    if (error?.name === "NotReadableError" || error?.name === "TrackStartError") return "La caméra est utilisée par une autre application. Fermez cette application puis réessayez.";
    if (error?.name === "SecurityError" || !window.isSecureContext) return "La caméra exige une connexion sécurisée HTTPS. Ouvrez le site avec son adresse https://.";
    return "La caméra n’a pas pu démarrer. Vérifiez les autorisations de caméra, puis réessayez.";
  }
  async function startCamera() {
    byId("attendance-message").textContent = "";
    if (todayAttendance().some(item => item.status === "present" && item.site === (application || profile)?.site && item.program === (application || profile)?.program && item.level === (application || profile)?.level)) {
      byId("attendance-message").textContent = "Votre présence du jour est déjà enregistrée.";
      renderAttendance();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      byId("attendance-message").textContent = window.isSecureContext
        ? "Ce navigateur ne permet pas d’ouvrir la caméra. Essayez un navigateur récent et autorisez l’accès à la caméra."
        : cameraErrorMessage({ name: "SecurityError" });
      return;
    }
    if (!("BarcodeDetector" in window) && typeof window.jsQR !== "function") {
      byId("attendance-message").textContent = "Le lecteur QR n’a pas pu se charger. Vérifiez votre connexion, puis rechargez la page.";
      return;
    }
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      const video = byId("camera-video");
      video.srcObject = cameraStream;
      video.style.display = "block";
      await video.play();
      byId("scanner-placeholder").style.display = "none";
      byId("start-scan").style.display = "none";
      byId("stop-scan").style.display = "inline-flex";
      let detector = null;
      if ("BarcodeDetector" in window) {
        try { detector = new BarcodeDetector({ formats: ["qr_code"] }); } catch { detector = null; }
      }
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { willReadFrequently: true });
      lastScanTime = 0;
      const scan = async timestamp => {
        if (!cameraStream) return;
        const now = timestamp || performance.now();
        if (now - lastScanTime >= 180 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
          lastScanTime = now;
          let rawValue = "";
          if (detector) {
            try { rawValue = (await detector.detect(video)).find(code => code.rawValue)?.rawValue || ""; }
            catch { detector = null; }
          }
          if (!rawValue && typeof window.jsQR === "function") {
            try {
              const scale = Math.min(1, 900 / video.videoWidth);
              canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
              canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
              context.drawImage(video, 0, 0, canvas.width, canvas.height);
              const frame = context.getImageData(0, 0, canvas.width, canvas.height);
              rawValue = window.jsQR(frame.data, frame.width, frame.height, { inversionAttempts: "attemptBoth" })?.data || "";
            } catch { /* La vidéo peut ne pas encore fournir d’image décodable. */ }
          }
          if (rawValue) {
            try {
              await verifyStudentSessionQr(decodeSession(rawValue));
              return;
            } catch (error) {
              byId("attendance-message").textContent = "Ce QR ne contient pas un code de séance reconnu. Présentez le QR de présence.";
            }
          }
        }
        scanFrame = requestAnimationFrame(scan);
      };
      scanFrame = requestAnimationFrame(scan);
    } catch (error) {
      byId("attendance-message").textContent = cameraErrorMessage(error);
      stopCamera();
    }
  }

  async function activatePortal() {
    if (!currentUser) { setScreen("auth-screen"); return; }
    try { await loadStudentData(); }
    catch (error) {
      if (error.name === "AccountBannedError") { showBlockedAccount(error.message); return; }
      if (error.name === "AccountPendingError" || error.name === "AccountRejectedError") { await showPendingAccount(error.message, error.name === "AccountRejectedError"); return; }
      setScreen("auth-screen"); byId("login-message").textContent = friendlyError(error, "Impossible de charger votre espace. Vérifiez votre connexion ou contactez l’administration de votre site."); return;
    }
    setScreen("portal-screen");
    byId("news-campus-label").textContent = D.getSite(profile.site).city;
    if ("Notification" in window && Notification.permission === "granted") void registerPushSubscription();
    void loadAnnouncements();
    void loadRepresentativeGroupmates();
    startRepresentativeRefresh();
    if (!studentChannel) studentChannel = db.channel(`student-${currentUser.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "student_profiles", filter: `user_id=eq.${currentUser.id}` }, payload => {
        if (payload.new?.banned_at) showBlockedAccount(payload.new.ban_reason || "Votre compte a été banni par l’administration de votre établissement.");
        else if (profile && Object.hasOwn(payload.new || {}, "card_suspended_at")) {
          profile.cardSuspendedAt = payload.new.card_suspended_at || null;
          renderMyCard();
          renderProfile();
        }
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "badge_applications", filter: `student_id=eq.${currentUser.id}` }, async () => {
        const oldStatus = application?.status;
        try {
          await loadStudentData();
          if (application) applicationSummary(application);
          configureStudentNavigation(application);
          renderNotification(application);
          renderMyCard();
          if (oldStatus !== "approved" && application?.status === "approved") {
            selectStudentView("card");
            void showCampusNotification("Votre badge IRGIB est approuvé", `Votre matricule définitif est ${application.finalMatricule}. Votre carte est disponible dans votre espace.`, `badge-approved-${application.id}`, "/etudiant/#card");
          }
        }
        catch { byId("login-message").textContent = "La mise à jour de votre dossier est temporairement indisponible."; }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "attendance_records", filter: `student_id=eq.${currentUser.id}` }, async () => {
        try { await loadStudentData(); renderAttendance(); await loadRepresentativeGroupmates(); }
        catch { byId("attendance-message").textContent = "La liste des présences n’a pas pu être actualisée."; }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "campus_announcements" }, payload => {
        const item = payload.new;
        if (item?.status !== "published" || (item.site && item.site !== profile.site)) return;
        if (initialNewsLoaded && !knownAnnouncementIds.has(item.id)) void showCampusNotification("Nouvelle actualité IRGIB", item.title, `campus-news-${item.id}`, "/etudiant/#news");
        void loadAnnouncements();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "campus_site_contacts", filter: `site=eq.${profile.site}` }, async () => {
        try { await loadStudentData(); renderSiteInfo(); renderMyCard(); }
        catch { /* L’actualisation périodique récupérera les coordonnées en cas d’interruption. */ }
      }).subscribe();
    showHeroGreeting(profile.firstName);
    const app = getApplication();
    configureStudentNavigation(app);
    renderNotification(getApplication());
    renderSiteInfo();
    renderProfile();
    if (app) applicationSummary(app);
    else { byId("request-form-wrap").style.display = "block"; byId("request-readonly").style.display = "none"; populateRequestForm(); }
    renderMyCard();
    renderAttendance();
    if (location.hash === "#news") selectStudentView("news");
    else if (location.hash === "#card") selectStudentView("card");
    else selectStudentView("card");
  }

  byId("show-login").addEventListener("click", () => showAuthPage("login"));
  byId("show-signup").addEventListener("click", () => showAuthPage("signup"));
  document.querySelectorAll("[data-open-signup]").forEach(button => button.addEventListener("click", () => showAuthPage("signup")));
  document.querySelectorAll("[data-open-login]").forEach(button => button.addEventListener("click", () => showAuthPage("login")));
  byId("login-form").addEventListener("submit", async event => {
    event.preventDefault();
    const email = byId("login-email").value.trim().toLowerCase();
    const password = byId("login-password").value;
    const button = event.currentTarget.querySelector('[type="submit"]'); button.disabled = true;
    try {
      const { data, error } = await db.auth.signInWithPassword({ email, password });
      if (error) throw error;
      currentUser = data.user;
      byId("login-form").reset();
      await activatePortal();
    } catch (error) {
      if (/bann|ban|suspend/i.test(error?.message || "")) showBlockedAccount("Votre compte a été banni par l’administration de votre établissement. Contactez l’administration de votre site.");
      else byId("login-message").textContent = "Connexion impossible. Vérifiez vos identifiants et confirmez votre e-mail.";
    }
    finally { button.disabled = false; }
  });
  byId("signup-form").addEventListener("submit", async event => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const password = String(values.get("password"));
    const draft = { firstName: String(values.get("firstName")).trim(), lastName: String(values.get("lastName")).trim(), email: String(values.get("email")).trim().toLowerCase(), phone: String(values.get("phone")).trim(), sex: String(values.get("sex")), originGroup: String(values.get("originGroup")), countryOfOrigin: String(values.get("countryOfOrigin")).trim(), program: String(values.get("program")), level: String(values.get("level")), site: String(values.get("site")) };
    if (password.length < 8 || !draft.phone || !draft.countryOfOrigin || !["francophone", "anglophone"].includes(draft.originGroup)) { byId("signup-message").textContent = "Renseignez le téléphone, le pays et l’origine francophone ou anglophone, puis vérifiez le mot de passe (8 caractères minimum)."; return; }
    if (!window.confirm(`Confirmer la création du compte étudiant pour ${draft.firstName} ${draft.lastName} (${draft.email}) ?`)) return;
    const button = event.currentTarget.querySelector('[type="submit"]'); button.disabled = true;
    try {
      const { data, error } = await db.auth.signUp({ email: draft.email, password, options: { data: { account_type: "student", first_name: draft.firstName, last_name: draft.lastName, phone: draft.phone, sex: draft.sex, origin_group: draft.originGroup, country_of_origin: draft.countryOfOrigin, program: draft.program, level: draft.level, site: draft.site } } });
      if (error) throw error;
      if (data.session) { currentUser = data.user; byId("signup-form").reset(); await activatePortal(); }
      else {
        pendingSignupEmail = draft.email;
        byId("verify-code").value = "";
        byId("verify-message").textContent = "";
        byId("demo-code-note").textContent = `Un code de confirmation a été envoyé à ${draft.email}. Copiez-le depuis votre boîte e-mail et collez-le ci-dessus.`;
        setScreen("verify-screen");
      }
    } catch (error) { byId("signup-message").textContent = friendlyError(error, "La création du compte a échoué. Vérifiez les informations puis réessayez."); }
    finally { button.disabled = false; }
  });
  byId("verify-form").addEventListener("submit", async event => {
    event.preventDefault();
    const token = byId("verify-code").value.replace(/\s/g, "");
    if (!pendingSignupEmail) { byId("verify-message").textContent = "Recommencez l’inscription pour demander un nouveau code."; return; }
    if (!/^\d{6,8}$/.test(token)) { byId("verify-message").textContent = "Saisissez le code numérique reçu par e-mail."; return; }
    if (!window.confirm("Confirmer ce code et transmettre votre compte à l’administration de votre site pour validation ?")) return;
    const button = event.currentTarget.querySelector('[type="submit"]'); button.disabled = true;
    byId("verify-message").textContent = "Vérification du code…";
    try {
      if ("Notification" in window && Notification.permission === "default") {
        try { await Notification.requestPermission(); } catch { /* La confirmation de l’e-mail reste possible sans notifications. */ }
      }
      const { data, error } = await db.auth.verifyOtp({ email: pendingSignupEmail, token, type: "email" });
      if (error) throw error;
      if (!data.user) throw new Error("La confirmation a réussi mais le compte étudiant n’a pas été retourné. Connectez-vous pour continuer.");
      currentUser = data.user;
      pendingSignupEmail = "";
      byId("verify-form").reset();
      await activatePortal();
    } catch (error) {
      byId("verify-message").textContent = /expired|invalid|token|otp/i.test(error.message || "") ? "Code incorrect ou expiré. Vérifiez le code reçu ou demandez-en un nouveau." : friendlyError(error, "La vérification a échoué. Réessayez.");
    } finally { button.disabled = false; }
  });
  byId("resend-code").addEventListener("click", async () => {
    if (!pendingSignupEmail) { byId("verify-message").textContent = "Recommencez l’inscription pour demander un nouveau code."; return; }
    const button = byId("resend-code"); button.disabled = true;
    byId("verify-message").textContent = "Envoi d’un nouveau code…";
    try {
      const { error } = await db.auth.resend({ type: "signup", email: pendingSignupEmail });
      if (error) throw error;
      byId("verify-code").value = "";
      byId("verify-message").textContent = `Un nouveau code a été envoyé à ${pendingSignupEmail}.`;
    } catch (error) { byId("verify-message").textContent = friendlyError(error, "Le code n’a pas pu être renvoyé. Attendez un instant puis réessayez."); }
    finally { button.disabled = false; }
  });
  byId("back-to-signup").addEventListener("click", () => { setScreen("auth-screen"); showAuthPage("signup"); });
  byId("password-open").addEventListener("click", () => {
    resetPasswordFlow(false);
    byId("current-password").focus();
  });
  byId("password-cancel").addEventListener("click", () => resetPasswordFlow(true));
  byId("password-verify").addEventListener("click", async event => {
    const button = event.currentTarget;
    const current = byId("current-password").value;
    const email = currentUser?.email;
    if (!email || !current) { byId("password-message").textContent = "Saisissez votre mot de passe actuel pour continuer."; return; }
    button.disabled = true;
    byId("password-message").textContent = "Vérification du mot de passe actuel…";
    try {
      const { data, error } = await db.auth.signInWithPassword({ email, password: current });
      if (error || !data.user || data.user.id !== currentUser.id) {
        byId("password-message").textContent = "Le mot de passe actuel est incorrect. Vérifiez-le puis réessayez.";
        return;
      }
      byId("current-password").value = "";
      setPasswordStage(1);
      byId("password-message").textContent = "Mot de passe vérifié. Choisissez maintenant un nouveau mot de passe.";
      byId("new-password").focus();
    } catch {
      byId("password-message").textContent = "La vérification n’a pas abouti. Vérifiez votre connexion puis réessayez.";
    } finally { button.disabled = false; }
  });
  byId("password-continue").addEventListener("click", () => {
    const next = byId("new-password").value;
    if (next.length < 8) { byId("password-message").textContent = "Le nouveau mot de passe doit contenir au moins 8 caractères."; return; }
    if (next === currentUser?.email) { byId("password-message").textContent = "Choisissez un mot de passe différent de votre adresse e-mail."; return; }
    setPasswordStage(2);
    byId("password-message").textContent = "Saisissez une seconde fois le nouveau mot de passe pour le confirmer.";
    byId("confirm-password").focus();
  });
  byId("password-back-current").addEventListener("click", () => { setPasswordStage(0); byId("current-password").focus(); });
  byId("password-back-new").addEventListener("click", () => { setPasswordStage(1); byId("new-password").focus(); });
  byId("password-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (passwordChangeStage === 0) { byId("password-verify").click(); return; }
    if (passwordChangeStage === 1) { byId("password-continue").click(); return; }
    const next = byId("new-password").value;
    if (next.length < 8) { byId("password-message").textContent = "Le nouveau mot de passe doit contenir au moins 8 caractères."; setPasswordStage(1); return; }
    if (next !== byId("confirm-password").value) { byId("password-message").textContent = "Les deux nouveaux mots de passe ne correspondent pas."; return; }
    if (!window.confirm("Confirmer le changement de votre mot de passe ? Vous devrez utiliser le nouveau lors de votre prochaine connexion.")) return;
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    byId("password-message").textContent = "Mise à jour sécurisée en cours…";
    try {
      const { error } = await db.auth.updateUser({ password: next });
      if (error) { byId("password-message").textContent = friendlyError(error, "Le mot de passe n’a pas pu être modifié. Réessayez."); return; }
      resetPasswordFlow(true);
      passwordSuccessNotice.textContent = "Votre mot de passe a été modifié.";
      passwordSuccessNotice.hidden = false;
    } catch {
      byId("password-message").textContent = "La mise à jour n’a pas abouti. Vérifiez votre connexion puis réessayez.";
    } finally { button.disabled = false; }
  });
  byId("signout").addEventListener("click", async () => {
    if (!window.confirm("Voulez-vous vraiment vous déconnecter de votre espace étudiant ?")) return;
    stopCamera();
    stopRepresentativeCamera();
    if (studentChannel) { await db.removeChannel(studentChannel); studentChannel = null; }
    if (representativeRefreshTimer) { window.clearInterval(representativeRefreshTimer); representativeRefreshTimer = 0; }
    // Remove this device's push endpoint before the session closes, so another
    // student using the same browser can register it safely on their account.
    try {
      const registration = await navigator.serviceWorker?.getRegistration("/");
      const subscription = await registration?.pushManager?.getSubscription();
      if (subscription) {
        await db.from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
        await subscription.unsubscribe();
      }
    } catch { /* Signing out must still work when push is unavailable. */ }
    await db.auth.signOut();
    currentUser = null; profile = null; application = null; attendanceRows = [];
    profile = null;
    setScreen("auth-screen");
    showAuthPage("login");
  });
  document.addEventListener("click", requestNotificationPermissionFromFirstInteraction, true);
  byId("rep-mark-attendance").addEventListener("click", async event => {
    event.currentTarget.disabled = true;
    byId("rep-attendance-message").dataset.state = "";
    await startRepresentativeCamera();
    event.currentTarget.disabled = !selectedRepresentativeStudent;
  });
  byId("rep-confirm-attendance").addEventListener("click", () => void markSelectedClassmateAttendance());
  byId("rep-rescan-badge").addEventListener("click", () => {
    representativeVerifySequence++;
    representativeBadgeVerified = false;
    representativeLastQr = "";
    byId("rep-badge-confirm-actions").hidden = true;
    byId("rep-badge-verification").hidden = true;
    void startRepresentativeCamera();
  });
  byId("rep-pin-form").addEventListener("submit", event => {
    event.preventDefault();
    const pin = byId("rep-daily-pin").value;
    if (!/^\d{4}$/.test(pin)) { byId("rep-pin-message").textContent = "Saisissez exactement 4 chiffres."; return; }
    if (!representativeHasPin && !window.confirm("Créer ce code secret à 4 chiffres pour protéger l’accès au QR quotidien de votre groupe ?")) return;
    void revealRepresentativeDailyQr(pin);
  });
  byId("rep-hide-daily-qr").addEventListener("click", () => {
    hideRepresentativeDailyQr();
    byId("rep-pin-message").textContent = "QR masqué. Saisissez votre code secret pour le révéler de nouveau.";
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden) hideRepresentativeDailyQr(); });
  window.addEventListener("pagehide", hideRepresentativeDailyQr);
  byId("rep-absent-list").addEventListener("click", event => {
    const choice = event.target.closest("[data-rep-student]");
    if (!choice || representativeCameraStream) return;
    selectedRepresentativeStudent = representativeGroupmates.find(row => row.student_id === choice.dataset.repStudent) || null;
    byId("rep-attendance-message").textContent = selectedRepresentativeStudent ? `Étudiant sélectionné : ${selectedRepresentativeStudent.last_name} ${selectedRepresentativeStudent.first_name}. Scannez son QR pour confirmer.` : "";
    renderRepresentativeGroupmates();
  });
  byId("rep-stop-scan").addEventListener("click", () => {
    representativeVerifySequence++;
    representativeBadgeVerified = false;
    representativeLastQr = "";
    stopRepresentativeCamera();
    byId("rep-badge-confirm-actions").hidden = true;
    byId("rep-badge-verification").hidden = true;
    byId("rep-mark-attendance").disabled = !selectedRepresentativeStudent;
    byId("rep-attendance-message").textContent = "Scan annulé. Aucune présence n’a été modifiée.";
  });

  byId("request-photo").addEventListener("change", async event => {
    const file = event.target.files?.[0];
    selectedPhoto = "";
    selectedPhotoName = "";
    selectedPhotoBlob = null;
    if (!file) { byId("photo-preview").innerHTML = "<span>Aucune photo sélectionnée</span>"; return; }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) { event.target.value = ""; byId("photo-preview").innerHTML = "<span>Choisissez une photo JPG, PNG ou WebP de 5 Mo maximum.</span>"; return; }
    selectedPhotoName = file.name;
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 700 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close?.();
      selectedPhoto = canvas.toDataURL("image/jpeg", 0.82);
      selectedPhotoBlob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.82));
    } catch {
      try {
        selectedPhoto = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("Lecture de la photo impossible.")); reader.readAsDataURL(file); });
        selectedPhotoBlob = file;
      } catch (error) { selectedPhoto = ""; selectedPhotoBlob = null; byId("photo-preview").innerHTML = `<span>${esc(error.message)}</span>`; return; }
    }
    byId("photo-preview").innerHTML = `<img src="${selectedPhoto}" alt="Aperçu de la photo d’identité"><span>${esc(selectedPhotoName)}</span>`;
  });

  byId("request-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (!selectedPhoto) { byId("request-message").textContent = "Ajoutez une photo d’identité en tenue de l’école."; return; }
    const values = new FormData(event.currentTarget);
    const firstName = String(values.get("firstName")).trim();
    const lastName = String(values.get("lastName")).trim();
    const safeName = /^[\p{L}\p{M} .’'-]+$/u;
    if (!safeName.test(firstName) || !safeName.test(lastName)) { byId("request-message").textContent = "Vérifiez le nom et le prénom : lettres, espaces, apostrophe ou trait d’union uniquement."; return; }
    if (!window.confirm(`Confirmer l’envoi de votre demande de badge pour ${firstName} ${lastName} ? Vérifiez bien les informations et la photo avant de continuer.`)) return;
    const button = event.currentTarget.querySelector('[type="submit"]'); button.disabled = true;
    let photoPath = "";
    try {
      const details = { first_name: firstName, last_name: lastName, phone: String(values.get("phone")).trim(), sex: String(values.get("sex")), origin_group: String(values.get("originGroup")), country_of_origin: String(values.get("countryOfOrigin")).trim(), program: String(values.get("program")), level: String(values.get("level")), site: String(values.get("site")), birth_date: String(values.get("birthDate")) };
      if (!details.country_of_origin || !["francophone", "anglophone"].includes(details.origin_group)) throw new Error("Renseignez votre pays et votre origine francophone ou anglophone.");
      const { data: updatedProfile, error: profileError } = await db.rpc("student_update_profile", { p_first_name: details.first_name, p_last_name: details.last_name, p_phone: details.phone, p_sex: details.sex, p_program: details.program, p_level: details.level, p_site: details.site, p_birth_date: details.birth_date, p_origin_group: details.origin_group, p_country_of_origin: details.country_of_origin });
      if (profileError) throw profileError;
      profile = fromProfileRow(Array.isArray(updatedProfile) ? updatedProfile[0] : updatedProfile);
      if (!selectedPhotoBlob) throw new Error("La photo n’a pas pu être préparée. Choisissez une autre image.");
      const photoMime = selectedPhotoBlob.type || "image/jpeg";
      const photoExtension = photoMime === "image/png" ? "png" : photoMime === "image/webp" ? "webp" : "jpg";
      photoPath = `${currentUser.id}/${crypto.randomUUID()}.${photoExtension}`;
      const { error: uploadError } = await db.storage.from("student-photos").upload(photoPath, selectedPhotoBlob, { contentType: photoMime, upsert: false });
      if (uploadError) throw uploadError;
      const payload = { student_id: currentUser.id, ...details, email: profile.email, photo_path: photoPath };
      const { data: inserted, error: insertError } = await db.from("badge_applications").insert(payload).select("*").single();
      if (insertError) throw insertError;
      application = fromApplicationRow(inserted);
      const { data: signed } = await db.storage.from("student-photos").createSignedUrl(photoPath, 600);
      application.photo = signed?.signedUrl || "";
      selectedPhoto = ""; selectedPhotoBlob = null;
      applicationSummary(application); renderNotification(application); renderProfile(); renderMyCard(); renderAttendance();
      byId("request-status-box").innerHTML = `<span>Statut</span><strong>En attente · ${esc(application.temporaryMatricule)}</strong>`;
    } catch (error) {
      if (photoPath) await db.storage.from("student-photos").remove([photoPath]);
      byId("request-message").textContent = friendlyError(error, "La demande n’a pas pu être enregistrée. Vérifiez votre connexion puis réessayez.");
    } finally { button.disabled = false; }
  });

  document.querySelectorAll(".student-tabs [data-student-view]").forEach(button => button.addEventListener("click", () => selectStudentView(button.dataset.studentView)));
  window.addEventListener("hashchange", () => {
    const view = location.hash === "#news" ? "news" : location.hash === "#card" ? "card" : "";
    if (view && currentUser) selectStudentView(view);
  });
  byId("start-scan").addEventListener("click", startCamera);
  byId("stop-scan").addEventListener("click", stopCamera);
  byId("submit-attendance").addEventListener("click", async () => {
    if (!scannedSession) return;
    const sessionLabel = scannedSessionInfo?.course_title || "la séance du jour";
    if (!window.confirm(`Confirmer votre présence pour ${sessionLabel} ? Cette validation ne pourra pas être annulée depuis l’application.`)) return;
    const button = byId("submit-attendance"); button.disabled = true;
    byId("attendance-message").textContent = "Enregistrement sécurisé de votre présence…";
    const tokenBeingSubmitted = scannedSession;
    let error;
    try { ({ error } = await db.rpc("submit_attendance", { p_token: tokenBeingSubmitted })); }
    catch { error = new Error("La connexion a été interrompue. Vérifiez votre appel avant de réessayer."); }
    if (error) {
      byId("attendance-message").textContent = /déjà enregistrée/i.test(error.message || "") ? "Votre présence à cette séance est déjà enregistrée." : friendlyError(error, "Présence non enregistrée. Vérifiez que le QR est actif et correspond à votre groupe.");
      if (/déjà enregistrée/i.test(error.message)) {
        scannedSession = "";
        scannedSessionInfo = null;
        try { await loadStudentData(); }
        catch { byId("attendance-message").textContent = "La présence semble déjà validée, mais l’appel n’a pas pu être actualisé. Rechargez la page pour vérifier."; }
        byId("attendance-preview").innerHTML = `<div class="attendance-done"><strong>Présence déjà validée</strong><span>Ce QR a déjà été utilisé pour enregistrer votre présence aujourd’hui.</span></div>`;
        renderAttendance();
      } else { button.disabled = false; }
      return;
    }
    byId("attendance-message").textContent = "Présence enregistrée dans la liste du jour.";
    try { await loadStudentData(); }
    catch { byId("attendance-message").textContent = "Présence enregistrée. L’actualisation de l’appel est temporairement indisponible."; }
    scannedSession = "";
    scannedSessionInfo = null;
    byId("attendance-preview").innerHTML = `<div class="attendance-done"><strong>Présence enregistrée</strong><span>Votre présence est confirmée pour la séance du jour.</span></div>`;
    renderAttendance();
    button.disabled = true;
  });
  byId("print-my-card").addEventListener("click", () => {
    if (profile?.cardSuspendedAt) { byId("my-card-status").insertAdjacentHTML("beforeend", '<p class="form-message" role="status">Cette carte est temporairement désactivée. Le PDF ne peut pas être téléchargé.</p>'); return; }
    const faces = [...byId("student-card-zone").querySelectorAll(".card-v2")];
    if (faces.length !== 2) { byId("my-card-status").insertAdjacentHTML("beforeend", '<p class="form-message" role="status">La carte complète n’est pas prête. Rechargez la page puis réessayez.</p>'); return; }
    const printWindow = window.open("", "irgib-card-print", "popup,width=980,height=820");
    if (!printWindow) { byId("my-card-status").insertAdjacentHTML("beforeend", '<p class="form-message" role="status">Autorisez l’ouverture de la fenêtre d’impression pour créer le PDF.</p>'); return; }
    printWindow.opener = null;
    const stylesUrl = new URL("../assets/styles.css?v=20261028a", location.href).href;
    const sheets = faces.map(face => {
      const clone = face.cloneNode(true);
      clone.querySelectorAll(".card-v2-qr").forEach(qrHost => {
        const canvas = qrHost.querySelector("canvas");
        const sourceImage = [...qrHost.querySelectorAll("img")].find(image => image.naturalWidth > 0);
        let qrSource = "";
        try { if (canvas?.width && canvas?.height) qrSource = canvas.toDataURL("image/png"); } catch { /* Utilise l’image déjà rendue si le canvas ne peut pas être exporté. */ }
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
      clone.querySelectorAll("img").forEach(image => { const src = image.getAttribute("src"); if (src && !src.startsWith("data:")) image.src = new URL(src, location.href).href; });
      return `<section class="card-print-sheet">${clone.outerHTML}</section>`;
    }).join("");
    printWindow.document.open();
    printWindow.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Carte étudiante IRGIB AFRICA</title><link rel="stylesheet" href="${stylesUrl}"><style>
      @page{size:A4 portrait;margin:0}*{box-sizing:border-box}html,body{margin:0!important;padding:0!important;width:210mm!important;min-width:210mm!important;background:#fff!important}.card-print-sheet{width:210mm;height:297mm;display:grid;place-items:center;overflow:hidden;break-after:page;page-break-after:always}.card-print-sheet:last-child{break-after:auto;page-break-after:auto}.card-print-sheet .card-v2{width:85.6mm!important;height:53.98mm!important;min-width:85.6mm!important;max-width:85.6mm!important;aspect-ratio:auto!important;margin:0!important;padding:2.2mm 2.4mm!important;border-radius:2mm!important;box-shadow:none!important;overflow:hidden!important;break-inside:avoid!important;page-break-inside:avoid!important;print-color-adjust:exact!important;-webkit-print-color-adjust:exact!important}.card-print-sheet .card-v2-front{break-after:auto!important;page-break-after:auto!important}.card-print-sheet .card-v2.card-back{display:grid!important;break-before:auto!important;page-break-before:auto!important}.card-print-sheet img{print-color-adjust:exact;-webkit-print-color-adjust:exact} @media print{html,body{width:210mm!important;min-width:210mm!important}.card-print-sheet{height:297mm!important;break-after:page!important;page-break-after:always!important}.card-print-sheet:last-child{break-after:auto!important;page-break-after:auto!important}}
      </style><style>.card-print-sheet .card-v2-qr{width:18mm!important;height:18mm!important;min-width:18mm!important;min-height:18mm!important;padding:.5mm!important;background:#fff!important;overflow:hidden!important;display:grid!important;place-items:center!important}.card-print-sheet .card-v2-verification{overflow:hidden!important;align-content:center!important;justify-items:center!important}.card-print-sheet .card-v2-qr img{display:block!important;width:100%!important;height:100%!important;max-width:100%!important;max-height:100%!important;object-fit:contain!important;background:#fff!important;filter:none!important;print-color-adjust:exact!important;-webkit-print-color-adjust:exact!important}</style></head><body>${sheets}<script>window.addEventListener('load',async()=>{await Promise.all([...document.images].map(i=>i.decode?.().catch(()=>{})));if(document.fonts?.ready)await document.fonts.ready;window.focus();setTimeout(()=>window.print(),150)});window.addEventListener('afterprint',()=>window.close());</script></body></html>`);
    printWindow.document.close();
  });

  byId("back-to-signup").textContent = "Retour à la connexion";
  byId("banned-return-login").addEventListener("click", () => {
    try { localStorage.removeItem("irgib-banned-account-notice"); } catch {}
    blockedAccountNotice = "";
    setScreen("auth-screen");
    showAuthPage("login");
  });
  byId("account-pending-return-login").addEventListener("click", () => {
    pendingAccountNotice = "";
    setScreen("auth-screen");
    showAuthPage("login");
  });
  db.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") {
      hideRepresentativeDailyQr(); representativeHasPin = false; currentUser = null; profile = null; application = null; attendanceRows = []; renderedCardKey = ""; photoSignedUrl = ""; photoSignedPath = ""; photoSignedUntil = 0;
      if (blockedAccountNotice) { setScreen("banned-screen"); byId("banned-account-message").textContent = blockedAccountNotice; }
      else if (pendingAccountNotice) { setScreen("account-pending-screen"); byId("account-pending-message").textContent = pendingAccountNotice; }
      else { setScreen("auth-screen"); showAuthPage("login"); }
    }
    else if (event === "SIGNED_IN" && session?.user && !currentUser) { currentUser = session.user; void activatePortal(); }
  });
  db.auth.getSession().then(({ data, error }) => {
    if (error) throw error;
    currentUser = data.session?.user || null;
    if (currentUser) void activatePortal();
    else {
      try { blockedAccountNotice = localStorage.getItem("irgib-banned-account-notice") || ""; } catch {}
      if (blockedAccountNotice) { setScreen("banned-screen"); byId("banned-account-message").textContent = blockedAccountNotice; }
      else setScreen("auth-screen");
    }
  }).catch(() => { setScreen("auth-screen"); byId("login-message").textContent = "Connexion au service impossible. Rechargez la page ou contactez l’administration."; });
  window.setInterval(async () => {
    if (!currentUser || byId("portal-screen").style.display === "none") return;
    try {
      const beforeApp = cardKey(application);
      const beforeAttendance = attendanceKey(attendanceRows);
      await loadStudentData();
      if (beforeApp !== cardKey(application)) {
        if (application) applicationSummary(application);
        renderNotification(application);
        renderMyCard();
      }
      if (beforeAttendance !== attendanceKey(attendanceRows)) renderAttendance();
      if (Date.now() - lastNewsRefresh > 120000) void loadAnnouncements();
    }
    catch (error) { if (error?.name === "AccountBannedError") showBlockedAccount(error.message); /* a short network interruption does not invalidate the signed-in session */ }
  }, 30000);
})();
