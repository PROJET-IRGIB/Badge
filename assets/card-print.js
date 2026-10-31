window.addEventListener("load", async () => {
  await Promise.all([...document.images].map(image => image.decode?.().catch(() => {})));
  if (document.fonts?.ready) await document.fonts.ready;
  window.focus();
  window.setTimeout(() => window.print(), 200);
});
window.addEventListener("afterprint", () => window.close());
