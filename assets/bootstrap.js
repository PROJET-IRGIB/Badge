(() => {
  const loader = document.currentScript;
  const entry = loader?.dataset.entry;
  const target = loader?.dataset.errorTarget;
  const showError = message => {
    const node = target && document.getElementById(target);
    if (node) node.textContent = message;
  };
  fetch("/api/config", { headers: { Accept: "application/json" }, cache: "no-store" })
    .then(response => {
      if (!response.ok) throw new Error("configuration");
      return response.json();
    })
    .then(config => {
      if (!config.url || !config.anonKey) throw new Error("configuration");
      if (!window.supabase?.createClient) throw new Error("sdk");
      window.IRGIB_SUPABASE_CONFIG = Object.freeze(config);
      const script = document.createElement("script");
      script.src = entry;
      script.onerror = () => showError("Le module de l’espace n’a pas pu se charger. Rechargez la page.");
      document.body.append(script);
    })
    .catch(() => showError("Le service est momentanément indisponible. Vérifiez votre connexion puis rechargez la page."));
})();
