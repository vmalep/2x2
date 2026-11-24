/**
 * Construction du DOM sans innerHTML : toutes les valeurs venant des fichiers sont insérées
 * comme texte, ce qui empêche l'injection de code par une cellule piégée.
 */
import { formater, langueCourante, localeCourante, modele, type Cle } from '../i18n/index.ts';

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
    : d.toLocaleString(localeCourante(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/**
 * Texte traduit avec mise en forme : **gras** et `code` deviennent des éléments, et les
 * paramètres peuvent être des nœuds (lien, empreinte…). Les valeurs sont insérées comme texte.
 */
export function tr(cle: Cle, p: Record<string, string | number | Node> = {}): Enfant[] {
  return riche(modele(cle), p);
}

/** Mise en forme d'un texte déjà traduit (voir tr). */
export function riche(modeleTexte: string, p: Record<string, string | number | Node> = {}): Enfant[] {
  const texte: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(p)) if (!(v instanceof Node)) texte[k] = v;
  const morceaux = (bout: string): Enfant[] =>
    bout.split(/(\{\w+\})/).map((m) => {
      const nom = m.match(/^\{(\w+)\}$/)?.[1];
      const v = nom !== undefined ? p[nom] : undefined;
      return v instanceof Node ? v : formater(m, texte, langueCourante());
    });
  return modeleTexte
    .split(/(\*\*.+?\*\*|`[^`]+`)/)
    .filter(Boolean)
    .flatMap((m): Enfant[] => {
      if (m.startsWith('**') && m.endsWith('**') && m.length > 4) return [h('strong', null, morceaux(m.slice(2, -2)))];
      if (m.startsWith('`') && m.endsWith('`') && m.length > 2) return [h('code', null, morceaux(m.slice(1, -1)))];
      return morceaux(m);
    });
}
