import { cellule, corriger, type CorrectionSuivie } from '../../model/journal.ts';
import { relationsLien } from '../../controles/controles.ts';
import { allerValidation } from './validation.ts';
import { CHAMP_STATUT, DECISIONS_ALERTE, MOTIFS_EXCLUSION, libelleMotif, motifsPour, type Motif } from '../../model/types.ts';
import { badge, bouton, encadre } from '../composants.ts';
import { dateLisible, h, remplacer, tr } from '../dom.ts';
import { telecharger } from '../fichiers.ts';
import { colonnesRetour, exporterVisite, NOM_PRECHARGEMENT } from '../../model/visite.ts';
import { detecterColonnes } from '../../controles/parametres.ts';
import { formulaireRevisite, lireRetours, type ActionRetour } from '../../model/retours.ts';
import { lireExport } from '../../io/import.ts';
import { ecrireXlsx } from '../../io/xlsx.ts';
import { deciderAlerte } from '../../model/journal.ts';
import type { FormatExport } from '../../model/export.ts';
import { colonneDate, colonneEnqueteur, colonneGps, colonnesLien, formulaireDecision, horodatageDe, jourEntretien, peutDecider, pointMenage } from './alertes.ts';
import { COULEURS, plan, type PointPlan, type VuePlan } from '../plan.ts';
import { chargerFond, fondCarte, retirerFond } from '../fond.ts';
import { zoneArrondie, zoneEnGeoJson } from '../../io/geojson.ts';
import { choisirFichier } from '../fichiers.ts';
import { choixColonnes } from '../colonnes.ts';
import { ecranComparaison } from './comparaison.ts';
import { alertesCourantes, aller, apresModification, nomAuteur, notifier, occupe, peut, session } from '../session.ts';
import { libelles, t } from '../../i18n/index.ts';

const COLONNES_TECHNIQUES = /^(_|start$|end$|today$|deviceid$|meta\/|formhub\/|donnees_fictives$)/;

function statutMenage(menage: string): 'attente' | 'modifie' | undefined {
  const etat = session.etat!;
  for (const c of etat.enAttente()) if (c.entree.contenu.menage === menage) return 'attente';
  return valeursCorrigees(menage) ? 'modifie' : undefined;
}

/** Vrai si une VALEUR du ménage a été corrigée (le changement de statut inclus/exclu ne compte pas). */
function valeursCorrigees(menage: string): boolean {
  const m = session.etat!.modifications.get(menage);
  return !!m && [...m.keys()].some((champ) => champ !== CHAMP_STATUT);
}

export function historiqueMenage(menage: string): CorrectionSuivie[] {
  return [...session.etat!.corrections.values()].filter((c) => c.entree.contenu.menage === menage).reverse();
}

export function statutCorrection(c: CorrectionSuivie) {
  return c.statut === 'en_attente' ? badge(t('correction.en_attente'), 'attente') : c.statut === 'acceptee' ? badge(t('correction.acceptee'), 'ok') : badge(t('correction.refusee'), 'refus');
}

export function ligneHistorique(c: CorrectionSuivie) {
  const e = c.entree;
  return h(
    'li',
    { class: 'historique' },
    h('div', { class: 'entete-historique' }, h('strong', null, e.contenu.champ === CHAMP_STATUT ? t('correction.statut_menage') : e.contenu.champ), statutCorrection(c), h('span', { class: 'discret' }, t('correction.numero', { n: e.n }))),
    h('div', { class: 'diff' }, h('del', null, e.contenu.ancienne || t('commun.vide')), ' → ', h('ins', null, e.contenu.nouvelle || t('commun.vide'))),
    h('div', { class: 'discret' }, `${libelleMotif(e.contenu.motif)} · ${nomAuteur(e.auteur)} · ${dateLisible(e.le)}`),
    e.contenu.commentaire && h('div', { class: 'commentaire' }, t('commun.guillemets', { texte: e.contenu.commentaire })),
    c.decision &&
      h(
        'div',
        { class: 'discret' },
        t(c.statut === 'acceptee' ? 'correction.acceptee_par' : 'correction.refusee_par', { nom: nomAuteur(c.decision.auteur), date: dateLisible(c.decision.le) }),
        c.decision.contenu.commentaire && t('journal.r_commentaire_alerte', { texte: c.decision.contenu.commentaire }),
      ),
  );
}

/**
 * Formulaire de correction d'un champ (ou du statut du ménage), inséré après `ancre`.
 * Partagé par la fiche ménage et la vue de comparaison.
 */
export function formulaireCorrection(id: string, champ: string, ancre: HTMLElement, surAnnulation: () => void) {
  const { liste, etat } = session;
  const ancienne = etat!.valeur(id, champ) ?? '';
  const statut = champ === CHAMP_STATUT;
  const nouvelle = statut
    ? h('input', { type: 'hidden', value: ancienne === 'exclu' ? 'inclus' : 'exclu' })
    : h('input', { type: 'text', value: ancienne, 'aria-label': t('commun.nouvelle_valeur') });
  const motif = h(
    'select',
    { 'aria-label': t('correction.motif'), required: true },
    h('option', { value: '' }, statut ? (ancienne === 'exclu' ? t('correction.motif_reintegration') : t('correction.motif_exclusion')) : t('correction.motif_obligatoire')),
    motifsPour(champ, ancienne).map((m) => h('option', { value: m }, libelleMotif(m))),
  );
  const commentaire = h('textarea', { rows: 2, placeholder: t('commun.commentaire'), 'aria-label': t('commun.commentaire') });
  const form = h(
    'form',
    {
      class: 'form-correction',
      onsubmit: (e: Event) => {
        e.preventDefault();
        if (!motif.value) return notifier(t('correction.choisir_motif'), 'erreur');
        if (statut && !commentaire.value.trim()) return notifier(t('correction.expliquer'), 'erreur');
        occupe(t('correction.signature'), async () => {
          await corriger(liste!, etat!, session.identite!, {
            menage: id,
            champ,
            ancienne,
            nouvelle: nouvelle.value,
            motif: motif.value as Motif,
            commentaire: commentaire.value.trim(),
          });
          notifier(t('correction.signee'), 'succes');
          await apresModification();
        });
      },
    },
    statut
      ? h(
          'div',
          null,
          h('strong', null, t(ancienne === 'exclu' ? 'correction.proposer_reintegration_de' : 'correction.proposer_exclusion_de', { id })),
          h('div', { class: 'discret' }, t('correction.proposition_validee')),
        )
      : h('div', { class: 'discret' }, tr('correction.valeur_actuelle', { id, champ, valeur: ancienne || t('commun.vide') })),
    nouvelle,
    motif,
    commentaire,
    h(
      'div',
      { class: 'ligne' },
      h('button', { type: 'submit', class: 'bouton principal' }, t('correction.signer')),
      bouton(t('commun.annuler'), surAnnulation),
    ),
  );
  ancre.after(form);
  ancre.querySelectorAll('button').forEach((b) => b.setAttribute('disabled', ''));
  if (statut) motif.focus();
  else {
    nouvelle.focus();
    nouvelle.select();
  }
}

/** Ouvre la vue de comparaison côte à côte de plusieurs ménages (doublons). */
export function comparer(menages: string[], alerte?: string) {
  session.comparaison = { menages, alerte };
  aller('correction');
}

// ---------------------------------------------------------------- Écran Correction

