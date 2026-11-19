/**
 * Contrôles déterministes et repérage protection.
 * Ils portent sur les valeurs actuelles (après corrections acceptées) et produisent des alertes.
 * L'outil signale ; la décision revient toujours à une personne.
 */
import type { Etat } from '../model/journal.ts';
import type { CategorieAlerte, Parametres } from '../model/types.ts';
import { normaliserTelephone, nomsProches } from './similarite.ts';

export type Controle =
  | 'duree_courte'
  | 'horodatage'
  | 'enqueteur_atypique'
  | 'doublon_telephone'
  | 'doublon_nom'
  | 'enfant_non_accompagne'
  | 'chef_mineur';

export const LIBELLES_CONTROLES: Record<Controle, string> = {
  duree_courte: 'Entretien anormalement court',
  horodatage: 'Horodatage incohérent',
  enqueteur_atypique: 'Enquêteur atypique',
  doublon_telephone: 'Téléphone en double',
  doublon_nom: 'Noms proches dans un même village',
  enfant_non_accompagne: 'Enfant non accompagné',
  chef_mineur: 'Chef de ménage mineur',
};

export interface Alerte {
  /** Identifiant stable : il relie l'alerte aux décisions du journal. */
  id: string;
  controle: Controle;
  categorie: CategorieAlerte;
  menages: string[];
  message: string;
}

/** Date ISO ; sans fuseau, elle est lue en UTC (cas de _submission_time chez Kobo). */
export function lireDate(texte: string | undefined): number | undefined {
  if (!texte?.trim()) return undefined;
  const t = texte.trim();
  const avecFuseau = /([zZ]|[+-]\d{2}:?\d{2})$/.test(t) || !/T\d{2}:/.test(t) ? t : `${t}Z`;
  const ms = Date.parse(avecFuseau);
  return Number.isNaN(ms) ? undefined : ms;
}

const OUI = /^(oui|yes|true|vrai|1|o|y)$/i;

function formatDuree(minutes: number): string {
  if (Math.abs(minutes) < 120) return `${Math.round(minutes * 10) / 10} min`;
  return `${Math.round((minutes / 60) * 10) / 10} h`;
}

