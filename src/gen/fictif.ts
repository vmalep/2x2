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
  'numero_piece_identite',
  'statut_menage',
  'id_menage_hote',
  'ids_menages_heberges',
  'taille_menage',
  'nb_enfants_moins_5',
  'consentement',
  'gps',
  '_gps_latitude',
  '_gps_longitude',
  '_gps_altitude',
  '_gps_precision',
  '_id',
  '_uuid',
  '_submission_time',
  '_index',
  'donnees_fictives',
] as const;

export type Anomalie =
  | 'entretien_court'
  | 'doublon_telephone'
  | 'doublon_nom'
  | 'horodatage_incoherent'
  | 'doublon_identifiant'
  | 'gps_groupe'
  | 'gps_hors_zone';

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
  doublon_identifiant: 0.02,
  gps_groupe: 0.03,
  gps_hors_zone: 0.02,
};

/** Anomalies du lien entre ménage hébergé (déplacé) et ménage hôte (famille d'accueil). */
export type AnomalieLien =
  | 'lien_hote_introuvable'
  | 'lien_hote_non_accueil'
  | 'lien_hote_eloigne'
  | 'heberge_sans_hote'
  | 'hote_sans_heberge'
  /** Pas une anomalie : lien saisi seulement par la famille d'accueil (ne doit PAS être signalé). */
  | 'lien_saisi_par_hote';