type Valeurs = {
  cle: string;
  titre: string;
  filtre: 'liste' | 'texte';
  valeur: (id: string) => string;
  liste?: (id: string) => string[];
  /** Valeur de tri, si elle diffère de la valeur affichée (date : jour affiché, heure pour trier). */
  tri?: (id: string) => string;
};

const TOUS = '';
const AVEC_ALERTE = '\u0000avec';
const SANS_ALERTE = '\u0000sans';
/** Filtre par décision prise sur les alertes du ménage (« sans » : au moins une alerte sans décision). */
const PAR_DECISION = '\u0000d:';
const LARGEUR_PAGE = 100;

/** Hauteur du tableau (glissée par l'utilisateur) : simple confort, gardée dans ce navigateur. */
const CLE_HAUTEUR = '2x2-hauteur-tableau-menages';
function hauteurInitiale(): number {
  try {
    const n = Number(localStorage.getItem(CLE_HAUTEUR));
    if (n >= 160) return n;
  } catch {
    /* stockage indisponible */
  }
  return Math.round(Math.max(240, window.innerHeight * 0.45));
}
let hauteurTableau = 0;
function appliquerHauteur(px: number) {
  hauteurTableau = Math.max(160, Math.min(Math.round(px), Math.max(260, window.innerHeight - 160)));
  document.documentElement.style.setProperty('--haut-tableau-menages', `${hauteurTableau}px`);
}

/** Filtres, tri, page et sélection : conservés entre deux rendus. */
const vue = {
  recherche: '',
  filtres: {} as Record<string, string>,
  tri: null as { cle: string; sens: 1 | -1 } | null,
  page: 0,
};
const coches = new Set<string>();
const comparateur = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });

