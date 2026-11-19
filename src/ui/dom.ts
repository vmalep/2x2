/**
 * Construction du DOM sans innerHTML : toutes les valeurs venant des fichiers sont insérées
 * comme texte, ce qui empêche l'injection de code par une cellule piégée.
 */
export type Enfant = Node | string | number | null | undefined | false | Enfant[];
type Gestionnaire = (evenement: any) => void;
export type Proprietes = Record<string, string | number | boolean | Gestionnaire | null | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Proprietes | null = null, ...enfants: Enfant[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [cle, valeur] of Object.entries(props ?? {})) {
    if (valeur === undefined || valeur === null || valeur === false) continue;
    if (cle.startsWith('on') && typeof valeur === 'function') el.addEventListener(cle.slice(2).toLowerCase(), valeur);
    else if (cle === 'value' || cle === 'checked' || cle === 'disabled' || cle === 'selected') (el as any)[cle] = valeur;
    else if (cle === 'style') throw new Error('Attribut style interdit (CSP) : utiliser une classe.');
    else el.setAttribute(cle === 'className' ? 'class' : cle, valeur === true ? '' : String(valeur));
  }
  ajouter(el, enfants);
  return el;
}

function ajouter(parent: Node, enfants: Enfant[]) {
  for (const e of enfants) {
    if (e === null || e === undefined || e === false) continue;
    if (Array.isArray(e)) ajouter(parent, e);
    else parent.appendChild(e instanceof Node ? e : document.createTextNode(String(e)));
  }
}

export function remplacer(parent: Element, ...enfants: Enfant[]) {
  parent.replaceChildren();
  ajouter(parent, enfants);
}

export function dateLisible(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
