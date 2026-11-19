import type { ColonnesControles, Parametres } from '../model/types.ts';

export const LIBELLES_COLONNES: Record<keyof ColonnesControles, string> = {
  debut: 'Début de l’entretien',
  fin: 'Fin de l’entretien',
  soumission: 'Heure de soumission',
  enqueteur: 'Enquêteur',
  telephone: 'Téléphone',
  nom: 'Nom du chef de ménage',
  village: 'Village',
  enfantNonAccompagne: 'Enfant non accompagné',
  ageChef: 'Âge du chef de ménage',
};

const MOTIFS_COLONNES: Record<keyof ColonnesControles, RegExp[]> = {
  debut: [/^start$/, /^debut/],
  fin: [/^end$/, /^fin$/],
  soumission: [/^_submission_time$/, /submission/],
  enqueteur: [/enqueteur|enumerator|volontaire|agent/],
  telephone: [/tel(ephone)?$|phone/, /tel/],
  nom: [/nom.*chef|chef.*nom|head.*name|name.*head/, /^nom/, /name/],
  village: [/village/, /localite|locality/],
  enfantNonAccompagne: [/non_?accompagn|unaccompanied|^ena$/],
  ageChef: [/(^|_)age_(du_)?chef|chef(_menage)?_age$|head.*_age$/, /^age(_|$)/],
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

export function parametresParDefaut(colonnes: string[]): Parametres {
  return {
    colonnes: detecterColonnes(colonnes),
    seuilDureeMinutes: 6,
    dureeMaxHeures: 3,
    partCourtsEnqueteur: 0.2,
    minEntretiensEnqueteur: 5,
    distanceNoms: 2,
  };
}