export function ecranCorrection() {
  if (session.comparaison) return ecranComparaison();
  const { liste, etat } = session;
  const o = liste!.original;
  const iId = o.colonnes.indexOf(o.colonneId);
  const tous = o.lignes.map((l) => l[iId]);
  const peutCorriger = peut('correction');
  // Cocher sert à l'exclusion en lot (Correction) et à la liste de visite (Responsable).
  const peutCocher = peutCorriger || peut('responsable');
  const colEnq = colonneEnqueteur();
  const colDate = colonneDate();
  if (hauteurTableau === 0) appliquerHauteur(hauteurInitiale());
  else appliquerHauteur(hauteurTableau);

  const alertes = alertesCourantes();
  const alertesParMenage = new Map<string, typeof alertes>();
  for (const a of alertes) for (const m of a.menages) alertesParMenage.set(m, [...(alertesParMenage.get(m) ?? []), a]);
  const libellesAlertes = (id: string) => [...new Set((alertesParMenage.get(id) ?? []).map((a) => a.libelle))];
  /** Décisions des alertes du ménage : code de décision, ou « sans » pour une alerte non décidée. */
  const decisionsMenage = (id: string) => [...new Set((alertesParMenage.get(id) ?? []).map((a) => etat!.decisionsAlertes.get(a.id)?.contenu.decision ?? 'sans'))];
  const LIBELLES_DECISION: Record<string, string> = { sans: t('correction.sans_decision'), ...DECISIONS_ALERTE.integrite };

  const etatsMenage = (id: string): string[] => {
    const r: string[] = [etat!.estExclu(id) ? t('correction.exclu') : t('correction.inclus')];
    const s = statutMenage(id);
    if (s === 'attente') r.push(t('correction.correction_attente'));
    if (valeursCorrigees(id)) r.push(t('correction.corrige'));
    return r;
  };

  const donnees = o.colonnes.filter((c) => c !== o.colonneId && c !== colEnq && c !== colDate && !COLONNES_TECHNIQUES.test(c)).slice(0, 5);
  // Toutes les colonnes possibles ; l'utilisateur choisit lesquelles afficher (« Colonnes… »).
  const possibles: Valeurs[] = [
    { cle: 'id', titre: o.colonneId, filtre: 'texte', valeur: (id) => id },
    ...(colEnq ? [{ cle: 'enq', titre: t('commun.enqueteur'), filtre: 'liste' as const, valeur: (id: string) => etat!.valeur(id, colEnq) ?? '' }] : []),
    ...(colDate ? [{ cle: 'date', titre: t('commun.date'), filtre: 'liste' as const, valeur: jourEntretien, tri: horodatageDe }] : []),
    { cle: 'alertes', titre: t('regles.col_alertes'), filtre: 'liste', valeur: (id) => libellesAlertes(id).join(', '), liste: libellesAlertes },
    { cle: 'etat', titre: t('correction.etat'), filtre: 'liste', valeur: (id) => etatsMenage(id).join(', '), liste: etatsMenage },
    ...o.colonnes.filter((c) => c !== o.colonneId).map((c): Valeurs => ({ cle: `c:${c}`, titre: c, filtre: 'texte', valeur: (id) => etat!.valeur(id, c) ?? '' })),
  ];
  const choixCols = choixColonnes(
    `2x2-colonnes-correction-${o.empreinteFichier}`,
    possibles.map((v) => ({
      cle: v.cle,
      libelle: v.cle === 'id' ? t('correction.identifiant', { titre: v.titre }) : v.titre,
      groupe: v.cle.startsWith('c:') ? t('correction.groupe_export') : t('correction.groupe_reperes'),
      obligatoire: v.cle === 'id',
    })),
    ['id', 'enq', 'date', 'alertes', 'etat', ...donnees.map((c) => `c:${c}`)],
    () => aller('correction'),
  );
  const colonnes: Valeurs[] = choixCols.visibles().map((k) => possibles.find((v) => v.cle === k)!);
  // Un filtre ou un tri sur une colonne masquée ne doit pas agir sans qu'on le voie.
  for (const k of Object.keys(vue.filtres)) if (!colonnes.some((c) => c.cle === k)) delete vue.filtres[k];
  if (vue.tri && !colonnes.some((c) => c.cle === vue.tri!.cle)) vue.tri = null;

  const zoneTable = h('div', { class: 'cadre-menages' });
  const zoneFiche = h('section', { class: 'fiche', 'aria-label': t('correction.fiche') });
  const resume = h('span', { class: 'discret' });
  const pagination = h('div', { class: 'pagination' });

  function menagesFiltres(): string[] {
    const q = vue.recherche.trim().toLowerCase();
    const retenus = tous.filter((id) => {
      for (const c of colonnes) {
        const f = vue.filtres[c.cle];
        if (!f) continue;
        if (c.cle === 'alertes') {
          const l = libellesAlertes(id);
          if (f.startsWith(PAR_DECISION)) {
            if (!decisionsMenage(id).includes(f.slice(PAR_DECISION.length))) return false;
          } else if (f === AVEC_ALERTE ? !l.length : f === SANS_ALERTE ? l.length > 0 : !l.includes(f)) return false;
        } else if (c.liste) {
          if (!c.liste(id).includes(f)) return false;
        } else if (c.filtre === 'liste') {
          if (c.valeur(id) !== f) return false;
        } else if (!c.valeur(id).toLowerCase().includes(f.toLowerCase())) return false;
      }
      return !q || o.colonnes.some((c) => (etat!.valeur(id, c) ?? '').toLowerCase().includes(q));
    });
    const tri = vue.tri;
    if (tri) {
      const col = colonnes.find((c) => c.cle === tri.cle);
      const v = col?.tri ?? col?.valeur;
      if (v) retenus.sort((a, b) => tri.sens * comparateur.compare(v(a), v(b)));
    }
    return retenus;
  }

  // ---- En-têtes : tri et filtres (créés une fois, pour garder la saisie en cours)
  const enTetes = colonnes.map((c) =>
    h('button', {
      type: 'button',
      class: 'tri',
      title: t('commun.trier'),
      onclick: () => {
        vue.tri = vue.tri?.cle !== c.cle ? { cle: c.cle, sens: 1 } : vue.tri.sens === 1 ? { cle: c.cle, sens: -1 } : null;
        dessinerTable();
      },
    }),
  );
  const champsFiltre = colonnes.map((c) => {
    if (c.filtre === 'texte') {
      return h('input', {
        type: 'search',
        placeholder: t('commun.filtrer'),
        'aria-label': t('commun.filtrer_col', { titre: c.titre }),
        value: vue.filtres[c.cle] ?? '',
        oninput: (e: Event) => {
          vue.filtres[c.cle] = (e.target as HTMLInputElement).value;
          vue.page = 0;
          dessinerTable();
        },
      });
    }
    const n = new Map<string, number>();
    for (const id of tous) for (const v of c.liste ? c.liste(id) : [c.valeur(id)]) if (v) n.set(v, (n.get(v) ?? 0) + 1);
    const valeurs = [...n].sort(([a], [b]) => comparateur.compare(a, b));
    const courant = vue.filtres[c.cle] ?? TOUS;
    if (courant && courant !== AVEC_ALERTE && courant !== SANS_ALERTE && !courant.startsWith(PAR_DECISION) && !n.has(courant)) vue.filtres[c.cle] = TOUS;
    const avec = c.cle === 'alertes' ? tous.filter((id) => alertesParMenage.has(id)).length : 0;
    const parDecision = new Map<string, number>();
    if (c.cle === 'alertes') for (const id of tous) for (const d of decisionsMenage(id)) parDecision.set(d, (parDecision.get(d) ?? 0) + 1);
    return h(
      'select',
      {
        'aria-label': t('commun.filtrer_col', { titre: c.titre }),
        onchange: (e: Event) => {
          vue.filtres[c.cle] = (e.target as HTMLSelectElement).value;
          vue.page = 0;
          dessinerTable();
        },
      },
      h('option', { value: TOUS, selected: !vue.filtres[c.cle] }, t('commun.tous')),
      c.cle === 'alertes' && [
        h('option', { value: AVEC_ALERTE, selected: vue.filtres[c.cle] === AVEC_ALERTE }, t('correction.avec_alerte', { n: avec })),
        h('option', { value: SANS_ALERTE, selected: vue.filtres[c.cle] === SANS_ALERTE }, t('correction.sans_alerte_n', { n: tous.length - avec })),
        parDecision.size > 0 &&
          h(
            'optgroup',
            { label: t('correction.par_decision') },
            Object.entries(LIBELLES_DECISION)
              .filter(([d]) => parDecision.has(d))
              .map(([d, l]) => h('option', { value: PAR_DECISION + d, selected: vue.filtres[c.cle] === PAR_DECISION + d }, `${l} (${parDecision.get(d)})`)),
          ),
      ],
      c.cle === 'alertes'
        ? valeurs.length > 0 && h('optgroup', { label: t('correction.par_type') }, valeurs.map(([v, k]) => h('option', { value: v, selected: vue.filtres[c.cle] === v }, `${v} (${k})`)))
        : valeurs.map(([v, k]) => h('option', { value: v, selected: vue.filtres[c.cle] === v }, `${v} (${k})`)),
    );
  });

  // ---- Sélection et exclusion en lot
  const caseTout = h('input', {
    type: 'checkbox',
    'aria-label': t('correction.cocher_tout'),
    title: t('correction.cocher_tout_titre'),
    onchange: (e: Event) => {
      const oui = (e.target as HTMLInputElement).checked;
      for (const id of filtresCourants) oui ? coches.add(id) : coches.delete(id);
      dessinerTable();
    },
  });
  let filtresCourants: string[] = [];
  const cochesValides = () => [...coches].filter((id) => etat!.indexMenages.has(id));
  const barre = peutCorriger ? barreExclusion(cochesValides) : null;
  const aVerifier = (id: string) =>
    (alertesParMenage.get(id) ?? [])
      .map((a) => {
        const d = etat!.decisionsAlertes.get(a.id)?.contenu.decision;
        return `${a.libelle} : ${a.message}${d ? ` [${LIBELLES_DECISION[d] ?? d}]` : ''}`;
      })
      .join(' | ');
  const visite = peut('responsable') ? panneauVisite(cochesValides, aVerifier, colEnq, colDate) : null;
  const decocher = peutCocher ? bouton(t('commun.tout_decocher'), () => (coches.clear(), dessinerTable())) : null;
  const retours = peutCorriger || peutDecider() ? panneauRetours() : null;
  // Le plan prend la place du tableau (même cadre, même barre de séparation) ; la fiche reste en dessous.
  const boutonPlan = colonneGps()
    ? bouton(planOuvert ? t('correction.afficher_liste') : t('correction.plan'), () => {
        planOuvert = !planOuvert;
        zonePlan.hidden = !planOuvert;
        // Avec le plan, le tableau se réduit à ses en-têtes et filtres : on filtre ce que montre le plan.
        zoneTable.classList.toggle('filtres-seuls', planOuvert);
        boutonPlan!.textContent = planOuvert ? t('correction.afficher_liste') : t('correction.plan');
        dessinerTable();
      })
    : null;
  if (planOuvert && colonneGps()) zoneTable.classList.add('filtres-seuls');

  const thead = h(
    'thead',
    null,
    h('tr', null, peutCocher && h('th', { class: 'col-case' }, caseTout), enTetes.map((b) => h('th', null, b))),
    h('tr', { class: 'filtres' }, peutCocher && h('th', { class: 'col-case' }), champsFiltre.map((f) => h('th', null, f))),
  );

  function celluleAlertes(id: string) {
    const liste = alertesParMenage.get(id) ?? [];
    // Une ligne par type d'alerte, avec la décision prise (ou « sans décision »).
    const vues = new Map<string, string[]>();
    for (const a of liste) vues.set(a.libelle, [...(vues.get(a.libelle) ?? []), etat!.decisionsAlertes.get(a.id)?.contenu.decision ?? 'sans']);
    return [...vues].map(([l, ds]) => {
      const uniques = [...new Set(ds)];
      const ouverte = uniques.includes('sans');
      const decision = uniques.length === 1 ? LIBELLES_DECISION[uniques[0]] : t('correction.decisions_diverses');
      return h(
        'div',
        { class: ouverte ? 'alerte-ouverte' : 'alerte-decidee' },
        ouverte ? l : `✓ ${l}`,
        !ouverte && h('span', { class: 'decision-alerte' }, ` · ${decision.toLowerCase()}`),
      );
    });
  }

  function dessinerTable() {
    const ids = menagesFiltres();
    filtresCourants = ids;
    const pages = Math.max(1, Math.ceil(ids.length / LARGEUR_PAGE));
    vue.page = Math.min(vue.page, pages - 1);
    const page = ids.slice(vue.page * LARGEUR_PAGE, (vue.page + 1) * LARGEUR_PAGE);
    colonnes.forEach((c, i) => (enTetes[i].textContent = `${c.titre}${vue.tri?.cle === c.cle ? (vue.tri.sens === 1 ? ' ▲' : ' ▼') : ''}`));
    const n = ids.filter((id) => coches.has(id)).length;
    caseTout.checked = n > 0 && n === ids.length;
    caseTout.indeterminate = n > 0 && n < ids.length;
    remplacer(
      zoneTable,
      h(
        'div',
        { class: 'defilement tableau-menages' },
        h(
          'table',
          { class: 'tableau cliquable menages' },
          thead,
          h(
            'tbody',
            null,
            page.length
              ? page.map((id) =>
                  h(
                    'tr',
                    {
                      class: `${id === session.menageSelectionne ? 'selection' : ''}${coches.has(id) ? ' cochee' : ''}${etat!.estExclu(id) ? ' exclue' : ''}`,
                      tabindex: 0,
                      onclick: () => selectionner(id),
                      onkeydown: (e: KeyboardEvent) => e.key === 'Enter' && selectionner(id),
                    },
                    peutCocher &&
                      h(
                        'td',
                        { class: 'col-case', onclick: (e: Event) => e.stopPropagation() },
                        h('input', {
                          type: 'checkbox',
                          checked: coches.has(id),
                          'aria-label': t('correction.cocher_menage', { id }),
                          onchange: (e: Event) => {
                            (e.target as HTMLInputElement).checked ? coches.add(id) : coches.delete(id);
                            dessinerTable();
                          },
                        }),
                      ),
                    colonnes.map((c) => {
                      if (c.cle === 'alertes') return h('td', { class: 'alertes' }, celluleAlertes(id));
                      if (c.cle === 'etat') {
                        const s = statutMenage(id);
                        return h(
                          'td',
                          { class: 'badges' },
                          etat!.estExclu(id) && badge(t('statut.exclu'), 'refus'),
                          s === 'attente' && badge(t('correction.en_attente'), 'attente'),
                          valeursCorrigees(id) && badge(t('correction.corrige_badge'), 'ok'),
                        );
                      }
                      const champ = c.cle.startsWith('c:') ? c.cle.slice(2) : c.cle === 'enq' ? colEnq : c.cle === 'date' ? colDate : '';
                      return h('td', { class: `${c.cle === 'date' ? 'date' : ''}${champ && etat!.modifications.get(id)?.has(champ) ? ' modifie' : ''}`, title: c.cle === 'date' ? horodatageDe(id) : undefined }, c.valeur(id));
                    }),
                  ),
                )
              : h('tr', null, h('td', { colspan: colonnes.length + 1, class: 'vide' }, t('correction.aucun_menage'))),
          ),
        ),
      ),
    );
    resume.textContent = t('correction.resume', { n: ids.length, total: tous.length }) + (coches.size ? t('correction.resume_coches', { n: coches.size }) : '');
    remplacer(
      pagination,
      bouton('‹', () => {
        vue.page--;
        dessinerTable();
      }, 'secondaire', vue.page === 0),
      h('span', null, t('correction.page', { n: vue.page + 1, total: pages })),
      bouton('›', () => {
        vue.page++;
        dessinerTable();
      }, 'secondaire', vue.page >= pages - 1),
    );
    barre?.maj();
    visite?.maj();
    dessinerPlan(ids);
    decocher?.toggleAttribute('disabled', coches.size === 0);
  }

  function selectionner(id: string) {
    session.menageSelectionne = id;
    dessinerTable();
    dessinerFiche();
  }

  // ---- Plan GPS des ménages filtrés
  const colGps = colonneGps();
  const zonePlan = h('div', { class: 'zone-plan', hidden: !planOuvert || !colGps });
  function dessinerPlan(ids: string[]) {
    if (!planOuvert || !colGps) return;
    const retenus = ids.slice(0, MAX_POINTS_PLAN);
    const categories = new Map<string, string>();
    const couleurDe = (cat: string) => {
      if (!categories.has(cat)) categories.set(cat, COULEURS[categories.size % COULEURS.length]);
      return categories.get(cat)!;
    };
    // Catégories triées pour des couleurs stables.
    if (modeCouleurPlan !== 'alertes') {
      const valeurs = [...new Set(retenus.map((id) => (modeCouleurPlan === 'enqueteur' ? (colEnq ? (etat!.valeur(id, colEnq) ?? '') : '') : jourEntretien(id)) || t('commun.vide')))].sort(comparateur.compare);
      valeurs.forEach(couleurDe);
    }
    const ETATS_PLAN: Record<string, [string, string]> = {
      ouverte: ['#a35a00', t('validation.alerte_sans_decision')],
      decidee: ['#6b6b6b', t('correction.alerte_decidee')],
      aucune: ['#0f5f73', t('correction.sans_alerte')],
      exclu: ['#c0182b', t('correction.exclu')],
    };
    const points: PointPlan[] = [];
    let sansPoint = 0;
    for (const id of retenus) {
      const p = pointMenage(id, colGps);
      if (!p) {
        sansPoint++;
        continue;
      }
      let couleur: string;
      if (modeCouleurPlan === 'alertes') {
        const d = decisionsMenage(id);
        const e = etat!.estExclu(id) ? 'exclu' : d.includes('sans') ? 'ouverte' : d.length ? 'decidee' : 'aucune';
        couleur = ETATS_PLAN[e][0];
      } else {
        couleur = couleurDe((modeCouleurPlan === 'enqueteur' ? (colEnq ? (etat!.valeur(id, colEnq) ?? '') : '') : jourEntretien(id)) || t('commun.vide'));
      }
      points.push({
        id,
        point: p,
        liens: rel ? [...(rel.hotesDe.get(id) ?? [])].map((m) => pointMenage(m, colGps)).filter((x): x is NonNullable<typeof x> => !!x) : undefined,
        couleur,
        enAvant: coches.has(id) || id === session.menageSelectionne,
        infobulle: [id, colEnq && etat!.valeur(id, colEnq), jourEntretien(id), libellesAlertes(id).join(', ')].filter(Boolean).join(' · '),
      });
    }
    const cle = `${modeCouleurPlan}|${retenus.join(',')}`;
    const legende =
      modeCouleurPlan === 'alertes'
        ? Object.values(ETATS_PLAN)
        : [...categories].slice(0, 14).map(([cat, c]): [string, string] => [c, cat]);
    const fond = fondCarte();
    remplacer(
      zonePlan,
      h(
        'div',
        { class: 'ligne commandes-zone-plan' },
        h(
          'select',
          {
            'aria-label': t('correction.couleur_points'),
            onchange: (e: Event) => {
              modeCouleurPlan = (e.target as HTMLSelectElement).value as typeof modeCouleurPlan;
              dessinerPlan(filtresCourants);
            },
          },
          h('option', { value: 'alertes', selected: modeCouleurPlan === 'alertes' }, t('correction.couleur_alertes')),
          colEnq && h('option', { value: 'enqueteur', selected: modeCouleurPlan === 'enqueteur' }, t('correction.couleur_enqueteur')),
          colDate && h('option', { value: 'date', selected: modeCouleurPlan === 'date' }, t('correction.couleur_jour')),
        ),
        h(
          'span',
          { class: 'discret' },
          t('correction.sur_plan', { n: points.length }) + (sansPoint ? t('correction.sans_coordonnees', { n: sansPoint }) : '') + (ids.length > MAX_POINTS_PLAN ? t('correction.limite', { n: MAX_POINTS_PLAN }) : ''),
        ),
        h('span', { class: 'espace' }),
        bouton(t('correction.zone_fond'), () => {
          // Emprise de TOUS les ménages géolocalisés, élargie et arrondie : elle ne révèle que la région.
          const pts = tous.map((id) => pointMenage(id, colGps)).filter((x): x is NonNullable<typeof x> => !!x);
          if (!pts.length) return notifier(t('correction.aucune_coordonnee'), 'erreur');
          const z = zoneArrondie(pts);
          telecharger('zone_fond_de_carte.geojson', zoneEnGeoJson(z), 'application/geo+json');
          const lat = (x: number) => `${Math.abs(x)}° ${x < 0 ? 'S' : 'N'}`;
          const lon = (x: number) => `${Math.abs(x)}° ${x < 0 ? t('correction.ouest') : 'E'}`;
          notifier(t('correction.zone_telechargee', { ouest: lon(z.ouest), est: lon(z.est), sud: lat(z.sud), nord: lat(z.nord) }), 'succes');
        }),
        fond
          ? [
              h(
                'span',
                { class: 'discret', title: fond.vecteur ? t('correction.fond_vecteur') : t('correction.niveaux_zoom', { zooms: fond.zooms.join(', ') }) },
                t(fond.vecteur ? 'correction.fond_elements' : 'correction.fond_tuiles', { nom: fond.nom, n: fond.nombre }),
              ),
              bouton(t('correction.retirer_fond'), () => (retirerFond(), dessinerPlan(filtresCourants))),
            ]
          : bouton(t('correction.charger_fond'), async () => {
              const f = await choisirFichier('.zip,.geojson,.json,application/zip,application/geo+json');
              if (!f) return;
              await occupe(t('correction.lecture_fond'), async () => {
                const c = await chargerFond(f.nom, f.octets as Uint8Array<ArrayBuffer>);
                notifier(
                  c.vecteur
                    ? t('correction.fond_charge_vecteur', { n: c.nombre })
                    : t('correction.fond_charge_tuiles', { n: c.nombre, de: c.zooms[0], a: c.zooms.at(-1) ?? '' }),
                  'succes',
                );
                dessinerPlan(filtresCourants);
              });
            }),
      ),
      plan(points, {
        hauteur: 380,
        surClic: (id) => {
          selectionner(id);
          zoneFiche.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        },
        vue: vuePlan?.cle === cle ? vuePlan.vue : undefined,
        surVue: (v) => (vuePlan = { cle, vue: v }),
      }),
      h('div', { class: 'legende-plan' }, legende.map(([c, l]) => h('span', null, h('i', { class: 'pastille-couleur', 'data-couleur': c }), l))),
      h('p', { class: 'aide' }, t('correction.aide_plan'), colLien ? t('correction.aide_liens', { colonne: colLien }) : ''),
    );
    // Couleurs de la légende : appliquées par le DOM (pas d'attribut style, interdit par la politique de sécurité).
    zonePlan.querySelectorAll<HTMLElement>('.pastille-couleur').forEach((el) => el.style.setProperty('--c', el.dataset.couleur!));
  }

  function ligneStatut(id: string) {
    const exclu = etat!.estExclu(id);
    const attente = etat!.enAttenteParCellule.has(cellule(id, CHAMP_STATUT));
    const ligne = h(
      'div',
      { class: `statut-menage${exclu ? ' exclu' : ''}` },
      h('span', null, tr(exclu ? 'correction.statut_exclu' : 'correction.statut_inclus')),
      attente && badge(t('correction.changement_attente'), 'attente'),
      peutCorriger && !attente && bouton(exclu ? t('correction.proposer_reintegration') : t('correction.proposer_exclusion'), () => formulaireCorrection(id, CHAMP_STATUT, ligne, dessinerFiche)),
    );
    return ligne;
  }

  /** Lien entre ménages (ex. ménage hébergé ↔ ménage hôte), saisi d'un côté ou de l'autre. */
  const { aller: colLien, retour: colLienRetour } = colonnesLien();
  const rel = colLien ? relationsLien(etat!, colLien, colLienRetour) : undefined;
  function blocLiens(id: string) {
    if (!rel) return null;
    const hotes = [...(rel.hotesDe.get(id) ?? [])];
    const heberges = [...(rel.hebergesDe.get(id) ?? [])];
    const problemes = rel.problemes.get(id) ?? [];
    if (!hotes.length && !heberges.length && !problemes.length) return null;
    const lienVers = (m: string) => {
      const b = h('button', { type: 'button', class: 'lien', onclick: () => selectionner(m) }, m);
      return etat!.estExclu(m) ? h('del', { title: t('correction.menage_exclu') }, b) : b;
    };
    const inclus = heberges.filter((m) => !etat!.estExclu(m));
    const groupe = [id, ...hotes, ...heberges];
    return h(
      'div',
      { class: 'liens-menage' },
      hotes.length > 0 && h('div', null, h('strong', null, hotes.length > 1 ? t('correction.rattache_plusieurs') : t('correction.rattache')), hotes.map((m, i) => [i > 0 && ', ', lienVers(m)])),
      heberges.length > 0 &&
        h('div', null, h('strong', null, t('correction.menages_rattaches', { n: heberges.length })), t('correction.dont_inclus', { n: inclus.length }), heberges.map((m, i) => [i > 0 && ', ', lienVers(m)])),
      problemes.length > 0 && h('div', { class: 'avertissement' }, `⚠ ${problemes.join(t('alerte.separateur'))}`),
      groupe.length > 1 && h('div', { class: 'ligne' }, bouton(t('correction.comparer_lies', { n: groupe.length }), () => comparer(groupe))),
    );
  }

  function blocAlertes(id: string) {
    const liste = alertesParMenage.get(id);
    if (!liste?.length) return null;
    return h(
      'ul',
      { class: 'alertes-menage' },
      liste.map((a) => {
        const d = etat!.decisionsAlertes.get(a.id);
        const autres = a.menages.filter((m) => m !== id);
        return h(
          'li',
          null,
          h('strong', null, a.libelle),
          ' — ',
          a.message,
          ' ',
          autres.length > 0 &&
            h(
              'div',
              { class: 'autres-menages' },
              autres.length <= 8 && [
                t('correction.autres_menages'),
                autres.map((m) => h('button', { type: 'button', class: 'lien', onclick: () => selectionner(m) }, m)),
              ],
              bouton(t('correction.comparer', { n: a.menages.length }), () => comparer(a.menages, a.id), 'principal'),
            ),
          d ? badge(DECISIONS_ALERTE[d.contenu.categorie][d.contenu.decision], 'ok') : badge(t('commun.sans_decision'), 'attente'),
          d && h('span', { class: 'discret' }, ` ${nomAuteur(d.auteur)}`),
          peutDecider() && formulaireDecision(a, id),
        );
      }),
      h('li', { class: 'lien-alertes' }, h('button', { type: 'button', class: 'lien', onclick: () => allerValidation('alerte') }, t('correction.voir_alertes'))),
    );
  }

  function dessinerFiche() {
    const id = session.menageSelectionne;
    if (!id || !etat!.indexMenages.has(id)) {
      remplacer(zoneFiche, h('p', { class: 'vide' }, t('correction.cliquez')));
      return;
    }
    const historique = historiqueMenage(id);
    remplacer(
      zoneFiche,
      h('h2', null, t('correction.menage', { id })),
      peutCorriger
        ? h('p', { class: 'aide' }, t('correction.aide_fiche'))
        : encadre('info', t('correction.lecture_seule')),
      ligneStatut(id),
      blocLiens(id),
      blocAlertes(id),
      h(
        'div',
        { class: 'fiche-colonnes' },
        h(
          'dl',
          { class: 'champs-menage' },
          o.colonnes.map((c) => {
            const valeur = etat!.valeur(id, c) ?? '';
            const iLigne = etat!.indexMenages.get(id)!;
            const origine = o.lignes[iLigne][o.colonnes.indexOf(c)];
            const attente = etat!.enAttenteParCellule.has(cellule(id, c));
            const ligne = h(
              'div',
              { class: 'champ-menage' },
              h('dt', null, c),
              h(
                'dd',
                null,
                h('span', { class: 'valeur' }, valeur || h('span', { class: 'discret' }, t('commun.vide'))),
                valeur !== origine && h('del', { class: 'origine', title: t('correction.valeur_origine') }, origine || t('commun.vide')),
                attente && badge(t('correction.en_attente'), 'attente'),
                peutCorriger && c !== o.colonneId && !attente && bouton(t('commun.corriger'), () => formulaireCorrection(id, c, ligne, dessinerFiche)),
              ),
            );
            return ligne;
          }),
        ),
        h(
          'div',
          null,
          h('h3', null, t('correction.historique')),
          historique.length ? h('ul', { class: 'liste-historique' }, historique.map(ligneHistorique)) : h('p', { class: 'discret' }, t('correction.aucune')),
        ),
      ),
    );
  }

  // ---- Barre de séparation : glisser (souris ou doigt) ou flèches du clavier
  const separateur = h('div', {
    class: 'separateur',
    role: 'separator',
    'aria-orientation': 'horizontal',
    'aria-label': t('correction.ajuster'),
    title: t('correction.glisser'),
    tabindex: 0,
    onkeydown: (e: KeyboardEvent) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      appliquerHauteur(hauteurTableau + (e.key === 'ArrowDown' ? 40 : -40));
      memoriserHauteur();
    },
    onpointerdown: (e: PointerEvent) => {
      e.preventDefault();
      const depart = e.clientY;
      const hauteurDepart = hauteurTableau;
      separateur.setPointerCapture(e.pointerId);
      separateur.classList.add('actif');
      const bouger = (m: PointerEvent) => appliquerHauteur(hauteurDepart + m.clientY - depart);
      const lacher = () => {
        separateur.removeEventListener('pointermove', bouger);
        separateur.removeEventListener('pointerup', lacher);
        separateur.removeEventListener('pointercancel', lacher);
        separateur.classList.remove('actif');
        memoriserHauteur();
      };
      separateur.addEventListener('pointermove', bouger);
      separateur.addEventListener('pointerup', lacher);
      separateur.addEventListener('pointercancel', lacher);
    },
  }, h('span', { class: 'poignee', 'aria-hidden': 'true' }));

  const recherche = h('input', {
    type: 'search',
    placeholder: t('correction.rechercher_placeholder'),
    value: vue.recherche,
    'aria-label': t('correction.rechercher'),
    oninput: (e: Event) => {
      vue.recherche = (e.target as HTMLInputElement).value;
      vue.page = 0;
      dessinerTable();
    },
  });

  dessinerTable();
  dessinerFiche();
  return [
    h('h1', null, t('nav.correction')),
    h(
      'div',
      { class: 'barre-outils' },
      recherche,
      bouton(t('commun.reinitialiser'), () => {
        vue.filtres = {};
        vue.tri = null;
        vue.recherche = '';
        vue.page = 0;
        aller('correction');
      }),
    ),
    h('div', { class: 'ligne entre' }, h('div', { class: 'ligne serree' }, resume, barre?.ouvrir, visite?.ouvrir, decocher, boutonPlan, retours?.ouvrir, choixCols.ouvrir), pagination),
    choixCols.panneau,
    barre?.panneau,
    visite?.panneau,
    retours?.panneau,
    zoneTable,
    zonePlan,
    separateur,
    zoneFiche,
  ];
}

