(() => {
  let activeDialog = null;

  function closeDialog(value) {
    if (!activeDialog) return;
    const current = activeDialog;
    activeDialog = null;
    current.dialog.close();
    current.dialog.remove();
    current.resolve(value);
  }

  function openDialog({ title, message, confirmText = "Continuer", cancelText = "Annuler", danger = false, input = null }) {
    if (activeDialog) closeDialog(null);
    const dialog = document.createElement("dialog");
    dialog.className = "app-dialog";
    dialog.setAttribute("aria-labelledby", "app-dialog-title");
    dialog.innerHTML = `<form method="dialog" class="app-dialog-card"><h2 id="app-dialog-title"></h2><p class="app-dialog-message"></p>${input ? `<label class="app-dialog-field"><span></span><textarea rows="3"></textarea></label>` : ""}<div class="app-dialog-actions"><button class="btn secondary app-dialog-cancel" type="button"></button><button class="btn app-dialog-confirm" type="button"></button></div></form>`;
    dialog.querySelector("#app-dialog-title").textContent = title;
    dialog.querySelector(".app-dialog-message").textContent = message;
    const confirm = dialog.querySelector(".app-dialog-confirm");
    const cancel = dialog.querySelector(".app-dialog-cancel");
    confirm.textContent = confirmText;
    cancel.textContent = cancelText;
    if (danger) confirm.classList.add("danger");
    const textarea = dialog.querySelector("textarea");
    if (input) {
      dialog.querySelector(".app-dialog-field span").textContent = input.label;
      textarea.placeholder = input.placeholder || "";
      textarea.maxLength = input.maxLength || 500;
      textarea.value = input.value || "";
    }
    const promise = new Promise(resolve => {
      activeDialog = { dialog, resolve };
    });
    cancel.addEventListener("click", () => closeDialog(null));
    confirm.addEventListener("click", () => closeDialog(input ? textarea.value.trim() : true));
    dialog.addEventListener("cancel", event => { event.preventDefault(); closeDialog(null); });
    dialog.addEventListener("click", event => { if (event.target === dialog) closeDialog(null); });
    document.body.append(dialog);
    dialog.showModal();
    (textarea || cancel).focus();
    return promise;
  }

  function notify(message, type = "success") {
    let toast = document.getElementById("app-notification");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "app-notification";
      toast.className = "app-notification";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      document.body.append(toast);
    }
    toast.dataset.type = type;
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.classList.remove("show"), 4200);
  }

  window.IRGIBDialog = {
    confirm: options => openDialog(options),
    prompt: options => openDialog({ ...options, input: options.input || { label: "Motif (facultatif)", maxLength: 500 } }),
    notify
  };
})();
