/**
 * Copia texto para a área de transferência.
 *
 * `navigator.clipboard` exige contexto seguro (https ou localhost) e a página
 * em foco; aberto por IP na rede, ele nem existe. Aí entra o método legado:
 * um textarea selecionado e `execCommand("copy")`.
 *
 * O textarea nasce **dentro do diálogo aberto**, quando há um. Os diálogos
 * prendem o foco (o link do cliente e o prompt moram em diálogos): um campo
 * fora deles perdia o foco na hora, a seleção sumia e a cópia saía vazia —
 * com o botão dizendo que tinha copiado.
 */
export async function copyToClipboard(text: string) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // segue para o método legado
  }

  const anterior = document.activeElement as HTMLElement | null;
  const dialogo = anterior?.closest<HTMLElement>('[role="dialog"], [role="alertdialog"]');
  const area = document.createElement("textarea");
  try {
    area.value = text;
    area.setAttribute("readonly", "");
    area.setAttribute("aria-hidden", "true");
    area.style.position = "fixed";
    area.style.top = "0";
    area.style.left = "0";
    area.style.opacity = "0";
    area.style.pointerEvents = "none";
    (dialogo ?? document.body).appendChild(area);
    area.focus({ preventScroll: true });
    area.select();
    area.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
    anterior?.focus?.({ preventScroll: true });
  }
}
