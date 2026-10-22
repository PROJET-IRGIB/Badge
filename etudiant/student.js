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
  let application = null;
  let attendanceRows = [];
  let studentChannel = null;
  let selectedPhoto = "";
  let selectedPhotoName = "";
  let selectedPhotoBlob = null;
  let scannedSession = "";
  let cameraStream = null;
  let scanFrame = 0;
  let lastScanTime = 0;

  const getApplication = () => application;
  const fromProfileRow = row => row && ({ userId: row.user_id, firstName: row.first_name, lastName: row.last_name, email: row.email, phone: row.phone, sex: row.sex, program: row.program, level: row.level, site: row.site, birthDate: row.birth_date });
  const fromApplicationRow = row => row && ({ id: row.id, studentId: row.student_id, firstName: row.first_name, lastName: row.last_name, email: row.email, phone: row.phone, sex: row.sex, birthDate: row.birth_date, program: row.program, level: row.level, site: row.site, status: row.status, temporaryMatricule: row.temporary_matricule, finalMatricule: row.final_matricule, photoPath: row.photo_path, rejectionReason: row.rejection_reason, submittedAt: row.submitted_at, decidedAt: row.decided_at });
  async function loadStudentData() {
    const { data: profileRow, error: profileError } = await db.from("student_profiles").select("*").eq("user_id", currentUser.id).single();
    if (profileError) throw profileError;
    profile = fromProfileRow(profileRow);
    const { data: apps, error: appError } = await db.from("badge_applications").select("*").eq("student_id", currentUser.id).order("submitted_at", { ascending: false }).limit(1);
    if (appError) throw appError;
    application = fromApplicationRow(apps?.[0]);
    if (application?.photoPath) {
      const { data } = await db.storage.from("student-photos").createSignedUrl(application.photoPath, 600);
      application.photo = data?.signedUrl || "";
    }
    const { data: records, error: attendanceError } = await db.from("attendance_records").select("attended_at,session_id,attendance_sessions!inner(site,program,level)").eq("student_id", currentUser.id).order("attended_at", { ascending: false });
    if (attendanceError) throw attendanceError;
    attendanceRows = (records || []).map(row => ({ createdAt: row.attended_at, sessionCode: row.session_id.slice(0, 8), site: row.attendance_sessions.site, program: row.attendance_sessions.program, level: row.attendance_sessions.level, day: row.attended_at.slice(0, 10) }));
  }
  const showAuthPage = page => {
    const login = page === "login";
    byId("login-panel").style.display = login ? "block" : "none";
    byId("signup-panel").style.display = login ? "none" : "block";
    byId("show-login").classList.toggle("active", login);
    byId("show-signup").classList.toggle("active", !login);
    byId("auth-title").textContent = login ? "Connexion" : "Inscription";
    byId("auth-intro").textContent = login ? "Connectez-vous avec l’adresse e-mail et le mot de passe utilisés lors de votre inscription." : "Créez votre compte étudiant en renseignant vos informations et en confirmant votre adresse e-mail.";
    byId("login-message").textContent = "";
    byId("signup-message").textContent = "";
  };
  const setScreen = screen => {
    ["auth-screen", "verify-screen", "portal-screen"].forEach(id => byId(id).style.display = id === screen ? "block" : "none");
    byId("signout").style.display = screen === "portal-screen" ? "inline-flex" : "none";
  };
  const selectStudentView = view => {
    document.querySelectorAll(".student-view").forEach(section => section.classList.toggle("active", section.id === `student-view-${view}`));
    document.querySelectorAll(".student-tabs [data-student-view]").forEach(button => button.classList.toggle("active", button.dataset.studentView === view));
    if (view === "attendance") { renderAttendance(); }
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
    const qrPayload = `IRGIB-CARTE:${app.finalMatricule}`;
    byId("student-card-zone").innerHTML = D.cardHtml(app, "card-qr");
    const qrHost = byId("card-qr");
    if (window.QRCode && app.finalMatricule) new QRCode(qrHost, { text: qrPayload, width: 128, height: 128, colorDark: "#102a39", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M });
    else qrHost.innerHTML = `<div class="qr-fallback">${app.finalMatricule ? "QR indisponible" : "QR après approbation"}</div>`;
  }

  function renderMyCard() {
    const app = getApplication();
    const status = byId("my-card-status");
    const zone = byId("student-card-zone");
    const actions = byId("card-print-actions");
    if (!app || app.status !== "approved") {
      zone.style.display = "none";
      actions.style.display = "none";
      status.innerHTML = app ? `<div class="pending-card"><span class="status ${app.status === "rejected" ? "rejected" : "pending"}">${app.status === "rejected" ? "Demande rejetée" : "En attente d’approbation"}</span><h3>${app.status === "rejected" ? "Votre carte n’est pas encore disponible." : "La carte apparaîtra après validation."}</h3><p>Matricule temporaire : <b>${esc(app.temporaryMatricule)}</b></p><p class="small muted">Le matricule définitif et le QR de la carte sont créés après approbation.</p></div>` : `<div class="pending-card"><h3>Envoyez d’abord votre demande de badge.</h3><p class="small muted">Un matricule temporaire sera créé à l’envoi. La carte et son QR seront disponibles après approbation.</p></div>`;
      return;
    }
    status.innerHTML = `<div class="notice" style="margin-bottom:14px"><strong>Carte approuvée.</strong> Matricule définitif : ${esc(app.finalMatricule)}. Le QR du recto contient un identifiant de carte, sans nom ni données personnelles.</div>`;
    zone.style.display = "grid";
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
    byId("my-attendance-rows").innerHTML = rows.length ? rows.map(item => `<tr><td>${new Date(item.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</td><td>${esc(item.sessionCode)}</td><td>${esc(D.getProgram(item.program).shortName)} · ${esc(item.level)}</td><td>${esc(D.getSite(item.site).city)}</td><td><span class="status active">Présent</span></td></tr>`).join("") : `<tr><td colspan="5" class="table-empty">Aucune présence validée aujourd’hui.</td></tr>`;
    if (scannedSession) showAttendancePreview(scannedSession, app);
  }
  function showAttendancePreview(code, app = getApplication()) {
    scannedSession = code;
    byId("session-code").value = code;
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
    if (error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError") return "L’accès à la caméra est refusé. Autorisez la caméra pour ce site dans les réglages du navigateur, puis réessayez.";
    if (error?.name === "NotFoundError" || error?.name === "DevicesNotFoundError") return "Aucune caméra n’a été détectée sur cet appareil.";
    if (error?.name === "NotReadableError" || error?.name === "TrackStartError") return "La caméra est utilisée par une autre application. Fermez cette application puis réessayez.";
    if (error?.name === "SecurityError" || !window.isSecureContext) return "La caméra exige une connexion sécurisée HTTPS. Ouvrez le site avec son adresse https://.";
    return "La caméra n’a pas pu démarrer. Vérifiez les autorisations et réessayez, ou saisissez le code manuellement.";
  }
  async function startCamera() {
    byId("attendance-message").textContent = "";
    if (!navigator.mediaDevices?.getUserMedia) {
      byId("attendance-message").textContent = window.isSecureContext
        ? "Ce navigateur ne permet pas d’ouvrir la caméra. Essayez un navigateur récent ou saisissez le code de séance manuellement."
        : cameraErrorMessage({ name: "SecurityError" });
      return;
    }
    if (!("BarcodeDetector" in window) && typeof window.jsQR !== "function") {
      byId("attendance-message").textContent = "Le lecteur QR n’a pas pu se charger. Vérifiez votre connexion, puis saisissez le code de séance manuellement.";
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
      byId("attendance-message").textContent = cameraErrorMessage(error);
      stopCamera();
    }
  }

  async function activatePortal() {
    if (!currentUser) { setScreen("auth-screen"); return; }
    try { await loadStudentData(); }
    catch (error) { setScreen("auth-screen"); byId("login-message").textContent = error.message || "Impossible de charger votre dossier. Réessayez."; return; }
    setScreen("portal-screen");
    if (!studentChannel) studentChannel = db.channel(`student-${currentUser.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "badge_applications", filter: `student_id=eq.${currentUser.id}` }, async () => {
        try { await loadStudentData(); if (application) applicationSummary(application); renderNotification(application); renderMyCard(); }
        catch { byId("login-message").textContent = "La mise à jour de votre dossier est temporairement indisponible."; }
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
    } catch { byId("login-message").textContent = "Connexion impossible. Vérifiez vos identifiants et confirmez votre e-mail."; }
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
      const { data, error } = await db.auth.signUp({ email: draft.email, password, options: { emailRedirectTo: `${window.location.origin}/etudiant/`, data: { account_type: "student", first_name: draft.firstName, last_name: draft.lastName, phone: draft.phone, sex: draft.sex, program: draft.program, level: draft.level, site: draft.site } } });
      if (error) throw error;
      if (data.session) { currentUser = data.user; byId("signup-form").reset(); await activatePortal(); }
      else {
        byId("demo-code-note").textContent = `Un message de confirmation a été envoyé à ${draft.email}. Ouvrez-le pour activer votre compte, puis revenez vous connecter.`;
        setScreen("verify-screen");
      }
    } catch (error) { byId("signup-message").textContent = error.message || "Création du compte impossible. Vérifiez les informations puis réessayez."; }
    finally { button.disabled = false; }
  });
  byId("verify-form").addEventListener("submit", event => event.preventDefault());
  byId("back-to-signup").addEventListener("click", () => { setScreen("auth-screen"); showAuthPage("login"); });
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
    if (studentChannel) { await db.removeChannel(studentChannel); studentChannel = null; }
    await db.auth.signOut();
    currentUser = null; profile = null; application = null; attendanceRows = [];
    profile = null;
    setScreen("auth-screen");
    showAuthPage("login");
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
  byId("start-scan").addEventListener("click", startCamera);
  byId("stop-scan").addEventListener("click", stopCamera);
  byId("load-session").addEventListener("click", () => {
    try { showAttendancePreview(decodeSession(byId("session-code").value)); byId("attendance-message").textContent = "Séance chargée. Vérifiez vos informations avant validation."; }
    catch (error) { byId("attendance-message").textContent = error.message; }
  });
  byId("submit-attendance").addEventListener("click", async () => {
    if (!scannedSession) return;
    const button = byId("submit-attendance"); button.disabled = true;
    byId("attendance-message").textContent = "Enregistrement sécurisé de votre présence…";
    const { error } = await db.rpc("submit_attendance", { p_token: scannedSession });
    if (error) {
      byId("attendance-message").textContent = /déjà enregistrée/i.test(error.message) ? "Votre présence à cette séance est déjà enregistrée." : error.message || "Présence non enregistrée. Vérifiez que le QR est actif et correspond à votre groupe.";
      button.disabled = false;
      return;
    }
    byId("attendance-message").textContent = "Présence enregistrée dans la liste du jour.";
    await loadStudentData();
    scannedSession = "";
    byId("attendance-preview").innerHTML = `<div class="muted small">Votre présence est enregistrée. Scannez le prochain QR de séance si nécessaire.</div>`;
    renderAttendance();
    button.disabled = true;
  });
  byId("print-my-card").addEventListener("click", () => {
    document.body.classList.add("print-card-mode");
    window.print();
    setTimeout(() => document.body.classList.remove("print-card-mode"), 900);
  });

  byId("back-to-signup").textContent = "Retour à la connexion";
  db.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") { currentUser = null; profile = null; application = null; attendanceRows = []; setScreen("auth-screen"); showAuthPage("login"); }
    else if (event === "SIGNED_IN" && session?.user && !currentUser) { currentUser = session.user; void activatePortal(); }
  });
  db.auth.getSession().then(({ data, error }) => {
    if (error) throw error;
    currentUser = data.session?.user || null;
    if (currentUser) void activatePortal(); else setScreen("auth-screen");
  }).catch(() => { setScreen("auth-screen"); byId("login-message").textContent = "Connexion au service impossible. Rechargez la page ou contactez l’administration."; });
  window.setInterval(async () => {
    if (!currentUser || byId("portal-screen").style.display === "none") return;
    try { await loadStudentData(); if (application) applicationSummary(application); renderNotification(application); renderMyCard(); }
    catch { /* a short network interruption does not invalidate the signed-in session */ }
  }, 30000);
})();
