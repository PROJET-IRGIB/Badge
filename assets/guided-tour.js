(() => {
  const KEYS = { student: "irgib-tour-student-v3", admin: "irgib-tour-admin-v3" };
  const pendingScope = { student: null, admin: null };
  const activeStorageKey = { student: null, admin: null };
  const tours = {
    student: [
      { title: "Bienvenue dans votre espace", text: "Ce guide vous présente les outils essentiels. Utilisez Précédent et Suivant pour avancer, ou Quitter pour le fermer. Vous pourrez le relancer avec le bouton Guide.", target: ".topbar .brand" },
      { view: "card", title: "Votre carte étudiante", text: "Retrouvez votre carte validée ici. Le bouton Télécharger prépare un PDF propre avec le recto et le verso, prêt pour l’impression.", target: "#student-card-zone" },
      { view: "news", title: "Actualités du campus", text: "Consultez les informations publiées par l’administration de votre site, ainsi que les annonces destinées à tous les campus.", target: "#news-list" },
      { view: "attendance", title: "Présences", text: "Scannez le QR de séance présenté par votre responsable, vérifiez les informations reconnues, puis validez. Votre appel du jour apparaît sous le scanner.", target: "#start-scan" },
      { view: "attendance", title: "Pointage de secours du responsable", text: "Si vous êtes responsable, vous pouvez consulter le QR quotidien de votre groupe après saisie de votre code PIN. Vous pouvez aussi aider un étudiant absent en le sélectionnant puis en scannant son badge.", target: "#rep-attendance-panel", optional: true },
      { view: "request", title: "Demande de badge", text: "Renseignez vos informations et envoyez une photo conforme aux consignes. Après l’envoi, l’administration examine séparément votre demande de badge.", target: "#student-view-request" },
      { view: "profile", title: "Profil et sécurité", text: "Vérifiez les renseignements de votre compte. Dans Sécurité du compte, vous pouvez changer votre mot de passe en vérifiant d’abord l’ancien.", target: "#profile-details" },
    ],
    admin: [
      { view: "dashboard", title: "Vue d’ensemble", text: "Le tableau de bord résume les nouveaux comptes à examiner, les demandes de badge, les cartes approuvées et les présences du jour.", target: "#dashboard-stats" },
      { view: "requests", title: "Demandes de badge", text: "Examinez les dossiers en attente, contrôlez les renseignements et la photo, puis approuvez ou rejetez la demande avec un motif lorsque c’est nécessaire.", target: "#request-rows" },
      { view: "accounts", title: "Comptes étudiants", text: "Confirmez que le compte appartient bien à un étudiant de votre site. Vous pouvez aussi refuser, bannir, rétablir ou supprimer un compte selon son statut.", target: "#account-rows" },
      { view: "students", title: "Registre des étudiants", text: "Retrouvez les étudiants actifs de votre site. Recherchez par nom ou matricule, filtrez par filière et niveau, modifiez les informations et exportez la liste.", target: "#student-search" },
      { view: "attendance", title: "Suivi des présences", text: "Consultez les présents et les absents du jour. Filtrez par filière, niveau ou statut, recherchez un étudiant et exportez le registre.", target: "#attendance-board" },
      { view: "groups", title: "Groupes", text: "Les groupes réunissent les étudiants par site, filière et niveau. Utilisez les filtres pour retrouver un groupe et exporter le catalogue.", target: "#group-rows" },
      { view: "representatives", title: "Responsables de classe", text: "Choisissez une filière et un niveau pour désigner ou gérer les responsables. Leur accès de pointage est limité à leur groupe.", target: "#representative-manager" },
      { view: "announcements", title: "Actualités", text: "Publiez une annonce avec texte et média pour votre site ou tous les sites. Vous pourrez ensuite l’archiver ou la supprimer.", target: "#announcement-form" },
      { view: "cards", title: "Cartes et impression", text: "Recherchez les cartes approuvées, sélectionnez uniquement les étudiants concernés, puis téléchargez le PDF recto-verso destiné à l’impression.", target: "#card-rows" },
    ],
  };

  let overlay;
  let current = null;
  const $ = (selector, root = document) => root.querySelector(selector);
  const visible = element => Boolean(element && element.getClientRects().length && getComputedStyle(element).visibility !== "hidden");

  function makeOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.className = "guided-tour";
    overlay.hidden = true;
    overlay.innerHTML = '<div class="guided-tour-shade" data-tour-exit></div><div class="guided-tour-spotlight" aria-hidden="true"></div><section class="guided-tour-card" role="dialog" aria-modal="true" aria-labelledby="guided-tour-title" aria-describedby="guided-tour-text"><div class="guided-tour-count"></div><button class="guided-tour-close" type="button" aria-label="Quitter le guide">×</button><h2 id="guided-tour-title"></h2><p id="guided-tour-text"></p><div class="guided-tour-controls"><button class="btn secondary sm" type="button" data-tour-prev>Précédent</button><span class="guided-tour-progress"></span><button class="btn sm" type="button" data-tour-next>Suivant</button></div><button class="guided-tour-exit" type="button" data-tour-exit>Quitter le guide</button></section>';
    document.body.append(overlay);
    overlay.querySelectorAll("[data-tour-exit]").forEach(button => button.addEventListener("click", finish));
    $("[data-tour-prev]", overlay).addEventListener("click", () => showStep(current.index - 1));
    $("[data-tour-next]", overlay).addEventListener("click", () => current.index === current.steps.length - 1 ? finish() : showStep(current.index + 1));
    document.addEventListener("keydown", event => { if (current && event.key === "Escape") finish(); });
    window.addEventListener("resize", placeCard);
    window.addEventListener("scroll", placeCard, true);
    return overlay;
  }

  function stepTarget(step) {
    if (step.view === "attendance" && step.target === "#start-scan") return $("#start-scan") || $("#attendance-preview");
    if (step.target === "#student-card-zone" && !visible($(step.target))) return $("#my-card-status") || $("#student-card-tab");
    return $(step.target);
  }

  function showStep(index) {
    if (!current) return;
    current.direction = index < current.index ? -1 : 1;
    while (index >= 0 && index < current.steps.length) {
      const step = current.steps[index];
      if (step.view) {
        if (current.kind === "student") $(`[data-student-view="${step.view}"]`)?.click();
        else $(`.side-nav [data-view="${step.view}"]`)?.click();
      }
      const target = stepTarget(step);
      if (target && visible(target)) break;
      index += current.direction || 1;
    }
    if (index < 0 || index >= current.steps.length) return finish();
    current.index = index;
    const step = current.steps[index];
    const target = stepTarget(step);
    if (!target || !visible(target)) return finish();
    target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    const el = makeOverlay();
    el.hidden = false;
    el.querySelector(".guided-tour-count").textContent = `${current.index + 1} / ${current.steps.length}`;
    el.querySelector("#guided-tour-title").textContent = step.title;
    el.querySelector("#guided-tour-text").textContent = step.text;
    el.querySelector(".guided-tour-progress").textContent = `Étape ${current.index + 1} sur ${current.steps.length}`;
    el.querySelector("[data-tour-prev]").disabled = current.index === 0;
    el.querySelector("[data-tour-next]").textContent = current.index === current.steps.length - 1 ? "Terminer" : "Suivant";
    current.target = target;
    requestAnimationFrame(placeCard);
  }

  function placeCard() {
    if (!current || !overlay || overlay.hidden || !current.target) return;
    const target = current.target.getBoundingClientRect();
    const spotlight = overlay.querySelector(".guided-tour-spotlight");
    const card = overlay.querySelector(".guided-tour-card");
    const pad = 7;
    spotlight.style.left = `${Math.max(6, target.left - pad)}px`;
    spotlight.style.top = `${Math.max(6, target.top - pad)}px`;
    spotlight.style.width = `${Math.min(innerWidth - 12, target.width + pad * 2)}px`;
    spotlight.style.height = `${Math.min(innerHeight - 12, target.height + pad * 2)}px`;
    const width = Math.min(380, innerWidth - 28);
    card.style.width = `${width}px`;
    const cardHeight = card.offsetHeight || 260;
    const below = target.bottom + 16;
    const top = below + cardHeight < innerHeight - 12 ? below : Math.max(12, target.top - cardHeight - 16);
    const left = Math.max(14, Math.min(innerWidth - width - 14, target.left + target.width / 2 - width / 2));
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }

  function finish() {
    if (!current) return;
    try { if (current.storageKey) localStorage.setItem(current.storageKey, "done"); } catch { /* Tour remains dismissible in this session. */ }
    if (overlay) overlay.hidden = true;
    current = null;
  }

  function start(kind, force = false, storageKey = activeStorageKey[kind]) {
    if (!tours[kind]) return;
    if (!force) {
      try { if (storageKey && localStorage.getItem(storageKey) === "done") return; } catch { /* Continue without persistent storage. */ }
    }
    current = { kind, steps: tours[kind], index: 0, direction: 1, storageKey };
    showStep(0);
  }

  function authenticated(kind, userId, site) {
    if (!tours[kind]) return;
    const scope = `${String(site || "global").trim().toLowerCase()}|${String(userId || "unknown").trim().toLowerCase()}`;
    const storageKey = `${KEYS[kind]}:${encodeURIComponent(scope)}`;
    activeStorageKey[kind] = storageKey;
    try {
      if (localStorage.getItem(storageKey) === "done") return;
    } catch { /* Une indisponibilité du stockage ne doit pas bloquer la connexion. */ }
    pendingScope[kind] = storageKey;
    launchIfPending(kind);
  }

  function launchIfPending(kind) {
    const root = kind === "student" ? "#portal-screen" : "#admin-app";
    if (!visible($(root))) return false;
    const storageKey = pendingScope[kind];
    if (storageKey) {
      pendingScope[kind] = null;
      start(kind, false, storageKey);
    }
    return true;
  }

  function addGuideButton(kind) {
    const id = kind === "student" ? "student-tour-button" : "admin-tour-button";
    if ($(`#${id}`)) return;
    const button = document.createElement("button");
    button.id = id;
    button.type = "button";
    button.className = "btn secondary sm guided-tour-launch";
    button.textContent = "Guide de visite";
    button.setAttribute("aria-label", "Lancer ou relancer le guide de visite");
    button.addEventListener("click", () => start(kind, true, activeStorageKey[kind]));
    const host = kind === "student" ? $(".top-actions") : $(".admin-top .profile");
    host?.prepend(button);
  }

  function observe(kind, selector) {
    const launch = () => {
      if (!visible($(selector))) return;
      addGuideButton(kind);
      launchIfPending(kind);
      return true;
    };
    if (launch()) return;
    const observer = new MutationObserver(() => { if (launch()) observer.disconnect(); });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "hidden"] });
  }

  observe("student", "#portal-screen");
  observe("admin", "#admin-app");
  window.IRGIBGuidedTour = { authenticated };
})();