export function calculerAlertes(etat: Etat, p: Parametres): Alerte[] {
  const o = etat.original;
  const ids = o.lignes.map((l) => l[o.colonnes.indexOf(o.colonneId)]);
  const c = p.colonnes;
  const v = (id: string, col: string | undefined) => (col ? (etat.valeur(id, col) ?? '') : '');
  const alertes: Alerte[] = [];

  // --- Durées et horodatages ---
  const durees = new Map<string, number>();
  if (c.debut && c.fin) {
    for (const id of ids) {
      const debut = lireDate(v(id, c.debut));
      const fin = lireDate(v(id, c.fin));
      const soumission = lireDate(v(id, c.soumission));
      if (debut === undefined || fin === undefined) continue;
      const minutes = (fin - debut) / 60_000;
      durees.set(id, minutes);
      const problemes: string[] = [];
      if (minutes < 0) problemes.push(`fin avant le début (${formatDuree(minutes)})`);
      else if (minutes > p.dureeMaxHeures * 60) problemes.push(`entretien de ${formatDuree(minutes)}`);
      if (soumission !== undefined && soumission < fin) problemes.push('soumission antérieure à la fin de l’entretien');
      if (problemes.length) {
        alertes.push({ id: `horodatage:${id}`, controle: 'horodatage', categorie: 'integrite', menages: [id], message: problemes.join(' ; ') });
      }
      if (minutes >= 0 && minutes < p.seuilDureeMinutes) {
        alertes.push({
          id: `duree_courte:${id}`,
          controle: 'duree_courte',
          categorie: 'integrite',
          menages: [id],
          message: `Entretien de ${formatDuree(minutes)} (seuil : ${p.seuilDureeMinutes} min)`,
        });
      }
    }
  }

  // --- Enquêteurs atypiques : part d'entretiens courts nettement supérieure au seuil ---
  if (c.enqueteur && durees.size) {
    const parEnqueteur = new Map<string, { total: number; courts: string[] }>();
    for (const id of ids) {
      const e = v(id, c.enqueteur).trim();
      const d = durees.get(id);
      if (!e || d === undefined) continue;
      const s = parEnqueteur.get(e) ?? { total: 0, courts: [] };
      s.total++;
      if (d >= 0 && d < p.seuilDureeMinutes) s.courts.push(id);
      parEnqueteur.set(e, s);
    }
    const totalCourts = [...parEnqueteur.values()].reduce((n, s) => n + s.courts.length, 0);
    const totalEntretiens = [...parEnqueteur.values()].reduce((n, s) => n + s.total, 0);
    for (const [e, s] of [...parEnqueteur].sort(([a], [b]) => a.localeCompare(b))) {
      if (s.total < p.minEntretiensEnqueteur || s.courts.length < 2) continue;
      const part = s.courts.length / s.total;
      if (part < p.partCourtsEnqueteur) continue;
      const autres = (totalCourts - s.courts.length) / Math.max(1, totalEntretiens - s.total);
      alertes.push({
        id: `enqueteur_atypique:${e}`,
        controle: 'enqueteur_atypique',
        categorie: 'integrite',
        menages: s.courts,
        message: `${e} : ${s.courts.length} entretiens courts sur ${s.total} (${Math.round(part * 100)} %), contre ${Math.round(autres * 100)} % pour les autres enquêteurs`,
      });
    }
  }

  // --- Doublons de téléphone ---
  if (c.telephone) {
    const groupes = new Map<string, string[]>();
    for (const id of ids) {
      const t = normaliserTelephone(v(id, c.telephone));
      if (t) groupes.set(t, [...(groupes.get(t) ?? []), id]);
    }
    for (const membres of groupes.values()) {
      if (membres.length < 2) continue;
      alertes.push({
        id: `doublon_telephone:${membres.join('+')}`,
        controle: 'doublon_telephone',
        categorie: 'integrite',
        menages: membres,
        message: `${membres.length} ménages partagent le numéro ${v(membres[0], c.telephone)}`,
      });
    }
  }

  // --- Noms proches dans un même village (regroupement par union-find) ---
  if (c.nom) {
    const parVillage = new Map<string, string[]>();
    for (const id of ids) {
      const village = c.village ? v(id, c.village).trim().toLowerCase() : '';
      parVillage.set(village, [...(parVillage.get(village) ?? []), id]);
    }
    for (const membres of parVillage.values()) {
      const parent = new Map(membres.map((m) => [m, m]));
      const racine = (m: string): string => (parent.get(m) === m ? m : racine(parent.get(m)!));
      for (let i = 0; i < membres.length; i++) {
        for (let j = i + 1; j < membres.length; j++) {
          if (nomsProches(v(membres[i], c.nom), v(membres[j], c.nom), p.distanceNoms)) parent.set(racine(membres[j]), racine(membres[i]));
        }
      }
      const groupes = new Map<string, string[]>();
      for (const m of membres) groupes.set(racine(m), [...(groupes.get(racine(m)) ?? []), m]);
      for (const g of groupes.values()) {
        if (g.length < 2) continue;
        alertes.push({
          id: `doublon_nom:${g.join('+')}`,
          controle: 'doublon_nom',
          categorie: 'integrite',
          menages: g,
          message: `Noms proches${c.village ? ` à ${v(g[0], c.village)}` : ''} : ${g.map((m) => `« ${v(m, c.nom)} »`).join(', ')}`,
        });
      }
    }
  }

  // --- Repérage protection : orienter, jamais exclure pour ce motif ---
  for (const id of ids) {
    if (c.enfantNonAccompagne) {
      const valeur = v(id, c.enfantNonAccompagne).trim();
      if (OUI.test(valeur) || (/^\d+$/.test(valeur) && Number(valeur) > 0)) {
        alertes.push({
          id: `enfant_non_accompagne:${id}`,
          controle: 'enfant_non_accompagne',
          categorie: 'protection',
          menages: [id],
          message: 'Enfant non accompagné déclaré : orienter vers les services de protection de l’enfance et de réunification familiale.',
        });
      }
    }
    if (c.ageChef) {
      const age = Number(v(id, c.ageChef));
      if (v(id, c.ageChef).trim() && Number.isFinite(age) && age < 18) {
        alertes.push({
          id: `chef_mineur:${id}`,
          controle: 'chef_mineur',
          categorie: 'protection',
          menages: [id],
          message: `Chef de ménage de ${age} ans : situation de protection à examiner.`,
        });
      }
    }
  }

  return alertes;
}
