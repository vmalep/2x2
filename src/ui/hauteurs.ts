/**
 * Hauteurs d'éléments collants (en-tête de page, barre de décision) publiées en variables CSS,
 * pour que les éléments collants suivants se placent juste en dessous.
 */
const observes = new Map<string, ResizeObserver>();

export function suivreHauteur(el: HTMLElement, variable: string) {
  observes.get(variable)?.disconnect();
  const publier = () => document.documentElement.style.setProperty(variable, `${el.getBoundingClientRect().height}px`);
  const o = new ResizeObserver(publier);
  o.observe(el);
  observes.set(variable, o);
  requestAnimationFrame(publier);
}
