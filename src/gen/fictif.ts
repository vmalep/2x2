/**
 * Générateur de données FICTIVES au format d'un export KoboToolbox (en-têtes XML).
 * Tous les noms, villages et numéros sont inventés. Des anomalies sont plantées en
 * proportion connue, et la « vérité » est renvoyée pour tester les contrôles.
 */
import { nomsProches } from '../controles/similarite.ts';
import type { Tableau } from '../io/tableau.ts';

export const COLONNES_KOBO = [
  'start',
  'end',
  'today',
  'enqueteur',
  'territoire',
  'village',
  'id_menage',
  'nom_chef_menage',
  'sexe_chef_menage',
  'age_chef_menage',
  'telephone',
  'statut_menage',
  'taille_menage',
  'nb_enfants_moins_5',
  'enfant_non_accompagne',
  'nb_enfants_non_accompagnes',
  'consentement',
  '_id',
  '_uuid',
  '_submission_time',
  '_index',
  'donnees_fictives',
] as const;

export type Anomalie = 'entretien_court' | 'doublon_telephone' | 'doublon_nom' | 'horodatage_incoherent' | 'enfant_non_accompagne';

export interface OptionsFictif {
  graine?: number;
  menages?: number;
  /** Proportions d'anomalies plantées (part des ménages). */
  proportions?: Partial<Record<Anomalie, number>>;
}

export const PROPORTIONS_PAR_DEFAUT: Record<Anomalie, number> = {
  entretien_court: 0.08,
  doublon_telephone: 0.03,
  doublon_nom: 0.02,
  horodatage_incoherent: 0.02,
  enfant_non_accompagne: 0.04,
};

export interface DonneesFictives {
  tableau: Tableau;
  /** Ménages concernés par chaque anomalie plantée (identifiants MN-xxxx). */
  verite: Record<Anomalie, string[]>;
  /** Enquêteurs à qui ont été attribués la plupart des entretiens courts. */
  enqueteursSuspects: string[];
}

