(() => {
  const D = window.IRGIB_DATA;
  const cfg = window.IRGIB_SUPABASE_CONFIG;
  const db = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  const byId = id => document.getElementById(id);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const fullName = person => `${person.firstName || ""} ${person.lastName || ""}`.trim();
  const initSelects = () => {
    const programOptions = D.programs.map(item => `<option value="${item.code}">${item.code} · ${esc(item.name)}</option>`).join("");
    const levelOptions = D.levels.map(level => `<option value="${level}">${level}</option>`).join("");
    const siteOptions = D.sites.map(site => `<option value="${site.id}">${esc(site.city)}</option>`).join("");
    ["signup-program", "request-program"].forEach(id => byId(id).innerHTML = programOptions);
    ["signup-level", "request-level"].forEach(id => byId(id).innerHTML = levelOptions);
    ["signup-site", "request-site"].forEach(id => byId(id).innerHTML = siteOptions);
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
  let scannedSession = "";
  let announcements = [];
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
  let representativeLastScanTime = 0;
  let representativeLastQr = "";
  let representativeHasPin = false;
  let blockedAccountNotice = "";
  let renderedCardKey = "";
  let photoSignedUrl = "";
  let photoSignedPath = "";
  let photoSignedUntil = 0;

  const getApplication = () => application;
  const cardKey = app => app ? [app.id, app.status, app.finalMatricule, app.photoPath, app.firstName, app.lastName, app.birthDate, app.sex, app.program, app.level, app.site].join("|") : "";
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
  const fromProfileRow = row => row && ({ userId: row.user_id, firstName: row.first_name, lastName: row.last_name, email: row.email, phone: row.phone, sex: row.sex, program: row.program, level: row.level, site: row.site, birthDate: row.birth_date, bannedAt: row.banned_at || null, banReason: row.ban_reason || "" });
  const fromApplicationRow = row => row && ({ id: row.id, studentId: row.student_id, firstName: row.first_name, lastName: row.last_name, email: row.email, phone: row.phone, sex: row.sex, birthDate: row.birth_date, program: row.program, level: row.level, site: row.site, status: row.status, temporaryMatricule: row.temporary_matricule, finalMatricule: row.final_matricule, photoPath: row.photo_path, rejectionReason: row.rejection_reason, submittedAt: row.submitted_at, decidedAt: row.decided_at });
  function readableAccountError(error) {
    const message = error?.message || "";
    if (/coerce|single JSON object|PGRST116/i.test(message)) return "Ce compte n’a pas de dossier étudiant complet. Ouvrez Inscription avec la même adresse, ou contactez l’administration.";
    return message || "Impossible de charger votre dossier. Réessayez.";
  }
  async function loadStudentData() {
    const { data: profileRow, error: profileError } = await db.from("student_profiles").select("*").eq("user_id", currentUser.id).maybeSingle();
    if (profileError) throw profileError;
    if (!profileRow) {
      const repaired = await db.rpc("ensure_student_profile");
      const retry = repaired.error ? { data: null } : await db.from("student_profiles").select("*").eq("user_id", currentUser.id).maybeSingle();
      if (!retry.data) throw Object.assign(new Error("Ce compte n’a pas de dossier étudiant. Utilisez Inscription avec cette adresse, ou contactez l’administration de votre site."), { name: "MissingProfileError" });
      profile = fromProfileRow(retry.data);
    } else profile = fromProfileRow(profileRow);
    if (profile.bannedAt) {
      const site = D.getSite(profile.site)?.city || "votre site";
      throw Object.assign(new Error(profile.banReason || `Votre compte a été banni par l’administration de ${site}.`), { name: "AccountBannedError" });
    }
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
    ["loading-screen", "auth-screen", "verify-screen", "portal-screen", "banned-screen"].forEach(id => byId(id).style.display = id === screen ? "block" : "none");
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
  const selectStudentView = view => {
    hideRepresentativeDailyQr();
    document.querySelectorAll(".student-view").forEach(section => section.classList.toggle("active", section.id === `student-view-${view}`));
    document.querySelectorAll(".student-tabs [data-student-view]").forEach(button => button.classList.toggle("active", button.dataset.studentView === view));
    if (view === "attendance") { renderAttendance(); }
    if (view === "news") { void loadAnnouncements(); }
    if (view === "card") { renderMyCard(); }
    if (view === "profile") { renderProfile(); }
  };
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
  };

  function renderNotification(app) {
    const node = byId("notification-banner");
    if (!app) { node.style.display = "none"; return; }
    if (app.status === "approved") {
      node.innerHTML = `<strong>Votre carte est approuvée.</strong> Votre matricule définitif est <b>${esc(app.finalMatricule)}</b>. Votre carte est disponible dans Ma carte.`;
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
      if (app.photo && !photo) {
        const placeholder = zone.querySelector(".card-v2-photo-placeholder");
        if (placeholder) placeholder.outerHTML = `<img src="${esc(app.photo)}" alt="Photo de ${esc(app.firstName)} ${esc(app.lastName)}">`;
      }
      return;
    }
    renderedCardKey = key;
    const qrPayload = `IRGIB-CARTE:${app.finalMatricule}`;
    zone.innerHTML = D.cardHtml(app, "card-qr");
    const qrHost = byId("card-qr");
    if (window.QRCode && app.finalMatricule) {
      qrHost.innerHTML = "";
      new QRCode(qrHost, { text: qrPayload, width: 180, height: 180, colorDark: "#102a39", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M });
      const canvas = qrHost.querySelector("canvas");
      if (canvas) {
        const image = document.createElement("img");
        image.className = "card-qr-image";
        image.alt = "QR de vérification du badge";
        image.src = canvas.toDataURL("image/png");
        qrHost.querySelectorAll("canvas, img").forEach(node => node.remove());
        qrHost.append(image);
      }
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
    if (zone.style.display !== "none" && renderedCardKey === cardKey(app) && zone.querySelector(".card-v2-front")) return;
    status.innerHTML = `<div class="notice" style="margin-bottom:14px"><strong>Carte approuvée.</strong> Matricule définitif : ${esc(app.finalMatricule)}. Le QR du recto contient un identifiant de carte, sans nom ni données personnelles.</div>`;
    zone.style.display = "block";
    actions.style.display = "flex";
    drawCard(app);
  }

  function renderProfile() {
    const app = getApplication();
    const person = app || profile;
    const site = D.getSite(person.site);
    const program = D.getProgram(person.program);
    const matricule = app ? app.finalMatricule || app.temporaryMatricule : "Pas encore attribué";
    byId("profile-details").innerHTML = `<div class="profile-summary"><div class="profile-monogram">${esc(`${person.firstName?.[0] || ""}${person.lastName?.[0] || ""}`.toUpperCase())}</div><div><h3>${esc(fullName(person))}</h3><span class="muted small">${esc(person.email)}</span></div></div><div class="readonly-grid"><div class="info-row"><span>Sexe</span><strong>${esc(person.sex)}</strong></div><div class="info-row"><span>Téléphone</span><strong>${esc(person.phone || "—")}</strong></div><div class="info-row"><span>Filière</span><strong>${esc(program.name)}</strong></div><div class="info-row"><span>Niveau</span><strong>${esc(person.level)}</strong></div><div class="info-row"><span>Ville / site</span><strong>${esc(site.city)}</strong></div><div class="info-row"><span>Matricule</span><strong>${esc(matricule)}</strong></div></div>`;
    byId("password-form").reset();
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
    if (scannedSession) showAttendancePreview(scannedSession, app);
    byId("start-scan").disabled = alreadyPresent;
    if (alreadyPresent) {
      byId("attendance-message").textContent = "Votre présence du jour est déjà enregistrée. Le QR ne peut être validé qu’une fois.";
      byId("submit-attendance").disabled = true;
    }
  }
  function renderAnnouncements() {
    const node = byId("news-list");
    if (!announcements.length) {
      node.innerHTML = `<article class="news-empty"><span class="news-empty-icon" aria-hidden="true"></span><strong>Rien de nouveau pour le moment</strong><p>Les annonces importantes de votre campus apparaîtront ici.</p></article>`;
      return;
    }
    node.innerHTML = announcements.map(item => `<article class="news-card"><div class="news-card-top"><span class="news-tag">${item.site ? esc(D.getSite(item.site).city) : "Tous les campus"}</span><time datetime="${esc(item.published_at)}">${new Date(item.published_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}</time></div><h3>${esc(item.title)}</h3><p>${esc(item.body)}</p>${item.mediaUrl ? (item.media_type === "video" ? `<video class="news-media" src="${esc(item.mediaUrl)}" controls playsinline preload="metadata" aria-label="Vidéo : ${esc(item.title)}"></video>` : `<img class="news-media" src="${esc(item.mediaUrl)}" alt="Illustration : ${esc(item.title)}" loading="lazy">`) : ""}</article>`).join("");
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
    if (!lastNewsRefresh) node.innerHTML = `<article class="news-empty"><span class="news-empty-icon" aria-hidden="true"></span><strong>Chargement des actualités…</strong><p>Nous récupérons les informations de votre campus.</p></article>`;
    const { data, error } = await db.from("campus_announcements").select("id,title,body,site,published_at,expires_at,media_path,media_type").eq("status", "published").or(`site.is.null,site.eq.${profile.site}`).or(`expires_at.is.null,expires_at.gte.${D.todayKey()}`).order("published_at", { ascending: false }).limit(15);
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
    const options = { body, icon: "/assets/pwa-192-v3.png", badge: "/assets/pwa-192-v3.png", tag, data: { url } };
    try {
      if ("serviceWorker" in navigator) (await navigator.serviceWorker.ready).showNotification(title, options);
      else { const notification = new Notification(title, options); notification.onclick = () => { window.focus(); window.location.href = url; }; }
    } catch { /* Notifications remain optional; the in-app feed still updates. */ }
  }
  function configureNotificationOptIn() {
    const banner = byId("notification-optin");
    if (!("Notification" in window)) { banner.hidden = false; byId("notification-optin-message").textContent = "Ce navigateur ne prend pas en charge les notifications. Consultez les actualités dans votre espace étudiant."; byId("enable-notifications").hidden = true; byId("dismiss-notifications").textContent = "Compris"; }
    else if (Notification.permission === "granted") { banner.hidden = true; }
    else if (Notification.permission === "denied") { banner.hidden = false; byId("notification-optin-message").textContent = "Les notifications sont bloquées dans les réglages du navigateur. Vous pouvez quand même consulter les actualités et le statut de votre badge ici."; byId("enable-notifications").textContent = "Voir les réglages"; }
    else {
      let seen = false;
      try { seen = localStorage.getItem(`irgib-notification-optin-${currentUser.id}`) === "1"; } catch {}
      if (!seen) banner.hidden = false;
    }
  }
  async function requestCampusNotifications(messageTarget = byId("notification-optin-message")) {
    if (!("Notification" in window)) { messageTarget.textContent = "Ce navigateur ne prend pas en charge les notifications."; return; }
    if (Notification.permission === "denied") { messageTarget.textContent = "Autorisez les notifications dans les réglages du navigateur, puis revenez ici."; return; }
    try {
      const permission = await Notification.requestPermission();
      try { localStorage.setItem(`irgib-notification-optin-${currentUser.id}`, "1"); } catch {}
      byId("notification-optin").hidden = true;
      if (permission === "granted") {
        const subscribed = await registerPushSubscription();
        byId("notification-settings-message").textContent = subscribed ? "Notifications activées sur cet appareil, même lorsque l’application est en arrière-plan." : "Notifications activées pendant que l’application est ouverte. L’activation en arrière-plan sera terminée dès que le service sera prêt.";
      } else byId("notification-settings-message").textContent = "Vous pourrez activer les notifications depuis les réglages du navigateur.";
    } catch { messageTarget.textContent = "La demande de permission n’a pas abouti. Réessayez depuis les réglages du navigateur."; }
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
    panel.hidden = true;
    const { data: assignment, error: assignmentError } = await db.from("class_representatives").select("user_id").eq("user_id", currentUser.id).maybeSingle();
    if (assignmentError || !assignment) return;
    panel.hidden = false;
    const { data: hasPin, error: pinError } = await db.rpc("representative_daily_qr_pin_status");
    representativeHasPin = !pinError && Boolean(hasPin);
    byId("rep-pin-label").textContent = representativeHasPin ? "Code secret à 4 chiffres" : "Créer votre code secret à 4 chiffres";
    byId("rep-pin-submit").textContent = representativeHasPin ? "Voir le QR du jour" : "Créer mon code";
    byId("rep-pin-message").textContent = pinError ? "La fonction PIN n’est pas encore disponible. Appliquez la migration Supabase puis rechargez." : "";
    byId("rep-daily-pin").value = "";
    byId("rep-absent-list").innerHTML = `<p class="muted small">Chargement de la liste des absents…</p>`;
    const { data, error } = await db.rpc("list_representative_groupmates");
    if (error) { byId("rep-absent-list").innerHTML = `<p class="form-message">Impossible de charger les absents. Réessayez dans un instant.</p>`; return; }
    representativeGroupmates = data || [];
    if (!representativeGroupmates.some(row => row.student_id === selectedRepresentativeStudent?.student_id)) selectedRepresentativeStudent = null;
    renderRepresentativeGroupmates();
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
      message.textContent = error.message || "Le QR n’a pas pu être révélé. Vérifiez le code puis réessayez.";
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
    if (!selectedRepresentativeStudent || rawValue === representativeLastQr) return;
    representativeLastQr = rawValue;
    const expected = `IRGIB-CARTE:${selectedRepresentativeStudent.final_matricule || ""}`;
    if (!selectedRepresentativeStudent.final_matricule || rawValue !== expected) {
      byId("rep-attendance-message").textContent = "QR non valide pour cet étudiant : il ne correspond pas au badge sélectionné. Vérifiez son nom et scannez le QR de sa carte.";
      window.setTimeout(() => { representativeLastQr = ""; }, 1200);
      return;
    }
    const button = byId("rep-mark-attendance");
    button.disabled = true;
    byId("rep-attendance-message").textContent = "Badge reconnu. Vérification et enregistrement sécurisés…";
    let error;
    try {
      ({ error } = await db.rpc("mark_classmate_attendance", { p_student_id: selectedRepresentativeStudent.student_id, p_scanned_qr: rawValue }));
    } catch (rpcError) { error = rpcError; }
    if (error) {
      button.disabled = false;
      byId("rep-attendance-message").textContent = error.message || "La présence n’a pas pu être mise à jour.";
      window.setTimeout(() => { representativeLastQr = ""; }, 1200);
      return;
    }
    const markedName = `${selectedRepresentativeStudent.last_name} ${selectedRepresentativeStudent.first_name}`;
    stopRepresentativeCamera();
    selectedRepresentativeStudent = null;
    byId("rep-attendance-message").textContent = `Présence mise à jour : ${markedName} est maintenant marqué présent.`;
    await loadStudentData();
    renderAttendance();
    await loadRepresentativeGroupmates();
  }
  async function openUserCamera() {
    const attempts = [
      { video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
      { video: { facingMode: "environment" }, audio: false },
      { video: true, audio: false },
    ];
    let lastError;
    for (const constraints of attempts) {
      try { return await navigator.mediaDevices.getUserMedia(constraints); }
      catch (error) {
        lastError = error;
        if (error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError") throw error;
      }
    }
    throw lastError;
  }
  function prepareCameraVideo(video) {
    video.muted = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
  }
  async function startRepresentativeCamera() {
    const message = byId("rep-attendance-message");
    if (!selectedRepresentativeStudent) { message.textContent = "Sélectionnez d’abord un étudiant absent."; return; }
    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) { message.textContent = "Le scan nécessite un navigateur récent et une connexion HTTPS."; return; }
    if (!("BarcodeDetector" in window) && typeof window.jsQR !== "function") { message.textContent = "Le lecteur QR ne s’est pas chargé. Rechargez la page puis réessayez."; return; }
    try {
      byId("rep-badge-scanner").hidden = false;
      message.textContent = "Présentez le QR du badge de l’étudiant sélectionné devant la caméra.";
      representativeCameraStream = await openUserCamera();
      const video = byId("rep-camera-video");
      video.srcObject = representativeCameraStream;
      prepareCameraVideo(video);
      video.style.display = "block";
      byId("rep-scanner-placeholder").style.display = "none";
      try { await video.play(); } catch { /* Le flux est déjà ouvert. */ }
      let detector = null;
      if ("BarcodeDetector" in window) { try { detector = new BarcodeDetector({ formats: ["qr_code"] }); } catch { detector = null; } }
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { willReadFrequently: true });
      representativeLastScanTime = 0;
      representativeLastQr = "";
      const scan = async timestamp => {
        if (!representativeCameraStream) return;
        const now = timestamp || performance.now();
        if (now - representativeLastScanTime >= 180 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
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
          if (rawValue) await confirmRepresentativeBadge(rawValue);
        }
        if (representativeCameraStream) representativeScanFrame = requestAnimationFrame(scan);
      };
      representativeScanFrame = requestAnimationFrame(scan);
    } catch (error) {
      if (!representativeCameraStream) {
        stopRepresentativeCamera();
        message.textContent = cameraErrorMessage(error);
      } else message.textContent = "Le lecteur est ouvert. Présentez le QR du badge devant la caméra.";
    }
  }
  function showAttendancePreview(code, app = getApplication()) {
    scannedSession = code;
    const person = app || profile;
    const site = D.getSite(person.site);
    const program = D.getProgram(person.program);
    byId("attendance-preview").innerHTML = `<div class="attendance-code"><span class="eyebrow">Séance détectée</span><strong>${esc(code)}</strong></div><div class="readonly-grid"><div class="info-row"><span>Étudiant</span><strong>${esc(fullName(person))}</strong></div><div class="info-row"><span>Matricule</span><strong>${esc(app?.finalMatricule || app?.temporaryMatricule || "En attente de demande")}</strong></div><div class="info-row"><span>Filière · niveau</span><strong>${esc(program.shortName)} · ${esc(person.level)}</strong></div><div class="info-row"><span>Ville / site</span><strong>${esc(site.city)}</strong></div><div class="info-row"><span>Date</span><strong>${esc(D.todayKey())}</strong></div></div>`;
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
    if (error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError") return "L’accès à la caméra est refusé. Ouvrez les réglages de ce site dans le navigateur, autorisez la caméra, puis réessayez.";
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
    let stream;
    try {
      if (navigator.permissions?.query) {
        const status = await navigator.permissions.query({ name: "camera" }).catch(() => null);
        if (status?.state === "denied") {
          byId("attendance-message").textContent = "La caméra est bloquée pour ce site. Ouvrez les réglages du site (cadenas ou informations de la page), autorisez la caméra, puis rouvrez le scanner. Le navigateur ne redemande l’accès tant qu’il reste bloqué.";
          return;
        }
      }
      stream = await openUserCamera();
    } catch (error) {
      byId("attendance-message").textContent = cameraErrorMessage(error);
      return;
    }
    try {
      cameraStream = stream;
      const video = byId("camera-video");
      video.srcObject = cameraStream;
      prepareCameraVideo(video);
      video.style.display = "block";
      byId("scanner-placeholder").style.display = "none";
      try { await video.play(); } catch { /* Le flux est déjà autorisé : on continue même si la lecture automatique est retardée. */ }
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
              showAttendancePreview(decodeSession(rawValue));
              byId("attendance-message").textContent = "QR de séance détecté. Vérifiez les informations, puis validez votre présence.";
              stopCamera();
              return;
            } catch (error) {
              byId("attendance-message").textContent = error.message || "Ce QR ne contient pas un code de séance reconnu. Présentez le QR de présence.";
            }
          }
        }
        scanFrame = requestAnimationFrame(scan);
      };
      scanFrame = requestAnimationFrame(scan);
    } catch (error) {
      byId("attendance-message").textContent = "Le lecteur est ouvert, mais le décodage du QR a échoué. Rapprochez le code et réessayez.";
    }
  }

  async function activatePortal() {
    if (!currentUser) { setScreen("auth-screen"); return; }
    try { await loadStudentData(); }
    catch (error) {
      if (error.name === "AccountBannedError") { showBlockedAccount(error.message); return; }
      setScreen("auth-screen"); byId("login-message").textContent = readableAccountError(error); return;
    }
    setScreen("portal-screen");
    byId("news-campus-label").textContent = D.getSite(profile.site).city;
    configureNotificationOptIn();
    void loadAnnouncements();
    void loadRepresentativeGroupmates();
    if (!studentChannel) studentChannel = db.channel(`student-${currentUser.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "student_profiles", filter: `user_id=eq.${currentUser.id}` }, payload => {
        if (payload.new?.banned_at) showBlockedAccount(payload.new.ban_reason || "Votre compte a été banni par l’administration de votre établissement.");
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "badge_applications", filter: `student_id=eq.${currentUser.id}` }, async () => {
        const oldStatus = application?.status;
        try { await loadStudentData(); if (application) applicationSummary(application); renderNotification(application); renderMyCard(); if (oldStatus !== "approved" && application?.status === "approved") void showCampusNotification("Votre badge IRGIB est approuvé", `Votre matricule définitif est ${application.finalMatricule}. Votre carte est disponible dans votre espace.`, `badge-approved-${application.id}`, "/etudiant/#card"); }
        catch { byId("login-message").textContent = "La mise à jour de votre dossier est temporairement indisponible."; }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "attendance_records", filter: `student_id=eq.${currentUser.id}` }, async () => {
        try { await loadStudentData(); renderAttendance(); }
        catch { byId("attendance-message").textContent = "La liste des présences n’a pas pu être actualisée."; }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "campus_announcements" }, payload => {
        const item = payload.new;
        if (item?.status !== "published" || (item.site && item.site !== profile.site)) return;
        if (initialNewsLoaded && !knownAnnouncementIds.has(item.id)) void showCampusNotification("Nouvelle actualité IRGIB", item.title, `campus-news-${item.id}`, "/etudiant/#news");
        void loadAnnouncements();
      }).subscribe();
    byId("hello-name").textContent = profile.firstName;
    renderNotification(getApplication());
    renderSiteInfo();
    renderProfile();
    const app = getApplication();
    if (app) applicationSummary(app);
    else { byId("request-form-wrap").style.display = "block"; byId("request-readonly").style.display = "none"; populateRequestForm(); }
    renderMyCard();
    renderAttendance();
    if (location.hash === "#news") selectStudentView("news");
    else if (location.hash === "#card") selectStudentView("card");
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
      else byId("login-message").textContent = /coerce|single JSON object|PGRST116/i.test(error?.message || "") ? readableAccountError(error) : "Connexion impossible. Vérifiez vos identifiants et confirmez votre e-mail.";
    }
    finally { button.disabled = false; }
  });
  byId("signup-form").addEventListener("submit", async event => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const password = String(values.get("password"));
    const draft = { firstName: String(values.get("firstName")).trim(), lastName: String(values.get("lastName")).trim(), email: String(values.get("email")).trim().toLowerCase(), phone: String(values.get("phone")).trim(), sex: String(values.get("sex")), program: String(values.get("program")), level: String(values.get("level")), site: String(values.get("site")) };
    if (password.length < 8 || !draft.phone) { byId("signup-message").textContent = "Renseignez le téléphone et un mot de passe d’au moins 8 caractères."; return; }
    const button = event.currentTarget.querySelector('[type="submit"]'); button.disabled = true;
    try {
      const { data, error } = await db.auth.signUp({ email: draft.email, password, options: { data: { account_type: "student", first_name: draft.firstName, last_name: draft.lastName, phone: draft.phone, sex: draft.sex, program: draft.program, level: draft.level, site: draft.site } } });
      if (error) throw error;
      if (data.session) { currentUser = data.user; byId("signup-form").reset(); await activatePortal(); }
      else {
        pendingSignupEmail = draft.email;
        byId("verify-code").value = "";
        byId("verify-message").textContent = "";
        byId("demo-code-note").textContent = `Un code de confirmation a été envoyé à ${draft.email}. Copiez-le depuis votre boîte e-mail et collez-le ci-dessus.`;
        setScreen("verify-screen");
      }
    } catch (error) { byId("signup-message").textContent = error.message || "Création du compte impossible. Vérifiez les informations puis réessayez."; }
    finally { button.disabled = false; }
  });
  byId("verify-form").addEventListener("submit", async event => {
    event.preventDefault();
    const token = byId("verify-code").value.replace(/\s/g, "");
    if (!pendingSignupEmail) { byId("verify-message").textContent = "Recommencez l’inscription pour demander un nouveau code."; return; }
    if (!/^\d{6,8}$/.test(token)) { byId("verify-message").textContent = "Saisissez le code numérique reçu par e-mail."; return; }
    const button = event.currentTarget.querySelector('[type="submit"]'); button.disabled = true;
    byId("verify-message").textContent = "Vérification du code…";
    try {
      const { data, error } = await db.auth.verifyOtp({ email: pendingSignupEmail, token, type: "email" });
      if (error) throw error;
      if (!data.user) throw new Error("La confirmation a réussi mais le compte étudiant n’a pas été retourné. Connectez-vous pour continuer.");
      currentUser = data.user;
      pendingSignupEmail = "";
      byId("verify-form").reset();
      await activatePortal();
    } catch (error) {
      byId("verify-message").textContent = /expired|invalid|token|otp/i.test(error.message || "") ? "Code incorrect ou expiré. Vérifiez le code reçu ou demandez-en un nouveau." : error.message || "La vérification a échoué. Réessayez.";
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
    } catch (error) { byId("verify-message").textContent = error.message || "Le code n’a pas pu être renvoyé. Attendez un instant puis réessayez."; }
    finally { button.disabled = false; }
  });
  byId("back-to-signup").addEventListener("click", () => { setScreen("auth-screen"); showAuthPage("signup"); });
  byId("password-form").addEventListener("submit", async event => {
    event.preventDefault();
    const current = byId("current-password").value;
    const next = byId("new-password").value;
    const confirm = byId("confirm-password").value;
    if (next.length < 8) { byId("password-message").textContent = "Le nouveau mot de passe doit contenir au moins 8 caractères."; return; }
    if (next !== confirm) { byId("password-message").textContent = "Les deux nouveaux mots de passe ne correspondent pas."; return; }
    const { error } = await db.auth.updateUser({ password: next });
    byId("password-message").textContent = error ? "Le mot de passe n’a pas pu être mis à jour." : "Votre mot de passe a été mis à jour.";
    if (!error) event.currentTarget.reset();
  });
  byId("signout").addEventListener("click", async () => {
    stopCamera();
    stopRepresentativeCamera();
    if (studentChannel) { await db.removeChannel(studentChannel); studentChannel = null; }
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
  byId("enable-notifications").addEventListener("click", () => {
    if ("Notification" in window && Notification.permission === "denied") {
      byId("notification-optin-message").textContent = "Ouvrez les réglages du navigateur pour autoriser les notifications de ce site.";
      return;
    }
    void requestCampusNotifications();
  });
  byId("dismiss-notifications").addEventListener("click", () => {
    if (currentUser) { try { localStorage.setItem(`irgib-notification-optin-${currentUser.id}`, "1"); } catch {} }
    byId("notification-optin").hidden = true;
  });
  byId("notification-settings").addEventListener("click", () => {
    if ("Notification" in window && Notification.permission === "granted") {
      byId("notification-settings-message").textContent = "Activation des notifications en arrière-plan…";
      void registerPushSubscription().then(ok => { byId("notification-settings-message").textContent = ok ? "Notifications activées sur cet appareil, même lorsque l’application est en arrière-plan." : "Notifications visibles lorsque l’application est ouverte. La configuration des alertes en arrière-plan n’est pas encore terminée."; });
      return;
    }
    if ("Notification" in window && Notification.permission === "denied") { byId("notification-settings-message").textContent = "Autorisez les notifications dans les réglages du navigateur."; return; }
    void requestCampusNotifications(byId("notification-settings-message"));
  });
  byId("rep-mark-attendance").addEventListener("click", async event => {
    event.currentTarget.disabled = true;
    await startRepresentativeCamera();
    event.currentTarget.disabled = !selectedRepresentativeStudent;
  });
  byId("rep-pin-form").addEventListener("submit", event => {
    event.preventDefault();
    const pin = byId("rep-daily-pin").value;
    if (!/^\d{4}$/.test(pin)) { byId("rep-pin-message").textContent = "Saisissez exactement 4 chiffres."; return; }
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
    stopRepresentativeCamera();
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
    const button = event.currentTarget.querySelector('[type="submit"]'); button.disabled = true;
    let photoPath = "";
    try {
      const details = { first_name: firstName, last_name: lastName, phone: String(values.get("phone")).trim(), sex: String(values.get("sex")), program: String(values.get("program")), level: String(values.get("level")), site: String(values.get("site")), birth_date: String(values.get("birthDate")) };
      const { data: updatedProfile, error: profileError } = await db.rpc("student_update_profile", { p_first_name: details.first_name, p_last_name: details.last_name, p_phone: details.phone, p_sex: details.sex, p_program: details.program, p_level: details.level, p_site: details.site, p_birth_date: details.birth_date });
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
      byId("request-message").textContent = error.message || "La demande n’a pas pu être enregistrée. Vérifiez votre connexion puis réessayez.";
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
    const button = byId("submit-attendance"); button.disabled = true;
    byId("attendance-message").textContent = "Enregistrement sécurisé de votre présence…";
    const tokenBeingSubmitted = scannedSession;
    let error;
    try { ({ error } = await db.rpc("submit_attendance", { p_token: tokenBeingSubmitted })); }
    catch { error = new Error("La connexion a été interrompue. Vérifiez votre appel avant de réessayer."); }
    if (error) {
      byId("attendance-message").textContent = /déjà enregistrée/i.test(error.message) ? "Votre présence à cette séance est déjà enregistrée." : error.message || "Présence non enregistrée. Vérifiez que le QR est actif et correspond à votre groupe.";
      if (/déjà enregistrée/i.test(error.message)) {
        scannedSession = "";
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
    byId("attendance-preview").innerHTML = `<div class="attendance-done"><strong>Présence enregistrée</strong><span>Votre présence est confirmée pour la séance du jour.</span></div>`;
    renderAttendance();
    button.disabled = true;
  });
  byId("print-my-card").addEventListener("click", () => {
    const faces = [...byId("student-card-zone").querySelectorAll(".card-v2")];
    if (faces.length !== 2) { byId("my-card-status").insertAdjacentHTML("beforeend", '<p class="form-message" role="status">La carte complète n’est pas prête. Rechargez la page puis réessayez.</p>'); return; }
    const printWindow = window.open("", "irgib-card-print", "popup,width=980,height=820");
    if (!printWindow) { byId("my-card-status").insertAdjacentHTML("beforeend", '<p class="form-message" role="status">Autorisez l’ouverture de la fenêtre d’impression pour créer le PDF.</p>'); return; }
    printWindow.opener = null;
    const stylesUrl = new URL("../assets/styles.css?v=20261025g", location.href).href;
    const sheets = faces.map(face => {
      const clone = face.cloneNode(true);
      clone.querySelectorAll("canvas").forEach(canvas => {
        try { const image = document.createElement("img"); image.src = canvas.toDataURL("image/png"); image.alt = "QR de vérification du badge"; canvas.replaceWith(image); } catch { /* Le QR reste dans sa représentation originale si le navigateur bloque la copie. */ }
      });
      clone.querySelectorAll("img").forEach(image => { const src = image.getAttribute("src") || ""; if (src.startsWith("data:") || src.startsWith("blob:")) return; image.src = new URL(src, location.href).href; });
      return `<section class="card-print-sheet">${clone.outerHTML}</section>`;
    }).join("");
    printWindow.document.open();
    printWindow.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Carte étudiante IRGIB AFRICA</title><link rel="stylesheet" href="${stylesUrl}"><style>
      @page{size:A4 portrait;margin:0}*{box-sizing:border-box}html,body{margin:0!important;padding:0!important;width:210mm!important;min-width:210mm!important;background:#fff!important}.card-print-sheet{width:210mm;height:297mm;display:grid;place-items:center;overflow:hidden;break-after:page;page-break-after:always}.card-print-sheet:last-child{break-after:auto;page-break-after:auto}.card-print-sheet .card-v2{width:85.6mm!important;height:53.98mm!important;min-width:85.6mm!important;max-width:85.6mm!important;aspect-ratio:auto!important;margin:0!important;padding:2.2mm 2.4mm!important;border-radius:2mm!important;box-shadow:none!important;overflow:hidden!important;break-inside:avoid!important;page-break-inside:avoid!important;print-color-adjust:exact!important;-webkit-print-color-adjust:exact!important}.card-print-sheet .card-v2-front{break-after:auto!important;page-break-after:auto!important}.card-print-sheet .card-v2.card-back{display:grid!important;break-before:auto!important;page-break-before:auto!important}.card-print-sheet img{print-color-adjust:exact;-webkit-print-color-adjust:exact} @media print{html,body{width:210mm!important;min-width:210mm!important}.card-print-sheet{height:297mm!important;break-after:page!important;page-break-after:always!important}.card-print-sheet:last-child{break-after:auto!important;page-break-after:auto!important}}
      </style></head><body>${sheets}<script>window.addEventListener('load',async()=>{await Promise.all([...document.images].map(i=>i.decode?.().catch(()=>{})));if(document.fonts?.ready)await document.fonts.ready;window.focus();setTimeout(()=>window.print(),150)});window.addEventListener('afterprint',()=>window.close());</script></body></html>`);
    printWindow.document.close();
  });

  byId("back-to-signup").textContent = "Retour à la connexion";
  byId("banned-return-login").addEventListener("click", () => {
    try { localStorage.removeItem("irgib-banned-account-notice"); } catch {}
    blockedAccountNotice = "";
    setScreen("auth-screen");
    showAuthPage("login");
  });
  db.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") {
      hideRepresentativeDailyQr(); representativeHasPin = false; currentUser = null; profile = null; application = null; attendanceRows = []; renderedCardKey = ""; photoSignedUrl = ""; photoSignedPath = ""; photoSignedUntil = 0;
      if (blockedAccountNotice) { setScreen("banned-screen"); byId("banned-account-message").textContent = blockedAccountNotice; }
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
