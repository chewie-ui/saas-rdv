export function initDialog(path, method, body) {
  const dialog = document.getElementById("dialogWrp");
  return new Promise((resolve) => {
    if (!dialog) return resolve(false);

    dialog.addEventListener("click", async (event) => {
      const btn1 = event.target.closest(".dialog__btn1");
      const dialogIcon = event.target.closest(".dialog__icon");

      // Annulation
      if (dialogIcon || btn1) {
        dialog.remove();
        resolve(false); // On finit la promesse avec false
        return;
      }

      const btn2 = event.target.closest(".dialog__btn2");

      // Confirmation
      if (btn2) {
        try {
          const response = await fetch(path, {
            method: method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

          const data = await response.json();

          if (data.success) {
            dialog.remove();
            resolve(true); // SUCCESS : On renvoie true
          } else {
            resolve(false);
          }
        } catch (err) {
          console.error(err);
          resolve(false);
        }
      }
    });
  });
}
