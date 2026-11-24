/**
 * Formulaire Kobo de revisite et retours du terrain.
 *
 * 1. formulaireRevisite() produit un XLSForm à importer dans KoboToolbox : il lit la pièce jointe
 *    de préchargement (menages_a_revoir.csv, voir visite.ts) et demande ce qui a été constaté.
 * 2. Après la mission, lireRetours() lit l'export des réponses et PROPOSE les actions
 *    correspondantes (corrections, exclusions, décisions d'alerte). Rien n'est appliqué sans
 *    signature : chaque action passe ensuite par le journal et, pour les corrections, par les quatre yeux.
 */
import type { Alerte } from '../controles/controles.ts';
import { distance, formatDistance, lirePoint, pointDepuis } from '../controles/geo.ts';
import type { Tableau } from '../io/tableau.ts';
import type { FeuilleXlsx } from '../io/xlsx.ts';
import { cellule, type Etat } from './journal.ts';
import { CHAMP_STATUT, MOTIFS_EXCLUSION, type Motif } from './types.ts';
import { NOM_PRECHARGEMENT, nomKobo } from './visite.ts';

const FICHIER = NOM_PRECHARGEMENT.replace(/\.csv$/, '');

/** Code Kobo stable pour un motif d'exclusion (« Ménage parti ou dissous » → menage_parti_ou_dissous). */
const codeMotif = (m: string) => nomKobo(m).slice(0, 40);

/**
 * XLSForm du formulaire de revisite. Les champs corrigeables proposés sont les colonnes de
 * l'export d'origine (hors colonnes techniques et identifiant).
 */
export function formulaireRevisite(colonnesCorrigeables: string[]): FeuilleXlsx[] {
  const survey: string[][] = [
    ['start', 'start', '', '', '', ''],
    ['end', 'end', '', '', '', ''],
    ['today', 'today', '', '', '', ''],
    [`select_one_from_file ${NOM_PRECHARGEMENT}`, 'menage', 'Ménage à revoir', 'yes', '', 'autocomplete'],
    ['calculate', 'infos', '', '', '', ''],
    ['calculate', 'a_verifier', '', '', '', ''],
    ['note', 'note_infos', 'Ménage : ${infos}', '', '', ''],
    ['note', 'note_a_verifier', 'À vérifier : ${a_verifier}', '', '', ''],
    ['select_one oui_non', 'trouve', 'Le ménage a-t-il été trouvé ?', 'yes', '', ''],
    ['select_one resultat', 'resultat', 'Résultat de la vérification', 'yes', "${trouve} = 'oui'", ''],
    ['select_one champs', 'champ', 'Champ à corriger', 'yes', "${resultat} = 'donnee_fausse'", 'minimal'],
    ['text', 'valeur', 'Valeur constatée', 'yes', "${resultat} = 'donnee_fausse'", ''],
    ['select_one motif_exclusion', 'motif_exclusion', 'Motif de l’exclusion', 'yes', "${resultat} = 'a_exclure'", ''],
    ['text', 'constat', 'Constat (ce qui a été vu ou dit)', 'yes', '', 'multiline'],
    ['geopoint', 'gps_visite', 'Position de la visite', 'yes', '', ''],
    ['text', 'visiteur', 'Nom de la personne qui visite', 'yes', '', ''],
  ];
  const calculs: Record<string, string> = {
    infos: `pulldata('${FICHIER}', 'infos', 'name', \${menage})`,
    a_verifier: `pulldata('${FICHIER}', 'a_verifier', 'name', \${menage})`,
  };
  const choices: string[][] = [
    ['oui_non', 'oui', 'Oui'],
    ['oui_non', 'non', 'Non (introuvable ou inexistant)'],
    ['resultat', 'conforme', 'Données conformes : pas de problème'],
    ['resultat', 'donnee_fausse', 'Une donnée est fausse (à corriger)'],
    ['resultat', 'a_exclure', 'Le ménage doit être exclu'],
    ...colonnesCorrigeables.map((c) => ['champs', nomKobo(c), c]),
    ...MOTIFS_EXCLUSION.map((m) => ['motif_exclusion', codeMotif(m), m]),
  ];
  return [
    {
      nom: 'survey',
      tableau: {
        colonnes: ['type', 'name', 'label', 'required', 'relevant', 'appearance', 'calculation'],
        lignes: survey.map((l) => [...l, calculs[l[1]] ?? '']),
      },
    },
    { nom: 'choices', tableau: { colonnes: ['list_name', 'name', 'label'], lignes: choices } },
    {
      nom: 'settings',
      tableau: { colonnes: ['form_title', 'form_id', 'version'], lignes: [['Revisite des ménages (2x2)', 'revisite_2x2', new Date().toISOString().slice(0, 10).replace(/-/g, '')]] },
    },
  ];
}

export type NatureAction = 'correction' | 'exclusion' | 'decision';

