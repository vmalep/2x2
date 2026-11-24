/**
 * Traduction des textes affichés (français, anglais).
 *
 * Les textes sont rangés par clé dans deux dictionnaires (fr.ts, en.ts). Le dictionnaire
 * anglais est typé d'après le français : une clé manquante ou en trop empêche la compilation.
 *
 * Syntaxe des textes :
 * - `{nom}` est remplacé par le paramètre « nom » ;
 * - `{n|singulier|pluriel}` choisit une forme selon le nombre n (règles du français ou de l'anglais) ;
 * - `**gras**` et `` `code` `` sont mis en forme par tr() (interface) et ignorés par t().
 *
 * Seuls les textes d'interface sont traduits. Les données signées du journal (motifs, codes de
 * décision, libellés des règles importées, commentaires) gardent leur valeur d'origine.
 */
import { en } from './en.ts';
import { fr } from './fr.ts';

export type Langue = 'fr' | 'en';
export type Cle = keyof typeof fr;
export type Params = Record<string, string | number>;

export const LANGUES: Langue[] = ['fr', 'en'];
export const NOMS_LANGUES: Record<Langue, string> = { fr: 'Français', en: 'English' };
export const DICTIONNAIRES: Record<Langue, Record<Cle, string>> = { fr, en };

let langue: Langue = 'fr';

export function langueCourante(): Langue {
  return langue;
}

export function definirLangue(l: Langue) {
  langue = l;
}

/** Locale des dates et des nombres. */
export function localeCourante(l: Langue = langue): string {
  return l === 'fr' ? 'fr-BE' : 'en-GB';
}

/** Singulier ? En français 0 et 1 le sont, en anglais seulement 1. */
export function singulier(n: number, l: Langue = langue): boolean {
  return l === 'fr' ? Math.abs(n) < 2 : Math.abs(n) === 1;
}

const PARAMETRE = /\{(\w+)(?:\|([^|}]*)\|([^}]*))?\}/g;

/** Remplace les paramètres d'un modèle (sans mise en forme). */
export function formater(modele: string, p: Params = {}, l: Langue = langue): string {
  return modele.replace(PARAMETRE, (tout, nom: string, un?: string, plusieurs?: string) => {
    const v = p[nom];
    if (v === undefined) return tout;
    if (un !== undefined) return singulier(Number(v), l) ? un : (plusieurs ?? '');
    return String(v);
  });
}

/** Texte traduit dans la langue choisie, mise en forme (** et `) retirée. */
export function t(cle: Cle, p?: Params): string {
  return tl(langue, cle, p);
}

/** Texte traduit dans une langue donnée. */
export function tl(l: Langue, cle: Cle, p?: Params): string {
  return formater(sansMiseEnForme(DICTIONNAIRES[l][cle] ?? DICTIONNAIRES.fr[cle] ?? cle), p, l);
}

/** Modèle brut (avec ** et `), pour une mise en forme par l'interface. */
export function modele(cle: Cle, l: Langue = langue): string {
  return DICTIONNAIRES[l][cle] ?? DICTIONNAIRES.fr[cle] ?? cle;
}

export function sansMiseEnForme(texte: string): string {
  return texte.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');
}

/**
 * Objet dont chaque propriété est lue dans la langue courante au moment de l'accès :
 * les tables de libellés (rôles, décisions…) restent utilisables comme des objets ordinaires.
 */
export function libelles<K extends string>(cles: Record<K, Cle>): Record<K, string> {
  const o = {} as Record<K, string>;
  for (const [k, cle] of Object.entries(cles) as [K, Cle][]) {
    Object.defineProperty(o, k, { get: () => t(cle), enumerable: true });
  }
  return o;
}

/** Langue de départ : choix mémorisé, sinon langue du navigateur (français, ou anglais à défaut). */
export function langueInitiale(memorisee: string | null | undefined, navigateur: readonly string[]): Langue {
  if (memorisee === 'fr' || memorisee === 'en') return memorisee;
  for (const n of navigateur) {
    const code = n.toLowerCase().slice(0, 2);
    if (code === 'fr' || code === 'en') return code;
  }
  return navigateur.length ? 'en' : 'fr';
}