function prng(graine: number) {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VILLAGES: Record<string, string[]> = {
  'Territoire Nord': ['Village N-Rivière', 'Village N-Mission', 'Village N-Plateau', 'Village N-Marché', 'Village N-Colline'],
  'Territoire Sud': ['Village S-Centre', 'Village S-Port', 'Village S-Source', 'Village S-Forêt', 'Village S-Carrefour'],
};
const PRENOMS_F = ['Marie', 'Josée', 'Béatrice', 'Odette', 'Clarisse', 'Nadine', 'Thérèse', 'Agnès', 'Pauline', 'Esther', 'Rachel', 'Germaine'];
const PRENOMS_H = ['Jean', 'Pierre', 'Joseph', 'Paul', 'André', 'Dieudonné', 'Patrice', 'Albert', 'Simon', 'Désiré', 'Marcel', 'Faustin'];
const NOMS = ['Mbala', 'Kiala', 'Nzuzi', 'Makiese', 'Lukombo', 'Kapinga', 'Mbuyi', 'Nsimba', 'Kalonji', 'Mafuta', 'Ngoma', 'Kabeya', 'Lusamba', 'Matondo', 'Kinkela', 'Mavungu'];
const PREFIXES_TEL = ['81', '82', '84', '85', '89', '97', '99'];
const ENQUETEURS = Array.from({ length: 12 }, (_, i) => `ENQ-${String(i + 1).padStart(2, '0')}`);

/** Variante orthographique proche d'un nom (lettre doublée, voyelle changée, inversion). */
function variante(nom: string, alea: () => number): string {
  const choix = Math.floor(alea() * 3);
  if (choix === 0) {
    const i = 1 + Math.floor(alea() * (nom.length - 2));
    return nom.slice(0, i) + nom[i] + nom.slice(i);
  }
  if (choix === 1) return nom.replace(/a(?!.*a)/, 'e').replace(/^([^e]*)$/, '$1a');
  const mots = nom.split(' ');
  return mots.length > 1 ? `${mots[1]} ${mots[0]}` : nom + 'u';
}

function isoKinshasa(ms: number): string {
  // Heure locale fictive UTC+1, au format des exports Kobo.
  const d = new Date(ms + 3600_000);
  return d.toISOString().replace('Z', '+01:00');
}

export function genererDonneesFictives(options: OptionsFictif = {}): DonneesFictives {
  const alea = prng(options.graine ?? 2026);
  const n = options.menages ?? 300;
  const proportions = { ...PROPORTIONS_PAR_DEFAUT, ...options.proportions };
  const tirer = <T,>(t: readonly T[]) => t[Math.floor(alea() * t.length)];
  const entier = (min: number, max: number) => min + Math.floor(alea() * (max - min + 1));
  const uuid = () =>
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.floor(alea() * 16);
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });

  // Attribution des anomalies à des ménages distincts, en nombre exact.
  const indices = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(alea() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const verite: Record<Anomalie, string[]> = {
    entretien_court: [],
    doublon_telephone: [],
    doublon_nom: [],
    horodatage_incoherent: [],
    enfant_non_accompagne: [],
  };
  const plan = new Map<number, Anomalie>();
  let curseur = 0;
  for (const a of Object.keys(verite) as Anomalie[]) {
    let nombre = Math.round(n * proportions[a]);
    // Les doublons se plantent par paires : le nombre est pair.
    if (a === 'doublon_telephone' || a === 'doublon_nom') nombre -= nombre % 2;
    for (let k = 0; k < nombre && curseur < n; k++) plan.set(indices[curseur++], a);
  }

  const suspects = ['ENQ-07', 'ENQ-11'];
  const lignes: string[][] = [];
  // Noms déjà tirés par village : on évite les homonymes accidentels, seuls les doublons plantés doivent exister.
  const nomsParVillage = new Map<string, string[]>();
  const debutCollecte = Date.UTC(2026, 8, 8, 6, 0, 0); // 8 septembre 2026, 07:00 heure locale

  for (let i = 0; i < n; i++) {
    const id = `MN-${String(i + 1).padStart(4, '0')}`;
    const anomalie = plan.get(i);
    const territoire = alea() < 0.55 ? 'Territoire Nord' : 'Territoire Sud';
    const village = tirer(VILLAGES[territoire]);
    const sexe = alea() < 0.58 ? 'femme' : 'homme';
    let nom = '';
    const dejaVus = nomsParVillage.get(village) ?? [];
    for (let essai = 0; essai < 50; essai++) {
      nom = `${tirer(NOMS)} ${tirer(sexe === 'femme' ? PRENOMS_F : PRENOMS_H)}`;
      if (!dejaVus.some((autre) => nomsProches(nom, autre, 2))) break;
    }
    nomsParVillage.set(village, [...dejaVus, nom]);
    const jour = entier(0, 12);
    const debut = debutCollecte + jour * 86_400_000 + entier(0, 9 * 60) * 60_000 + entier(0, 59) * 1000;
    const court = anomalie === 'entretien_court';
    const enqueteur = court && alea() < 0.75 ? tirer(suspects) : tirer(ENQUETEURS);
    const duree = (court ? entier(90, 340) : entier(12 * 60, 35 * 60)) * 1000;
    let fin = debut + duree;
    let soumission = fin + entier(10, 600) * 60_000;
    if (anomalie === 'horodatage_incoherent') {
      const cas = entier(0, 2);
      if (cas === 0) fin = debut - entier(5, 60) * 60_000; // fin avant le début
      else if (cas === 1) soumission = debut - entier(1, 48) * 3_600_000; // soumission avant l'entretien
      else fin = debut + entier(3, 9) * 86_400_000; // entretien de plusieurs jours
    }
    const taille = entier(1, 11);
    const moins5 = Math.min(taille - 1, entier(0, 3));
    const ena = anomalie === 'enfant_non_accompagne';
    lignes.push([
      isoKinshasa(debut),
      isoKinshasa(fin),
      isoKinshasa(debut).slice(0, 10),
      enqueteur,
      territoire,
      village,
      id,
      nom,
      sexe,
      String(ena && alea() < 0.5 ? entier(14, 17) : entier(18, 75)),
      `+243${tirer(PREFIXES_TEL)}${String(entier(0, 9_999_999)).padStart(7, '0')}`,
      alea() < 0.6 ? 'deplace' : 'famille_accueil',
      String(taille),
      String(moins5),
      ena ? 'oui' : 'non',
      ena ? String(entier(1, 3)) : '0',
      'oui',
      String(480_000 + i * 7 + entier(0, 6)),
      uuid(),
      new Date(soumission).toISOString().slice(0, 19),
      String(i + 1),
      'OUI',
    ]);
    if (anomalie) verite[anomalie].push(id);
  }

  // Les doublons : le second ménage de chaque paire reprend le téléphone ou le nom (proche) du premier, dans le même village.
  const col = (c: (typeof COLONNES_KOBO)[number]) => COLONNES_KOBO.indexOf(c);
  for (const [a, champ] of [['doublon_telephone', 'telephone'], ['doublon_nom', 'nom_chef_menage']] as const) {
    const ids = verite[a];
    for (let k = 0; k + 1 < ids.length; k += 2) {
      const l1 = lignes[Number(ids[k].slice(3)) - 1];
      const l2 = lignes[Number(ids[k + 1].slice(3)) - 1];
      l2[col(champ)] = champ === 'telephone' ? l1[col(champ)] : variante(l1[col(champ)], alea);
      if (champ === 'nom_chef_menage') {
        l2[col('village')] = l1[col('village')];
        l2[col('territoire')] = l1[col('territoire')];
      }
    }
  }

  for (const a of Object.keys(verite) as Anomalie[]) verite[a].sort();
  return { tableau: { colonnes: [...COLONNES_KOBO], lignes }, verite, enqueteursSuspects: suspects };
}