export interface ActionRetour {
  cle: string;
  menage: string;
  nature: NatureAction;
  resume: string;
  commentaire: string;
  /** Correction ou exclusion. */
  champ?: string;
  ancienne?: string;
  nouvelle?: string;
  motif?: Motif;
  /** Décision d'alerte. */
  alerte?: Alerte;
  decision?: string;
  /** Raison de ne pas l'appliquer sans regarder (visite loin du ménage, valeur inchangée…). */
  avertissement?: string;
  /** Action impossible (déjà exclu, correction déjà en attente…) : affichée, jamais appliquée. */
  impossible?: string;
}

export interface Retours {
  actions: ActionRetour[];
  erreurs: string[];
  reponses: number;
}

/** Distance au-delà de laquelle une visite est jugée loin du ménage (mètres). */
export const DISTANCE_VISITE_MAX = 500;

/**
 * Seul l'export des réponses du formulaire Kobo de revisite se réimporte : choix fermés, contrôlés
 * sur la tablette, visite horodatée et géolocalisée. Une liste de visite remplie à la main dans un
 * tableur (texte libre, valeurs modifiées par le tableur, aucune preuve de visite) est refusée.
 */
/**
 * Export Kobo « avec libellés » (le choix par défaut de Kobo) : les en-têtes sont les libellés des
 * questions et les cellules les libellés des choix. Comme 2x2 a lui-même produit le formulaire, la
 * correspondance libellé → code est connue exactement : on traduit, sans rien deviner. Un libellé
 * inconnu est laissé tel quel (et signalé ensuite comme non reconnu).
 */
