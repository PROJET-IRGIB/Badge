(() => {
  document.querySelectorAll('input[type="password"]').forEach(input => {
    if (input.dataset.passwordVisibility === "ready") return;
    input.dataset.passwordVisibility = "ready";
    const wrap = document.createElement("span");
    wrap.className = "password-visibility-wrap";
    input.parentNode.insertBefore(wrap, input);
    wrap.append(input);
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "password-visibility-toggle";
    toggle.textContent = "Afficher";
    toggle.setAttribute("aria-label", "Afficher le mot de passe");
    toggle.setAttribute("aria-pressed", "false");
    wrap.append(toggle);
    toggle.addEventListener("click", () => {
      const visible = input.type === "password";
      input.type = visible ? "text" : "password";
      toggle.textContent = visible ? "Masquer" : "Afficher";
      toggle.setAttribute("aria-label", `${visible ? "Masquer" : "Afficher"} le mot de passe`);
      toggle.setAttribute("aria-pressed", String(visible));
      input.focus({ preventScroll: true });
    });
  });
})();
