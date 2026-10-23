(() => {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/espace-campus/admin-sw.js", { scope: "/espace-campus/", updateViaCache: "none" }).catch(() => {});
  }
  const button = document.getElementById("admin-install-button");
  const message = document.getElementById("admin-install-message");
  if (!button || !message) return;
  const standalone = () => window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  if (standalone()) button.hidden = true;
  let installEvent = null;
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    installEvent = event;
  });
  window.addEventListener("appinstalled", () => {
    button.hidden = true;
    message.hidden = false;
    message.textContent = "L’espace admin est installé sur cet appareil.";
  });
  button.addEventListener("click", async () => {
    message.hidden = false;
    if (standalone()) {
      button.hidden = true;
      message.textContent = "L’espace admin est déjà installé sur cet appareil.";
      return;
    }
    if (installEvent) {
      try {
        const prompt = installEvent;
        installEvent = null;
        await prompt.prompt();
        const choice = await prompt.userChoice;
        message.textContent = choice?.outcome === "accepted"
          ? "Installation lancée. Ouvrez IRGIB Admin depuis l’icône installée."
          : "Installation annulée. Vous pourrez la lancer plus tard avec ce bouton.";
      } catch {
        message.textContent = "Installation indisponible. Utilisez le menu du navigateur puis « Installer l’application ».";
      }
      return;
    }
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
    message.textContent = isIos
      ? "Dans Safari, touchez Partager puis « Sur l’écran d’accueil »."
      : "Dans le menu de Chrome ou Edge, choisissez « Installer l’application » ou « Installer IRGIB Admin ».";
  });
})();