function depuisLibelles(t: Tableau, etat: Etat): Tableau {
  const nom = (c: string) => c.replace(/^.*\//, '');
  if (t.colonnes.some((c) => nom(c) === 'menage')) return t;
  const formulaire = formulaireRevisite(etat.original.colonnes.filter((c) => c !== etat.original.colonneId));
  const [survey, choices] = formulaire;
  const parLibelle = new Map<string, string>();
  for (const l of survey.tableau.lignes) if (l[2]) parLibelle.set(l[2], l[1]);
  // Colonnes éclatées d'un point GPS : « _Position de la visite_latitude » → « _gps_visite_latitude ».
  const traduireEntete = (c: string) => {
    const n = nom(c);
    if (parLibelle.has(n)) return parLibelle.get(n)!;
    const m = n.match(/^_(.+)_(latitude|longitude|altitude|precision)$/);
    if (m && parLibelle.has(m[1])) return `_${parLibelle.get(m[1])}_${m[2]}`;
    return c;
  };
  const colonnes = t.colonnes.map(traduireEntete);
  // Codes des choix, par question : libellé → code.
  const listes = new Map<string, Map<string, string>>();
  for (const [liste, code, libelle] of choices.tableau.lignes) {
    if (!listes.has(liste)) listes.set(liste, new Map());
    listes.get(liste)!.set(libelle, code);
  }
  const listeDeQuestion = new Map(survey.tableau.lignes.filter((l) => l[0].startsWith('select_one ')).map((l) => [l[1], l[0].slice('select_one '.length)]));
  const lignes = t.lignes.map((l) =>
    l.map((v, i) => {
      const liste = listeDeQuestion.get(colonnes[i]);
      return liste ? (listes.get(liste)?.get(v.trim()) ?? v) : v;
    }),
  );
  return { colonnes, lignes };
}

export function lireRetours(source: Tableau, etat: Etat, alertes: Alerte[], colonneGps: string): Retours {
  const erreurs: string[] = [];
  const t = depuisLibelles(source, etat);
  const nom = (c: string) => c.replace(/^.*\//, '');
  const indice = (n: string) => t.colonnes.findIndex((c) => nom(c) === n);
  const iMenage = indice('menage');
  if (iMenage < 0) {
    const listeDeVisite = t.colonnes.includes('À vérifier') && t.colonnes.some((c) => c.startsWith('Ménage trouvé'));
    return {
      actions: [],
      erreurs: [
        listeDeVisite
          ? 'Ce fichier est une liste de visite : elle sert sur le terrain mais ne se réimporte pas (texte libre, sans preuve de visite). Saisissez les résultats dans 2x2 (décisions d’alerte, corrections, exclusions), ou utilisez le formulaire Kobo de revisite et importez ici l’export de ses réponses.'
          : 'Fichier non reconnu : importez l’export des réponses du formulaire Kobo de revisite (il contient une colonne « menage »).',
      ],
      reponses: 0,
    };
  }
  const val = (l: string[], n: string) => {
    const i = indice(n);
    return i < 0 ? '' : (l[i] ?? '').trim();
  };
  const colonnesParCode = new Map(etat.original.colonnes.map((c) => [nomKobo(c), c]));
  const motifParCode = new Map(MOTIFS_EXCLUSION.map((m) => [codeMotif(m), m]));
  const alertesParMenage = new Map<string, Alerte[]>();
  for (const a of alertes) for (const m of a.menages) alertesParMenage.set(m, [...(alertesParMenage.get(m) ?? []), a]);

  const actions: ActionRetour[] = [];
  let n = 0;
  t.lignes.forEach((l, i) => {
    const menage = val(l, 'menage');
    if (!menage) return;
    n++;
    const ou = `Réponse ${i + 1} (${menage})`;
    if (!etat.indexMenages.has(menage)) return erreurs.push(`${ou} : ménage inconnu dans cette liste.`);
    const jour = (val(l, 'today') || val(l, 'start')).slice(0, 10);
    const visiteur = val(l, 'visiteur');
    const constat = val(l, 'constat');
    const source = `Visite terrain${jour ? ` du ${jour}` : ''}${visiteur ? ` (${visiteur})` : ''}${constat ? ` : ${constat}` : ''}`;

    // Preuve de visite : la position de la visite doit être proche de celle du ménage.
    let avertissement: string | undefined;
    const pVisite = lirePoint(val(l, 'gps_visite')) ?? pointDepuis((c) => { const k = indice(nom(c)); return k < 0 ? undefined : l[k]; }, 'gps_visite');
    const pMenage = colonneGps ? pointDepuis((c) => etat.valeur(menage, c), colonneGps) : undefined;
    if (!pVisite) avertissement = 'Visite sans position GPS.';
    else if (pMenage) {
      const d = distance(pVisite, pMenage);
      if (d > DISTANCE_VISITE_MAX) avertissement = `Visite enregistrée à ${formatDistance(d)} du ménage.`;
    }

    const aDecider = (alertesParMenage.get(menage) ?? []).filter((a) => {
      const d = etat.decisionsAlertes.get(a.id)?.contenu.decision;
      return !d || d === 'verification_terrain';
    });
    const decisions = (decision: string, pourquoi: string) =>
      aDecider.map((a) => ({
        cle: `${i}:d:${a.id}`,
        menage,
        nature: 'decision' as const,
        resume: `${a.libelle} → ${pourquoi}`,
        commentaire: source,
        alerte: a,
        decision,
        avertissement,
      }));
    const exclusion = (motif: Motif, pourquoi: string): ActionRetour => ({
      cle: `${i}:x`,
      menage,
      nature: 'exclusion',
      resume: `Exclure (${pourquoi})`,
      commentaire: source,
      champ: CHAMP_STATUT,
      ancienne: etat.valeur(menage, CHAMP_STATUT) ?? 'inclus',
      nouvelle: 'exclu',
      motif,
      avertissement,
      impossible: etat.estExclu(menage)
        ? 'Ménage déjà exclu.'
        : etat.enAttenteParCellule.has(cellule(menage, CHAMP_STATUT))
          ? 'Un changement de statut est déjà en attente.'
          : undefined,
    });

    const trouve = val(l, 'trouve');
    const resultat = val(l, 'resultat');
    if (trouve === 'non') {
      actions.push(exclusion('Ménage introuvable ou inexistant', 'introuvable ou inexistant'));
      actions.push(...decisions('confirmee', 'Problème confirmé (ménage introuvable)'));
    } else if (resultat === 'conforme') {
      actions.push(...decisions('faux_positif', 'Vérifiée : pas de problème'));
      if (!aDecider.length) erreurs.push(`${ou} : données conformes, aucune alerte à clore.`);
    } else if (resultat === 'donnee_fausse') {
      const code = val(l, 'champ');
      const champ = colonnesParCode.get(code);
      const nouvelle = val(l, 'valeur');
      if (!champ || champ === etat.original.colonneId) erreurs.push(`${ou} : champ « ${code} » inconnu.`);
      else {
        const ancienne = etat.valeur(menage, champ) ?? '';
        actions.push({
          cle: `${i}:c`,
          menage,
          nature: 'correction',
          resume: `${champ} : « ${ancienne || '(vide)'} » → « ${nouvelle || '(vide)'} »`,
          commentaire: source,
          champ,
          ancienne,
          nouvelle,
          motif: 'Vérification terrain',
          avertissement,
          impossible:
            nouvelle === ancienne
              ? 'Valeur identique à la valeur actuelle.'
              : etat.enAttenteParCellule.has(cellule(menage, champ))
                ? 'Une correction est déjà en attente pour ce champ.'
                : undefined,
        });
        actions.push(...decisions('confirmee', 'Problème confirmé (donnée corrigée)'));
      }
    } else if (resultat === 'a_exclure') {
      const motif = motifParCode.get(val(l, 'motif_exclusion')) ?? 'Autre (préciser en commentaire)';
      actions.push(exclusion(motif, motif.toLowerCase()));
      actions.push(...decisions('confirmee', 'Problème confirmé (ménage exclu)'));
    } else {
      erreurs.push(`${ou} : résultat non renseigné.`);
    }
  });
  return { actions, erreurs, reponses: n };
}