function memoriserHauteur() {
  try {
    localStorage.setItem(CLE_HAUTEUR, String(hauteurTableau));
  } catch {
    /* stockage indisponible : la hauteur reviendra par défaut */
  }
}

/**
 * Exclusion en lot : une proposition d'exclusion par ménage coché, chacune signée et
 * inscrite au journal ; chacune devra être validée par une autre personne (quatre yeux).
 */
let panneauExclusionOuvert = false;

/** Plan GPS de la vue Correction : ouvert ou non, mode de couleur, dernière vue (zoom et centre). */
let planOuvert = false;
let modeCouleurPlan: 'alertes' | 'enqueteur' | 'date' = 'alertes';
let vuePlan: { cle: string; vue: VuePlan } | undefined;
const MAX_POINTS_PLAN = 5000;

function barreExclusion(cochés: () => string[]) {
  const etat = session.etat!;
  const compteur = h('strong');
  const motif = h(
    'select',
    { 'aria-label': t('correction.motif_groupe') },
    h('option', { value: '' }, t('correction.motif_exclusion')),
    MOTIFS_EXCLUSION.map((m) => h('option', { value: m }, libelleMotif(m))),
  );
  const commentaire = h('input', { type: 'text', placeholder: t('correction.commentaire_groupe'), 'aria-label': t('correction.commentaire_groupe_label') });
  const exclure = bouton(t('correction.proposer_exclusion'), () => {
    const ids = cochés();
    const cibles = ids.filter((id) => !etat.estExclu(id) && !etat.enAttenteParCellule.has(cellule(id, CHAMP_STATUT)));
    const ignores = ids.length - cibles.length;
    if (!cibles.length) return notifier(t('correction.aucun_excluable'), 'erreur');
    if (!motif.value) return notifier(t('correction.choisir_motif'), 'erreur');
    if (!commentaire.value.trim()) {
      commentaire.focus();
      return notifier(t('correction.expliquer'), 'erreur');
    }
    if (
      !confirm(
        t(ignores ? 'correction.confirmer_exclusion_ignores' : 'correction.confirmer_exclusion', { n: cibles.length, ignores }),
      )
    ) {
      return;
    }
    occupe(t('correction.signature_propositions', { n: cibles.length }), async () => {
      for (const id of cibles) {
        await corriger(session.liste!, etat, session.identite!, {
          menage: id,
          champ: CHAMP_STATUT,
          ancienne: etat.valeur(id, CHAMP_STATUT) ?? '',
          nouvelle: 'exclu',
          motif: motif.value as Motif,
          commentaire: commentaire.value.trim(),
        });
        coches.delete(id);
      }
      panneauExclusionOuvert = false;
      notifier(t('correction.exclusions_proposees', { n: cibles.length }), 'succes');
      await apresModification();
    });
  }, 'danger');
  // Le formulaire d'exclusion ne s'ouvre qu'à la demande : il ne prend pas de place sinon.
  const panneau = h(
    'div',
    { class: 'barre-groupe statique compacte', hidden: !panneauExclusionOuvert },
    h('span', { class: 'titre-barre' }, t('correction.exclusion_lot')),
    compteur,
    motif,
    commentaire,
    exclure,
    bouton(t('commun.fermer'), () => {
      panneauExclusionOuvert = false;
      panneau.hidden = true;
    }),
    h(
      'p',
      { class: 'aide' },
      t('correction.aide_exclusion'),
    ),
  );
  const ouvrir = bouton(t('correction.exclure'), () => {
    panneauExclusionOuvert = !panneauExclusionOuvert;
    panneau.hidden = !panneauExclusionOuvert;
    if (panneauExclusionOuvert) motif.focus();
  }, 'danger');
  ouvrir.title = t('correction.exclure_titre');
  return {
    ouvrir,
    panneau,
    maj: () => {
      const n = cochés().length;
      compteur.textContent = t('correction.coches', { n });
      exclure.textContent = n ? t('correction.proposer_exclusion_n', { n }) : t('correction.proposer_exclusion');
      exclure.toggleAttribute('disabled', n === 0);
      ouvrir.textContent = n ? t('correction.exclure_n', { n }) : t('correction.exclure');
      ouvrir.toggleAttribute('disabled', n === 0);
      if (n === 0) {
        panneauExclusionOuvert = false;
        panneau.hidden = true;
      }
    },
  };
}

