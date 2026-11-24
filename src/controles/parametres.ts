import type { ColonnesControles } from '../model/types.ts';

const MOTIFS_COLONNES: Record<keyof ColonnesControles, RegExp[]> = {
  debut: [/^start$/, /^debut/],
  fin: [/^end$/, /^fin$/],
  soumission: [/^_submission_time$/, /submission/],
  enqueteur: [/enqueteur|enumerator|volontaire|agent/],
  telephone: [/tel(ephone)?$|phone/, /tel/],
  nom: [/nom.*chef|chef.*nom|head.*name|name.*head/, /^nom/, /name/],
  village: [/village/, /localite|locality/],
  identifiant: [/piece|carte_?(d_?)?(identite|electeur)|cni|national_?id|id_?number|numero_?id/],
};

/** Propose la correspondance des colonnes d'après leur nom (dernier segment des groupes Kobo). */
export function detecterColonnes(colonnes: string[]): ColonnesControles {
  const resultat: ColonnesControles = {};
  const pris = new Set<string>();
  for (const [cle, motifs] of Object.entries(MOTIFS_COLONNES) as [keyof ColonnesControles, RegExp[]][]) {
    for (const motif of motifs) {
      const trouvee = colonnes.find((c) => !pris.has(c) && motif.test((c.split('/').pop() ?? c).toLowerCase()));
      if (trouvee) {
        resultat[cle] = trouvee;
        pris.add(trouvee);
        break;
      }
    }
  }
  return resultat;
}
