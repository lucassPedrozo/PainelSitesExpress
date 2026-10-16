/**
 * Pede permissão de notificação. Só funciona dentro de um clique — por isso é
 * chamada ao gerar e ao publicar, os dois momentos em que um aviso depois
 * faz sentido.
 */
export function requestNotificationPermission() {
  try {
    if ("Notification" in window && Notification.permission === "default") {
      void Notification.requestPermission();
    }
  } catch {
    // Navegador sem suporte: o toast e o título da aba continuam avisando.
  }
}