export interface DonneesFictives {
  tableau: Tableau;
  /** Ménages concernés par chaque anomalie plantée (identifiants MN-xxxx). */
  verite: Record<Anomalie | AnomalieLien, string[]>;
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

function isoHeureLocale(ms: number): string {
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
  const verite: Record<Anomalie | AnomalieLien, string[]> = {
    lien_hote_introuvable: [],
    lien_hote_non_accueil: [],
    lien_hote_eloigne: [],
    heberge_sans_hote: [],
    hote_sans_heberge: [],
    lien_saisi_par_hote: [],
    entretien_court: [],
    doublon_telephone: [],
    doublon_nom: [],
    horodatage_incoherent: [],
    doublon_identifiant: [],
    gps_groupe: [],
    gps_hors_zone: [],
  };
  const plan = new Map<number, Anomalie>();
  let curseur = 0;
  for (const a of Object.keys(PROPORTIONS_PAR_DEFAUT) as Anomalie[]) {
    let nombre = Math.round(n * proportions[a]);
    // Les doublons se plantent par paires : le nombre est pair.
    if (a === 'doublon_telephone' || a === 'doublon_nom' || a === 'doublon_identifiant') nombre -= nombre % 2;
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
    lignes.push([
      isoHeureLocale(debut),
      isoHeureLocale(fin),
      isoHeureLocale(debut).slice(0, 10),
      enqueteur,
      territoire,
      village,
      id,
      nom,
      sexe,
      String(entier(18, 75)),
      `+243${tirer(PREFIXES_TEL)}${String(entier(0, 9_999_999)).padStart(7, '0')}`,
      // Pièce d'identité : absente pour environ 15 % des ménages, numéros uniques sinon.
      anomalie !== 'doublon_identifiant' && alea() < 0.15 ? '' : `ID-${String(10_000_000 + i * 37).padStart(8, '0')}`,
      alea() < 0.6 ? 'deplace' : 'famille_accueil',
      '', // id_menage_hote : rempli plus bas (tirage séparé)
      '', // ids_menages_heberges : idem (lien saisi du côté de la famille d'accueil)
      String(taille),
      String(moins5),
      'oui',
      '', // gps : rempli plus bas (tirage séparé, pour ne pas changer les autres données)
      '',
      '',
      '',
      '',
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
  for (const [a, champ] of [['doublon_telephone', 'telephone'], ['doublon_nom', 'nom_chef_menage'], ['doublon_identifiant', 'numero_piece_identite']] as const) {
    const ids = verite[a];
    for (let k = 0; k + 1 < ids.length; k += 2) {
      const l1 = lignes[Number(ids[k].slice(3)) - 1];
      const l2 = lignes[Number(ids[k + 1].slice(3)) - 1];
      // Pour la pièce d'identité, une saisie un peu différente (espace) du même numéro.
      l2[col(champ)] =
        champ === 'nom_chef_menage' ? variante(l1[col(champ)], alea) : champ === 'numero_piece_identite' ? l1[col(champ)].replace('-', ' ') : l1[col(champ)];
      if (champ === 'nom_chef_menage') {
        l2[col('village')] = l1[col('village')];
        l2[col('territoire')] = l1[col('territoire')];
      }
    }
  }

  placerGps(lignes, verite, options.graine ?? 2026);

  placerLiens(lignes, verite, options.graine ?? 2026);

  for (const a of Object.keys(verite) as (Anomalie | AnomalieLien)[]) verite[a].sort();
  return { tableau: { colonnes: [...COLONNES_KOBO], lignes }, verite, enqueteursSuspects: suspects };
}

/** Centres fictifs des villages (zone inventée), espacés de plusieurs kilomètres. */
export const CENTRES: Record<string, [number, number]> = {
  'Village N-Rivière': [-4.18, 18.3],
  'Village N-Mission': [-4.16, 18.36],
  'Village N-Plateau': [-4.13, 18.31],
  'Village N-Marché': [-4.2, 18.4],
  'Village N-Colline': [-4.12, 18.42],
  'Village S-Centre': [-4.3, 18.33],
  'Village S-Port': [-4.33, 18.39],
  'Village S-Source': [-4.27, 18.44],
  'Village S-Forêt': [-4.36, 18.3],
  'Village S-Carrefour': [-4.31, 18.48],
};

/**
 * Coordonnées GPS (format Kobo : colonne « gps » et colonnes éclatées). Tirage séparé pour que
 * les autres données restent identiques d'une version à l'autre. Anomalies plantées :
 * - gps_groupe : un enquêteur enregistre plusieurs ménages « différents » au même endroit, le même jour ;
 * - gps_hors_zone : un ménage situé loin de son village déclaré.
 * Environ 2 % des ménages n'ont pas de point (GPS non capté).
 */
function placerGps(lignes: string[][], verite: Record<Anomalie | AnomalieLien, string[]>, graine: number) {
  const alea = prng(graine + 7919);
  const col = (c: (typeof COLONNES_KOBO)[number]) => COLONNES_KOBO.indexOf(c);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - alea())) * Math.cos(2 * Math.PI * alea());
  const groupe = new Set(verite.gps_groupe);
  const horsZone = new Set(verite.gps_hors_zone);
  const ecrire = (l: string[], lat: number, lon: number) => {
    const alt = (320 + alea() * 80).toFixed(1);
    const prec = (3 + alea() * 12).toFixed(1);
    const la = lat.toFixed(6);
    const lo = lon.toFixed(6);
    l[col('gps')] = `${la} ${lo} ${alt} ${prec}`;
    l[col('_gps_latitude')] = la;
    l[col('_gps_longitude')] = lo;
    l[col('_gps_altitude')] = alt;
    l[col('_gps_precision')] = prec;
  };
  // Point de regroupement : près du centre du village du premier ménage du groupe.
  const premier = lignes.find((l) => groupe.has(l[col('id_menage')]));
  const [latG, lonG] = premier ? CENTRES[premier[col('village')]] : [0, 0];
  const jourGroupe = premier ? premier[col('start')] : '';
  let k = 0;
  for (const l of lignes) {
    const id = l[col('id_menage')];
    const [lat0, lon0] = CENTRES[l[col('village')]];
    if (groupe.has(id)) {
      // Même endroit (quelques mètres), même enquêteur, même journée, entretiens à la suite.
      ecrire(l, latG + 0.0003 + gauss() * 0.00004, lonG - 0.0002 + gauss() * 0.00004);
      l[col('enqueteur')] = 'ENQ-04';
      // Les ménages « groupés » se déclarent du village où l'enquêteur s'est installé.
      l[col('village')] = premier![col('village')];
      l[col('territoire')] = premier![col('territoire')];
      const debut = Date.parse(jourGroupe) + k * 35 * 60_000;
      const duree = Date.parse(l[col('end')]) - Date.parse(l[col('start')]);
      const decalage = Date.parse(l[col('_submission_time')] + 'Z') - Date.parse(l[col('end')]);
      const iso = (ms: number) => new Date(ms + 3600_000).toISOString().replace('Z', '+01:00');
      l[col('start')] = iso(debut);
      l[col('end')] = iso(debut + Math.max(duree, 12 * 60_000));
      l[col('today')] = iso(debut).slice(0, 10);
      l[col('_submission_time')] = new Date(debut + Math.max(duree, 12 * 60_000) + Math.max(decalage, 600_000)).toISOString().slice(0, 19);
      k++;
    } else if (horsZone.has(id)) {
      // À 8–15 km du village déclaré.
      const angle = alea() * 2 * Math.PI;
      const km = 8 + alea() * 7;
      ecrire(l, lat0 + (km / 111) * Math.sin(angle), lon0 + (km / 111) * Math.cos(angle));
    } else if (alea() < 0.02) {
      // GPS non capté : cellules vides.
    } else {
      // Dispersion naturelle autour du centre du village (écart-type ~300 m).
      ecrire(l, lat0 + gauss() * 0.0027, lon0 + gauss() * 0.0027);
    }
  }
}

/**
 * Lien ménage hébergé → ménage hôte (colonne id_menage_hote, remplie pour les ménages déplacés).
 * Chaque ménage déplacé désigne une famille d'accueil de son village et vit à 10–40 m d'elle.
 * Anomalies plantées (tirage séparé) : hôte introuvable, hôte qui n'est pas une famille d'accueil,
 * hôte éloigné, ménage déplacé sans hôte ; les familles d'accueil que personne ne désigne sont relevées.
 */
function placerLiens(lignes: string[][], verite: Record<Anomalie | AnomalieLien, string[]>, graine: number) {
  const alea = prng(graine + 104729);
  const col = (c: (typeof COLONNES_KOBO)[number]) => COLONNES_KOBO.indexOf(c);
  const id = (l: string[]) => l[col('id_menage')];
  const melanger = <T,>(t: T[]) => {
    for (let i = t.length - 1; i > 0; i--) {
      const j = Math.floor(alea() * (i + 1));
      [t[i], t[j]] = [t[j], t[i]];
    }
    return t;
  };
  const plantes = new Set(Object.values(verite).flat());
  const anomaliesGps = new Set([...verite.gps_groupe, ...verite.gps_hors_zone]);
  const deplaces = lignes.filter((l) => l[col('statut_menage')] === 'deplace');
  const hotesParVillage = new Map<string, string[][]>();
  for (const l of lignes) if (l[col('statut_menage')] === 'famille_accueil') hotesParVillage.set(l[col('village')], [...(hotesParVillage.get(l[col('village')]) ?? []), l]);
  for (const h of hotesParVillage.values()) melanger(h);

  // Anomalies de lien : parmi les ménages déplacés sans autre anomalie, 3 de chaque.
  const candidats = melanger(deplaces.filter((l) => !plantes.has(id(l))));
  const prendre = (n: number) => candidats.splice(0, n);
  const introuvables = new Set(prendre(3));
  const nonAccueil = new Set(prendre(3));
  // Hôte éloigné : seulement pour des ménages géolocalisés (sinon la distance n'est pas mesurable).
  const eloignes = new Set(candidats.filter((l) => l[col('gps')]).slice(0, 3));
  for (const l of eloignes) candidats.splice(candidats.indexOf(l), 1);
  const sansHote = new Set(prendre(3));

  const tour = new Map<string, number>();
  const parHote = new Map<string, number>();
  const hebergesPar = new Map<string, string[][]>();
  const designes = new Set<string>();
  for (const l of deplaces) {
    const village = l[col('village')];
    if (sansHote.has(l)) {
      verite.heberge_sans_hote.push(id(l));
      continue;
    }
    if (introuvables.has(l)) {
      l[col('id_menage_hote')] = `MN-9${String(Math.floor(alea() * 1000)).padStart(3, '0')}`;
      verite.lien_hote_introuvable.push(id(l));
      continue;
    }
    if (nonAccueil.has(l)) {
      const autre = deplaces.find((x) => x !== l && x[col('village')] === village) ?? deplaces.find((x) => x !== l)!;
      l[col('id_menage_hote')] = id(autre);
      verite.lien_hote_non_accueil.push(id(l));
      continue;
    }
    if (eloignes.has(l)) {
      // Une famille d'accueil d'un autre village (plusieurs kilomètres) ; le ménage reste chez lui.
      const autresVillages = [...hotesParVillage.keys()].filter((v) => v !== village);
      const choix = hotesParVillage.get(autresVillages[Math.floor(alea() * autresVillages.length)])!;
      const h = choix.find((x) => x[col('gps')] && !anomaliesGps.has(id(x))) ?? choix[0];
      l[col('id_menage_hote')] = id(h);
      designes.add(id(h));
      verite.lien_hote_eloigne.push(id(l));
      continue;
    }
    // Cas normal : une famille d'accueil du même village, à tour de rôle ; le ménage vit à 10–40 m d'elle.
    const hotes = hotesParVillage.get(village);
    if (!hotes?.length) continue;
    const k = tour.get(village) ?? 0;
    tour.set(village, k + 1);
    const h = hotes[k % hotes.length];
    l[col('id_menage_hote')] = id(h);
    designes.add(id(h));
    hebergesPar.set(id(h), [...(hebergesPar.get(id(h)) ?? []), l]);
    const [latH, lonH] = (h[col('gps')] || '').split(' ').map(Number);
    if (!anomaliesGps.has(id(l)) && !anomaliesGps.has(id(h)) && l[col('gps')] && Number.isFinite(latH) && h[col('gps')]) {
      // Autour de l'hôte, chaque ménage hébergé a sa place (angles espacés de 60°, 15–35 m) :
      // deux ménages ne se retrouvent jamais à quelques mètres l'un de l'autre.
      const rang = parHote.get(id(h)) ?? 0;
      parHote.set(id(h), rang + 1);
      const metres = 15 + alea() * 20;
      const angle = (rang * Math.PI) / 3 + alea() * 0.4;
      const lat = (latH + (metres / 111_000) * Math.sin(angle)).toFixed(6);
      const lon = (lonH + (metres / 111_000) * Math.cos(angle)).toFixed(6);
      const [, , alt, prec] = l[col('gps')].split(' ');
      l[col('gps')] = `${lat} ${lon} ${alt} ${prec}`;
      l[col('_gps_latitude')] = lat;
      l[col('_gps_longitude')] = lon;
    }
  }
  for (const [, hotes] of hotesParVillage) for (const h of hotes) if (!designes.has(id(h))) verite.hote_sans_heberge.push(id(h));

  // Lien saisi aussi du côté de la famille d'accueil, pour environ un tiers d'entre elles
  // (codes des ménages hébergés, séparés par des espaces, en minuscules ou sans tiret parfois).
  const lignePar = new Map(lignes.map((l) => [id(l), l]));
  const avecRetour = [...hebergesPar.keys()].filter(() => alea() < 0.35);
  for (const hote of avecRetour) {
    const codes = hebergesPar.get(hote)!.map((l) => (alea() < 0.2 ? id(l).toLowerCase().replace('-', '') : id(l)));
    lignePar.get(hote)![col('ids_menages_heberges')] = codes.join(' ');
  }
  // Deux ménages hébergés n'ont pas saisi le code de leur hôte : le lien n'existe que du côté de l'hôte.
  for (const hote of avecRetour.slice(0, 2)) {
    const l = hebergesPar.get(hote)![0];
    l[col('id_menage_hote')] = '';
    verite.lien_saisi_par_hote.push(id(l));
  }
}
