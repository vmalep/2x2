/** Représentation commune d'un tableau importé ou exporté : en-têtes et lignes de texte. */
import { t } from '../i18n/index.ts';
export interface Tableau {
  colonnes: string[];
  lignes: string[][];
}

/** Supprime les lignes entièrement vides et uniformise la largeur des lignes. */
export function normaliser(brut: string[][]): Tableau {
  const lignes = brut.filter((l) => l.some((c) => c.trim() !== ''));
  if (lignes.length === 0) throw new Error(t('err.vide'));
  const colonnes = lignes[0].map((c) => c.trim());
  const largeur = colonnes.length;
  const vides = colonnes.map((c, i) => (c === '' ? i : -1)).filter((i) => i >= 0);
  if (vides.length) throw new Error(t('err.entete_vide', { n: vides[0] + 1 }));
  const doublons = colonnes.filter((c, i) => colonnes.indexOf(c) !== i);
  if (doublons.length) throw new Error(t('err.colonne_double', { colonne: doublons[0] }));
  return {
    colonnes,
    lignes: lignes.slice(1).map((l) => Array.from({ length: largeur }, (_, i) => l[i] ?? '')),
  };
}
