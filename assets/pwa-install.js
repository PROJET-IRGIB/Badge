(() => {
  if ("serviceWorker" in navigator) {
    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloadingForUpdate = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController || reloadingForUpdate) return;
      reloadingForUpdate = true;
      window.location.reload();
    });
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).then(registration => {
      const checkForUpdate = () => { if (document.visibilityState === "visible") void registration.update().catch(() => {}); };
      checkForUpdate();
      document.addEventListener("visibilitychange", checkForUpdate);
      window.setInterval(checkForUpdate, 30 * 60 * 1000);
    }).catch(() => {});
  }

  const installMarkerKey = "irgib-student-app-installed-v1";
  const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  const hasInstallMarker = () => { try { return localStorage.getItem(installMarkerKey) === "yes"; } catch { return false; } };
  const saveInstallMarker = () => { try { localStorage.setItem(installMarkerKey, "yes"); } catch {} };
  if (isStandalone()) { saveInstallMarker(); return; }
  if (hasInstallMarker()) return;

  let installPrompt = null;
  let installed = false;
  let dialog = null;
  let status = null;
  let installButton = null;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    installPrompt = event;
    if (dialog) updateDialog();
  });
  window.addEventListener("appinstalled", () => {
    installed = true;
    saveInstallMarker();
    if (dialog) dialog.remove();
    document.body.classList.remove("pwa-install-locked");
    document.querySelectorAll("body > :not(.pwa-install-overlay)").forEach(node => { node.inert = false; });
  });

  function updateDialog() {
    if (!dialog) return;
    if (ios) {
      status.textContent = "Sur iPhone ou iPad : touchez Partager dans Safari, puis « Sur l’écran d’accueil ». Après l’ajout, ouvrez ESPACE ETUDIANT IRGIB depuis la nouvelle icône.";
      installButton.textContent = "Vérifier l’installation";
    } else if (installPrompt) {
      status.textContent = "Installez ESPACE ETUDIANT IRGIB sur votre appareil pour continuer. L’application apparaîtra ensuite sur votre écran d’accueil ou dans vos applications.";
      installButton.textContent = "Installer l’application";
    } else {
      status.textContent = "L’installation n’est pas proposée par ce navigateur. Ouvrez cette page dans Chrome ou Edge, puis utilisez son menu « Installer l’application ». Après l’installation, ouvrez-la depuis son icône.";
      installButton.textContent = "Vérifier l’installation";
    }
  }

  function showInstallGate() {
    if (installed || isStandalone() || dialog) return;
    document.body.classList.add("pwa-install-locked");
    dialog = document.createElement("section");
    dialog.className = "pwa-install-overlay";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "pwa-install-title");
    document.querySelectorAll("body > *").forEach(node => { node.inert = true; });
    dialog.innerHTML = `<div class="pwa-install-card"><img src="/assets/pwa-192-v4.png" alt="Blason IRGIB AFRICA"><div class="eyebrow">Application officielle IRGIB AFRICA</div><h2 id="pwa-install-title">Installez ESPACE ETUDIANT IRGIB</h2><p class="pwa-install-status" aria-live="polite"></p><button class="btn pwa-install-button" type="button"></button><p class="pwa-install-footnote">Votre espace étudiant est disponible depuis cette application.</p></div>`;
    document.body.append(dialog);
    status = dialog.querySelector(".pwa-install-status");
    installButton = dialog.querySelector(".pwa-install-button");
    updateDialog();
    installButton.focus();
    installButton.addEventListener("click", async () => {
      if (isStandalone() || installed) { dialog.remove(); document.body.classList.remove("pwa-install-locked"); return; }
      if (installPrompt) {
        installButton.disabled = true;
        try {
          const promptEvent = installPrompt;
          installPrompt = null;
          await promptEvent.prompt();
          const choice = await promptEvent.userChoice;
          if (choice?.outcome === "accepted") {
            installed = true;
            saveInstallMarker();
            dialog.remove();
            document.body.classList.remove("pwa-install-locked");
            document.querySelectorAll("body > :not(.pwa-install-overlay)").forEach(node => { node.inert = false; });
          } else {
            status.textContent = "L’installation est nécessaire pour accéder à l’espace étudiant. Vous pourrez réessayer depuis ce bouton.";
          }
        } catch {
          status.textContent = "L’installation n’a pas démarré. Utilisez le menu du navigateur pour installer l’application.";
        } finally {
          installButton.disabled = false;
        }
        return;
      }
      if (ios) {
        status.textContent = "Dans Safari, touchez Partager, puis « Sur l’écran d’accueil » et « Ajouter ». Ouvrez ensuite l’application depuis son icône.";
        return;
      }
      status.textContent = "Si vous venez de l’installer, ouvrez l’application depuis son icône. Sinon, installez-la avec le menu de votre navigateur.";
    });
  }

  window.setTimeout(showInstallGate, 15000);
})();