let panneauVisiteOuvert = false;
/** Colonnes de l'étiquette Kobo choisies (gardées le temps de la séance). */
const memoEtiquette: string[] = [];
/** Format choisi pour la liste de visite (Kobo par défaut), gardé le temps de la séance. */
let memoFormatVisite = 'kobo';

/** Colonnes cochées par défaut : ce qu'il faut pour retrouver et joindre le ménage, rien de plus. */
const COLONNES_UTILES = /(^|_)(nom|name|prenom|village|localite|quartier|avenue|adresse|tel|telephone|phone|contact)(_|$)/i;

/**
 * Liste de visite terrain (tableur) ou préchargement d'un formulaire Kobo de revisite,
 * pour les ménages cochés. Réservé au responsable ; chaque sortie est inscrite au journal.
 */
function panneauVisite(cochés: () => string[], aVerifier: (id: string) => string, colEnq: string, colDate: string) {
  const o = session.liste!.original;
  const choix = new Map<string, HTMLInputElement>();
  const proposees = o.colonnes.filter((c) => c !== o.colonneId && !COLONNES_TECHNIQUES.test(c));
  for (const c of [colDate, ...proposees].filter((c, i, tous) => c && tous.indexOf(c) === i)) {
    choix.set(c, h('input', { type: 'checkbox', checked: COLONNES_UTILES.test(c) || c === colEnq || c === colDate }));
  }
  const format = h(
    'select',
    { 'aria-label': t('visite.format'), onchange: () => (memoFormatVisite = format.value) },
    // Kobo d'abord : réponses contrôlées, preuve de visite et retour automatique dans 2x2.
    h('option', { value: 'kobo', selected: memoFormatVisite === 'kobo' }, t('visite.format_kobo', { fichier: NOM_PRECHARGEMENT })),
    h('option', { value: 'xlsx', selected: memoFormatVisite === 'xlsx' }, t('visite.format_xlsx')),
    h('option', { value: 'ods', selected: memoFormatVisite === 'ods' }, t('visite.format_ods')),
    h('option', { value: 'csv', selected: memoFormatVisite === 'csv' }, t('visite.format_csv')),
  );
  // Étiquette de chaque ménage dans la liste de choix du formulaire Kobo : 2 ou 3 colonnes, au choix,
  // pré-remplies par la détection (nom du chef de ménage, village). Toujours précédées de l'identifiant.
  const detectees = detecterColonnes(o.colonnes);
  const proposeesEtiquette = [colDate, ...proposees].filter((c, i, tous) => c && tous.indexOf(c) === i);
  const selecteurEtiquette = (n: number, defaut?: string) => {
    if (memoEtiquette[n] === undefined) memoEtiquette[n] = defaut ?? '';
    const sel = h(
      'select',
      { 'aria-label': t('visite.etiquette', { n: n + 1 }), onchange: () => (memoEtiquette[n] = sel.value) },
      h('option', { value: '' }, '—'),
      proposeesEtiquette.map((c) => h('option', { value: c, selected: c === memoEtiquette[n] }, c)),
    );
    return sel;
  };
  const etiquettes = [selecteurEtiquette(0, detectees.nom), selecteurEtiquette(1, detectees.village), selecteurEtiquette(2)];
  const zoneEtiquette = h(
    'div',
    { class: 'ligne etiquette-kobo' },
    h('span', null, t('visite.affiche')),
    etiquettes.flatMap((e, i) => (i ? [' – ', e] : [e])),
    h('span', { class: 'aide' }, t('visite.tri')),
  );
  const majFormat = () => (zoneEtiquette.hidden = format.value !== 'kobo');
  format.addEventListener('change', majFormat);
  format.classList.add('format-visite');
  majFormat();
  const compteur = h('strong');
  const exporter = bouton(t('visite.exporter'), () => {
    const ids = cochés();
    const kobo = format.value === 'kobo';
    const etiquette = kobo ? etiquettes.map((e) => e.value).filter((c, i, tous) => c && tous.indexOf(c) === i) : [];
    // Les colonnes de l'étiquette sortent de l'outil : elles font partie des colonnes exportées (et journalisées).
    const colonnes = [...new Set([...[...choix].filter(([, c]) => c.checked).map(([nom]) => nom), ...etiquette])];
    if (!ids.length) return notifier(t('visite.cochez'), 'erreur');
    if (kobo && !etiquette.length) return notifier(t('visite.etiquette_vide'), 'erreur');
    if (
      !confirm(
        t('visite.confirmer', { n: ids.length, colonnes: [o.colonneId, ...colonnes].join(', ') }),
      )
    ) {
      return;
    }
    occupe(t('visite.preparation'), async () => {
      const d = { ids, colonnes, etiquette, aVerifier: new Map(ids.map((id) => [id, aVerifier(id)])) };
      const f = await exporterVisite(session.liste!, session.etat!, session.identite!, d, kobo ? 'kobo' : 'visite', (kobo ? 'csv' : format.value) as FormatExport);
      telecharger(f.nomFichier, f.octets, f.type);
      panneauVisiteOuvert = false;
      notifier(t(kobo ? 'visite.exporte_kobo' : 'visite.exporte', { n: ids.length }), 'succes');
      await apresModification();
    });
  }, 'principal');
  const panneau = h(
    'div',
    { class: 'carte panneau-visite', hidden: !panneauVisiteOuvert },
    h('div', { class: 'ligne' }, h('span', { class: 'titre-barre neutre' }, t('visite.titre')), compteur),
    h('p', { class: 'aide' }, t('visite.colonnes')),
    h(
      'div',
      { class: 'choix-colonnes' },
      [...choix].map(([nom, c]) => h('label', { class: 'case' }, c, nom === colDate ? t('visite.col_date', { nom }) : nom === colEnq ? t('visite.col_enqueteur', { nom }) : nom)),
    ),
    h('p', { class: 'aide' }, t('visite.ajoutees', { colonnes: colonnesRetour().join(', ') })),
    encadre('alerte', t('visite.avertissement')),
    h(
      'div',
      { class: 'ligne' },
      format,
      exporter,
    ),
    zoneEtiquette,
    h(
      'div',
      { class: 'ligne' },
      bouton(t('visite.formulaire'), async () => {
        const corrigeables = o.colonnes.filter((c) => c !== o.colonneId && !COLONNES_TECHNIQUES.test(c));
        telecharger('formulaire_revisite_2x2.xlsx', await ecrireXlsx(formulaireRevisite(corrigeables)), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        notifier(t('visite.formulaire_telecharge', { fichier: NOM_PRECHARGEMENT }), 'succes');
      }),
      bouton(t('commun.fermer'), () => {
        panneauVisiteOuvert = false;
        panneau.hidden = true;
      }),
    ),
    h(
      'p',
      { class: 'aide' },
      t('visite.aide_kobo', { fichier: NOM_PRECHARGEMENT }),
    ),
  );
  const ouvrir = bouton(t('visite.ouvrir'), () => {
    panneauVisiteOuvert = !panneauVisiteOuvert;
    panneau.hidden = !panneauVisiteOuvert;
  });
  ouvrir.title = t('visite.ouvrir_titre');
  return {
    ouvrir,
    panneau,
    maj: () => {
      const n = cochés().length;
      compteur.textContent = t('correction.coches', { n });
      ouvrir.textContent = n ? t('visite.ouvrir_n', { n }) : t('visite.ouvrir');
      ouvrir.toggleAttribute('disabled', n === 0);
      exporter.textContent = n ? t('visite.exporter_n', { n }) : t('visite.exporter');
      exporter.toggleAttribute('disabled', n === 0);
      if (n === 0) {
        panneauVisiteOuvert = false;
        panneau.hidden = true;
      }
    },
  };
}

/** Retours du terrain importés (export des réponses du formulaire de revisite), en attente de signature. */
let retoursEnCours: { nom: string; actions: ActionRetour[]; erreurs: string[]; reponses: number; coches: Set<string> } | undefined;

const LIBELLES_NATURE_RETOUR: Record<ActionRetour['nature'], string> = libelles({ correction: 'journal.t_correction', exclusion: 'retours.exclusion', decision: 'retours.decision' });

/**
 * Import des retours du terrain : l'outil lit l'export Kobo des réponses et PROPOSE des actions.
 * On coche celles à signer ; chacune devient une ligne de journal (les corrections et
 * exclusions attendent ensuite la validation d'une autre personne).
 */
function panneauRetours() {
  const panneau = h('div', { class: 'carte panneau-retours', hidden: !retoursEnCours });
  const peutCorr = peut('correction');
  const peutDec = peutDecider();
  const autorise = (a: ActionRetour) => (a.nature === 'decision' ? peutDec : peutCorr);

  function dessiner() {
    const r = retoursEnCours;
    if (!r) {
      panneau.hidden = true;
      return;
    }
    panneau.hidden = false;
    const signables = r.actions.filter((a) => !a.impossible && autorise(a));
    const n = signables.filter((a) => r.coches.has(a.cle)).length;
    remplacer(
      panneau,
      h('div', { class: 'ligne' }, h('span', { class: 'titre-barre neutre' }, t('retours.titre')), h('strong', null, r.nom), h('span', { class: 'discret' }, t('retours.resume', { n: r.reponses, actions: r.actions.length }))),
      r.erreurs.length > 0 && encadre('alerte', h('strong', null, t('retours.erreurs', { n: r.erreurs.length })), h('ul', null, r.erreurs.slice(0, 20).map((e) => h('li', null, e)))),
      r.actions.length
        ? h(
            'div',
            { class: 'defilement' },
            h(
              'table',
              { class: 'tableau retours' },
              h('thead', null, h('tr', null, ['', t('retours.col_menage'), t('retours.col_action'), t('validation.col_detail'), t('retours.col_source'), t('retours.col_noter')].map((x) => h('th', null, x)))),
              h(
                'tbody',
                null,
                r.actions.map((a) => {
                  const bloque = a.impossible ?? (autorise(a) ? '' : a.nature === 'decision' ? t('validation.role_decider') : t('retours.role_correction'));
                  return h(
                    'tr',
                    { class: `${bloque ? 'bloquee' : ''}${a.avertissement ? ' a-verifier' : ''}` },
                    h(
                      'td',
                      null,
                      h('input', {
                        type: 'checkbox',
                        checked: !bloque && r.coches.has(a.cle),
                        disabled: !!bloque,
                        title: bloque || undefined,
                        'aria-label': t('retours.retenir', { menage: a.menage, resume: a.resume }),
                        onchange: (e: Event) => {
                          (e.target as HTMLInputElement).checked ? r.coches.add(a.cle) : r.coches.delete(a.cle);
                          dessiner();
                        },
                      }),
                    ),
                    h('td', null, a.menage),
                    h('td', null, badge(LIBELLES_NATURE_RETOUR[a.nature], a.nature === 'decision' ? 'neutre' : a.nature === 'exclusion' ? 'refus' : 'attente')),
                    h('td', null, a.resume, a.motif && a.nature !== 'correction' ? h('div', { class: 'discret' }, t('retours.motif', { motif: libelleMotif(a.motif) })) : ''),
                    h('td', { class: 'discret' }, a.commentaire),
                    h('td', null, bloque && h('div', { class: 'discret' }, bloque), a.avertissement && h('div', { class: 'avertissement' }, `⚠ ${a.avertissement}`)),
                  );
                }),
              ),
            ),
          )
        : h('p', { class: 'discret' }, t('retours.aucune')),
      h(
        'p',
        { class: 'aide' },
        t('retours.aide'),
      ),
      h(
        'div',
        { class: 'ligne' },
        bouton(n ? t('retours.signer_n', { n }) : t('commun.signer'), () => signer(signables.filter((a) => r.coches.has(a.cle))), 'principal', n === 0),
        bouton(t('retours.abandonner'), () => {
          retoursEnCours = undefined;
          dessiner();
        }),
      ),
    );
  }

  function signer(choisies: ActionRetour[]) {
    if (!choisies.length) return;
    if (!confirm(t('retours.confirmer', { n: choisies.length }))) return;
    occupe(t('retours.signature', { n: choisies.length }), async () => {
      const { liste, etat, identite } = session;
      let faites = 0;
      for (const a of choisies) {
        if (a.nature === 'decision' && a.alerte) {
          await deciderAlerte(liste!, etat!, identite!, { alerte: a.alerte.id, categorie: a.alerte.categorie, menages: a.alerte.menages, decision: a.decision!, commentaire: a.commentaire });
          session.decisionsDepuisRecu++;
        } else {
          await corriger(liste!, etat!, identite!, { menage: a.menage, champ: a.champ!, ancienne: a.ancienne!, nouvelle: a.nouvelle!, motif: a.motif!, commentaire: a.commentaire });
        }
        faites++;
      }
      retoursEnCours = undefined;
      notifier(t('retours.signees', { n: faites }), 'succes');
      await apresModification();
    });
  }

  const ouvrir = bouton(t('retours.ouvrir'), async () => {
    const f = await choisirFichier('.xlsx,.ods,.csv');
    if (!f) return;
    await occupe(t('retours.lecture'), async () => {
      const tab = await lireExport(f.octets, f.nom);
      const r = lireRetours(tab, session.etat!, alertesCourantes(), colonneGps());
      retoursEnCours = {
        nom: f.nom,
        ...r,
        coches: new Set(r.actions.filter((a) => !a.impossible && !a.avertissement && autorise(a)).map((a) => a.cle)),
      };
      dessiner();
    });
  });
  ouvrir.title = t('retours.ouvrir_titre');
  dessiner();
  return { ouvrir, panneau };
}
