import type { RepositorySuggestion } from "./publish-target";

/**
 * Por que este repositório foi sugerido — só o palpite pede conferência.
 *
 * A mesma nota no diálogo de publicação e na tela de Deploy: antes a tela
 * avisava num toast, que sumia em segundos, e a pessoa ficava sem saber se o
 * repositório selecionado era certeza ou chute.
 */
export function SuggestionNote({
  suggestion,
  lovableName,
}: {
  suggestion: RepositorySuggestion;
  lovableName: string | null;
}) {
  const texto = {
    bound: "Confirmado para este site na publicação anterior.",
    published: "É o repositório que já publicou este domínio.",
    "lovable-name": `Tem o nome do projeto no Lovable${lovableName ? ` (“${lovableName}”)` : ""}.`,
    guess: "Palpite pelo nome da coleta — confira antes de publicar.",
  }[suggestion.reason];
  return (
    <p className={suggestion.reason === "guess" ? "text-xs text-warning" : "text-xs text-muted-foreground"}>
      {texto}
    </p>
  );
}
