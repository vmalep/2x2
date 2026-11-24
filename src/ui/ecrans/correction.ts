import { cellule, corriger, type CorrectionSuivie } from '../../model/journal.ts';
import { relationsLien } from '../../controles/controles.ts';
import { allerValidation } from './validation.ts';
import { CHAMP_STATUT, DECISIONS_ALERTE, MOTIFS_EXCLUSION, motifsPour, type Motif } from '../../model/types.ts';
import { badge, bouton, encadre } from '../composants.ts';
import { dateLisible, h, remplacer } from '../dom.ts';
import { telecharger } from '../fichiers.ts';
import { COLONNES_RETOUR, exporterVisite, NOM_PRECHARGEMENT } from '../../model/visite.ts';
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
  return c.statut === 'en_attente' ? badge('en attente', 'attente') : c.statut === 'acceptee' ? badge('acceptée', 'ok') : badge('refusée', 'refus');
}

export function ligneHistorique(c: CorrectionSuivie) {
  const e = c.entree;
  return h(
    'li',
    { class: 'historique' },
    h('div', { class: 'entete-historique' }, h('strong', null, e.contenu.champ === CHAMP_STATUT ? 'Statut du ménage' : e.contenu.champ), statutCorrection(c), h('span', { class: 'discret' }, `n° ${e.n}`)),
    h('div', { class: 'diff' }, h('del', null, e.contenu.ancienne || '(vide)'), ' → ', h('ins', null, e.contenu.nouvelle || '(vide)')),
    h('div', { class: 'discret' }, `${e.contenu.motif} · ${nomAuteur(e.auteur)} · ${dateLisible(e.le)}`),
    e.contenu.commentaire && h('div', { class: 'commentaire' }, `« ${e.contenu.commentaire} »`),
    c.decision &&
      h(
        'div',
        { class: 'discret' },
        `${c.statut === 'acceptee' ? 'Acceptée' : 'Refusée'} par ${nomAuteur(c.decision.auteur)} · ${dateLisible(c.decision.le)}`,
        c.decision.contenu.commentaire && ` · « ${c.decision.contenu.commentaire} »`,
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
    : h('input', { type: 'text', value: ancienne, 'aria-label': 'Nouvelle valeur' });
  const motif = h(
    'select',
    { 'aria-label': 'Motif', required: true },
    h('option', { value: '' }, statut ? (ancienne === 'exclu' ? '— Motif de la réintégration —' : '— Motif de l’exclusion —') : '— Motif (obligatoire) —'),
    motifsPour(champ, ancienne).map((m) => h('option', { value: m }, m)),
  );
  const commentaire = h('textarea', { rows: 2, placeholder: 'Commentaire', 'aria-label': 'Commentaire' });
  const form = h(
    'form',
    {
      class: 'form-correction',
      onsubmit: (e: Event) => {
        e.preventDefault();
        if (!motif.value) return notifier('Choisissez un motif.', 'erreur');
        if (statut && !commentaire.value.trim()) return notifier('Expliquez la raison en commentaire.', 'erreur');
        occupe('Signature de la correction…', async () => {
          await corriger(liste!, etat!, session.identite!, {
            menage: id,
            champ,
            ancienne,
            nouvelle: nouvelle.value,
            motif: motif.value as Motif,
            commentaire: commentaire.value.trim(),
          });
          notifier('Correction signée. Elle attend la validation d’une autre personne.', 'succes');
          await apresModification();
        });
      },
    },
    statut
      ? h(
          'div',
          null,
          h('strong', null, `${ancienne === 'exclu' ? 'Proposer la réintégration' : 'Proposer l’exclusion'} du ménage ${id}`),
          h('div', { class: 'discret' }, 'La proposition devra être validée par une autre personne.'),
        )
      : h('div', { class: 'discret' }, `${id} · ${champ} — valeur actuelle : `, h('strong', null, ancienne || '(vide)')),
    nouvelle,
    motif,
    commentaire,
    h(
      'div',
      { class: 'ligne' },
      h('button', { type: 'submit', class: 'bouton principal' }, 'Signer la correction'),
      bouton('Annuler', surAnnulation),
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
  const LIBELLES_DECISION: Record<string, string> = { sans: 'Sans décision', ...DECISIONS_ALERTE.integrite };

  const etatsMenage = (id: string): string[] => {
    const r: string[] = [etat!.estExclu(id) ? 'Exclu' : 'Inclus'];
    const s = statutMenage(id);
    if (s === 'attente') r.push('Correction en attente');
    if (valeursCorrigees(id)) r.push('Corrigé');
    return r;
  };

  const donnees = o.colonnes.filter((c) => c !== o.colonneId && c !== colEnq && c !== colDate && !COLONNES_TECHNIQUES.test(c)).slice(0, 5);
  // Toutes les colonnes possibles ; l'utilisateur choisit lesquelles afficher (« Colonnes… »).
  const possibles: Valeurs[] = [
    { cle: 'id', titre: o.colonneId, filtre: 'texte', valeur: (id) => id },
    ...(colEnq ? [{ cle: 'enq', titre: 'Enquêteur', filtre: 'liste' as const, valeur: (id: string) => etat!.valeur(id, colEnq) ?? '' }] : []),
    ...(colDate ? [{ cle: 'date', titre: 'Date', filtre: 'liste' as const, valeur: jourEntretien, tri: horodatageDe }] : []),
    { cle: 'alertes', titre: 'Alertes', filtre: 'liste', valeur: (id) => libellesAlertes(id).join(', '), liste: libellesAlertes },
    { cle: 'etat', titre: 'État', filtre: 'liste', valeur: (id) => etatsMenage(id).join(', '), liste: etatsMenage },
    ...o.colonnes.filter((c) => c !== o.colonneId).map((c): Valeurs => ({ cle: `c:${c}`, titre: c, filtre: 'texte', valeur: (id) => etat!.valeur(id, c) ?? '' })),
  ];
  const choixCols = choixColonnes(
    `2x2-colonnes-correction-${o.empreinteFichier}`,
    possibles.map((v) => ({
      cle: v.cle,
      libelle: v.cle === 'id' ? `${v.titre} (identifiant)` : v.titre,
      groupe: v.cle.startsWith('c:') ? 'Colonnes de l’export' : 'Repères',
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
  const zoneFiche = h('section', { class: 'fiche', 'aria-label': 'Fiche du ménage' });
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
    const t = vue.tri;
    if (t) {
      const col = colonnes.find((c) => c.cle === t.cle);
      const v = col?.tri ?? col?.valeur;
      if (v) retenus.sort((a, b) => t.sens * comparateur.compare(v(a), v(b)));
    }
    return retenus;
  }

  // ---- En-têtes : tri et filtres (créés une fois, pour garder la saisie en cours)
  const enTetes = colonnes.map((c) =>
    h('button', {
      type: 'button',
      class: 'tri',
      title: 'Trier',
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
        placeholder: 'Filtrer…',
        'aria-label': `Filtrer ${c.titre}`,
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
        'aria-label': `Filtrer ${c.titre}`,
        onchange: (e: Event) => {
          vue.filtres[c.cle] = (e.target as HTMLSelectElement).value;
          vue.page = 0;
          dessinerTable();
        },
      },
      h('option', { value: TOUS, selected: !vue.filtres[c.cle] }, 'Tous'),
      c.cle === 'alertes' && [
        h('option', { value: AVEC_ALERTE, selected: vue.filtres[c.cle] === AVEC_ALERTE }, `Avec alerte (${avec})`),
        h('option', { value: SANS_ALERTE, selected: vue.filtres[c.cle] === SANS_ALERTE }, `Sans alerte (${tous.length - avec})`),
        parDecision.size > 0 &&
          h(
            'optgroup',
            { label: 'Par décision' },
            Object.entries(LIBELLES_DECISION)
              .filter(([d]) => parDecision.has(d))
              .map(([d, l]) => h('option', { value: PAR_DECISION + d, selected: vue.filtres[c.cle] === PAR_DECISION + d }, `${l} (${parDecision.get(d)})`)),
          ),
      ],
      c.cle === 'alertes'
        ? valeurs.length > 0 && h('optgroup', { label: 'Par type d’alerte' }, valeurs.map(([v, k]) => h('option', { value: v, selected: vue.filtres[c.cle] === v }, `${v} (${k})`)))
        : valeurs.map(([v, k]) => h('option', { value: v, selected: vue.filtres[c.cle] === v }, `${v} (${k})`)),
    );
  });

  // ---- Sélection et exclusion en lot
  const caseTout = h('input', {
    type: 'checkbox',
    'aria-label': 'Cocher tous les ménages filtrés',
    title: 'Coche tous les ménages qui correspondent aux filtres (toutes pages)',
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
  const decocher = peutCocher ? bouton('Tout décocher', () => (coches.clear(), dessinerTable())) : null;
  const retours = peutCorriger || peutDecider() ? panneauRetours() : null;
  // Le plan prend la place du tableau (même cadre, même barre de séparation) ; la fiche reste en dessous.
  const boutonPlan = colonneGps()
    ? bouton(planOuvert ? 'Afficher la liste' : 'Plan GPS', () => {
        planOuvert = !planOuvert;
        zonePlan.hidden = !planOuvert;
        // Avec le plan, le tableau se réduit à ses en-têtes et filtres : on filtre ce que montre le plan.
        zoneTable.classList.toggle('filtres-seuls', planOuvert);
        boutonPlan!.textContent = planOuvert ? 'Afficher la liste' : 'Plan GPS';
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
      const decision = uniques.length === 1 ? LIBELLES_DECISION[uniques[0]] : 'décisions diverses';
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
                          'aria-label': `Cocher le ménage ${id}`,
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
                          etat!.estExclu(id) && badge('exclu', 'refus'),
                          s === 'attente' && badge('en attente', 'attente'),
                          valeursCorrigees(id) && badge('corrigé', 'ok'),
                        );
                      }
                      const champ = c.cle.startsWith('c:') ? c.cle.slice(2) : c.cle === 'enq' ? colEnq : c.cle === 'date' ? colDate : '';
                      return h('td', { class: `${c.cle === 'date' ? 'date' : ''}${champ && etat!.modifications.get(id)?.has(champ) ? ' modifie' : ''}`, title: c.cle === 'date' ? horodatageDe(id) : undefined }, c.valeur(id));
                    }),
                  ),
                )
              : h('tr', null, h('td', { colspan: colonnes.length + 1, class: 'vide' }, 'Aucun ménage ne correspond aux filtres.')),
          ),
        ),
      ),
    );
    resume.textContent = `${ids.length} ménage(s) sur ${tous.length}${coches.size ? ` · ${coches.size} coché(s)` : ''}`;
    remplacer(
      pagination,
      bouton('‹', () => {
        vue.page--;
        dessinerTable();
      }, 'secondaire', vue.page === 0),
      h('span', null, `Page ${vue.page + 1} / ${pages}`),
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
      const valeurs = [...new Set(retenus.map((id) => (modeCouleurPlan === 'enqueteur' ? (colEnq ? (etat!.valeur(id, colEnq) ?? '') : '') : jourEntretien(id)) || '(vide)'))].sort(comparateur.compare);
      valeurs.forEach(couleurDe);
    }
    const ETATS_PLAN: Record<string, [string, string]> = {
      ouverte: ['#a35a00', 'Alerte sans décision'],
      decidee: ['#6b6b6b', 'Alerte décidée'],
      aucune: ['#0f5f73', 'Sans alerte'],
      exclu: ['#c0182b', 'Exclu'],
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
        couleur = couleurDe((modeCouleurPlan === 'enqueteur' ? (colEnq ? (etat!.valeur(id, colEnq) ?? '') : '') : jourEntretien(id)) || '(vide)');
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
            'aria-label': 'Couleur des points',
            onchange: (e: Event) => {
              modeCouleurPlan = (e.target as HTMLSelectElement).value as typeof modeCouleurPlan;
              dessinerPlan(filtresCourants);
            },
          },
          h('option', { value: 'alertes', selected: modeCouleurPlan === 'alertes' }, 'Couleur : alertes'),
          colEnq && h('option', { value: 'enqueteur', selected: modeCouleurPlan === 'enqueteur' }, 'Couleur : enquêteur'),
          colDate && h('option', { value: 'date', selected: modeCouleurPlan === 'date' }, 'Couleur : journée'),
        ),
        h(
          'span',
          { class: 'discret' },
          `${points.length} ménage(s) sur le plan${sansPoint ? `, ${sansPoint} sans coordonnées` : ''}${ids.length > MAX_POINTS_PLAN ? ` (limité aux ${MAX_POINTS_PLAN} premiers)` : ''}`,
        ),
        h('span', { class: 'espace' }),
        bouton('Zone pour un fond de carte…', () => {
          // Emprise de TOUS les ménages géolocalisés, élargie et arrondie : elle ne révèle que la région.
          const pts = tous.map((id) => pointMenage(id, colGps)).filter((x): x is NonNullable<typeof x> => !!x);
          if (!pts.length) return notifier('Aucun ménage n’a de coordonnées GPS.', 'erreur');
          const z = zoneArrondie(pts);
          telecharger('zone_fond_de_carte.geojson', zoneEnGeoJson(z), 'application/geo+json');
          const lat = (x: number) => `${Math.abs(x)}° ${x < 0 ? 'S' : 'N'}`;
          const lon = (x: number) => `${Math.abs(x)}° ${x < 0 ? 'O' : 'E'}`;
          notifier(`Zone téléchargée (${lon(z.ouest)} à ${lon(z.est)}, ${lat(z.sud)} à ${lat(z.nord)}). Importez-la dans le HOT Export Tool (« Import »), puis chargez ici le fichier obtenu.`, 'succes');
        }),
        fond
          ? [
              h(
                'span',
                { class: 'discret', title: fond.vecteur ? 'Fond vectoriel (GeoJSON)' : `Niveaux de zoom : ${fond.zooms.join(', ')}` },
                `Fond : ${fond.nom} (${fond.nombre} ${fond.vecteur ? 'éléments' : 'tuiles'})`,
              ),
              bouton('Retirer le fond', () => (retirerFond(), dessinerPlan(filtresCourants))),
            ]
          : bouton('Charger un fond de carte…', async () => {
              const f = await choisirFichier('.zip,.geojson,.json,application/zip,application/geo+json');
              if (!f) return;
              await occupe('Lecture du fond de carte…', async () => {
                const c = await chargerFond(f.nom, f.octets as Uint8Array<ArrayBuffer>);
                notifier(
                  c.vecteur
                    ? `Fond de carte chargé : ${c.nombre} éléments (routes, rivières, lieux…). Il reste sur ce poste, pour cette séance.`
                    : `Fond de carte chargé : ${c.nombre} tuiles, zoom ${c.zooms[0]} à ${c.zooms.at(-1)}. Il reste sur ce poste, pour cette séance.`,
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
      h('p', { class: 'aide' }, 'Molette : zoomer · glisser : déplacer · clic sur un point : ouvrir la fiche. Les ménages cochés et le ménage ouvert sont entourés.', colLien ? ` Les traits violets relient chaque ménage au ménage qu’il désigne (« ${colLien} »).` : ''),
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
      h('span', null, 'Statut : ', h('strong', null, exclu ? 'exclu de la liste finale' : 'inclus')),
      attente && badge('changement en attente', 'attente'),
      peutCorriger && !attente && bouton(exclu ? 'Proposer la réintégration' : 'Proposer l’exclusion', () => formulaireCorrection(id, CHAMP_STATUT, ligne, dessinerFiche)),
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
      return etat!.estExclu(m) ? h('del', { title: 'Ménage exclu' }, b) : b;
    };
    const inclus = heberges.filter((m) => !etat!.estExclu(m));
    const groupe = [id, ...hotes, ...heberges];
    return h(
      'div',
      { class: 'liens-menage' },
      hotes.length > 0 && h('div', null, h('strong', null, hotes.length > 1 ? 'Rattaché à plusieurs ménages : ' : 'Rattaché à : '), hotes.map((m, i) => [i > 0 && ', ', lienVers(m)])),
      heberges.length > 0 &&
        h('div', null, h('strong', null, `Ménages rattachés : ${heberges.length}`), ` (${inclus.length} inclus) : `, heberges.map((m, i) => [i > 0 && ', ', lienVers(m)])),
      problemes.length > 0 && h('div', { class: 'avertissement' }, `⚠ ${problemes.join(' ; ')}`),
      groupe.length > 1 && h('div', { class: 'ligne' }, bouton(`Comparer les ${groupe.length} ménages liés`, () => comparer(groupe))),
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
                'Autre(s) ménage(s) : ',
                autres.map((m) => h('button', { type: 'button', class: 'lien', onclick: () => selectionner(m) }, m)),
              ],
              bouton(`Comparer les ${a.menages.length} ménages côte à côte`, () => comparer(a.menages, a.id), 'principal'),
            ),
          d ? badge(DECISIONS_ALERTE[d.contenu.categorie][d.contenu.decision], 'ok') : badge('sans décision', 'attente'),
          d && h('span', { class: 'discret' }, ` ${nomAuteur(d.auteur)}`),
          peutDecider() && formulaireDecision(a, id),
        );
      }),
      h('li', { class: 'lien-alertes' }, h('button', { type: 'button', class: 'lien', onclick: () => allerValidation('alerte') }, 'Voir toutes les alertes (écran Validation)')),
    );
  }

  function dessinerFiche() {
    const id = session.menageSelectionne;
    if (!id || !etat!.indexMenages.has(id)) {
      remplacer(zoneFiche, h('p', { class: 'vide' }, 'Cliquez sur un ménage dans le tableau pour afficher sa fiche ici.'));
      return;
    }
    const historique = historiqueMenage(id);
    remplacer(
      zoneFiche,
      h('h2', null, `Ménage ${id}`),
      peutCorriger
        ? h('p', { class: 'aide' }, 'Pour corriger une valeur, cliquez « Corriger » à côté du champ. Chaque correction attend la validation d’une autre personne.')
        : encadre('info', 'Lecture seule : vous n’avez pas le rôle « Correction » dans cette liste.'),
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
                h('span', { class: 'valeur' }, valeur || h('span', { class: 'discret' }, '(vide)')),
                valeur !== origine && h('del', { class: 'origine', title: 'Valeur de l’original' }, origine || '(vide)'),
                attente && badge('en attente', 'attente'),
                peutCorriger && c !== o.colonneId && !attente && bouton('Corriger', () => formulaireCorrection(id, c, ligne, dessinerFiche)),
              ),
            );
            return ligne;
          }),
        ),
        h(
          'div',
          null,
          h('h3', null, 'Historique des corrections'),
          historique.length ? h('ul', { class: 'liste-historique' }, historique.map(ligneHistorique)) : h('p', { class: 'discret' }, 'Aucune correction.'),
        ),
      ),
    );
  }

  // ---- Barre de séparation : glisser (souris ou doigt) ou flèches du clavier
  const separateur = h('div', {
    class: 'separateur',
    role: 'separator',
    'aria-orientation': 'horizontal',
    'aria-label': 'Ajuster la hauteur du tableau',
    title: 'Glisser pour agrandir le tableau ou la fiche',
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
    placeholder: 'Rechercher dans tous les champs (identifiant, nom, téléphone…)',
    value: vue.recherche,
    'aria-label': 'Rechercher',
    oninput: (e: Event) => {
      vue.recherche = (e.target as HTMLInputElement).value;
      vue.page = 0;
      dessinerTable();
    },
  });

  dessinerTable();
  dessinerFiche();
  return [
    h('h1', null, 'Correction'),
    h(
      'div',
      { class: 'barre-outils' },
      recherche,
      bouton('Réinitialiser filtres et tri', () => {
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
    { 'aria-label': 'Motif de l’exclusion groupée' },
    h('option', { value: '' }, '— Motif de l’exclusion —'),
    MOTIFS_EXCLUSION.map((m) => h('option', { value: m }, m)),
  );
  const commentaire = h('input', { type: 'text', placeholder: 'Commentaire (obligatoire, commun)', 'aria-label': 'Commentaire de l’exclusion groupée' });
  const exclure = bouton('Proposer l’exclusion', () => {
    const ids = cochés();
    const cibles = ids.filter((id) => !etat.estExclu(id) && !etat.enAttenteParCellule.has(cellule(id, CHAMP_STATUT)));
    const ignores = ids.length - cibles.length;
    if (!cibles.length) return notifier('Aucun des ménages cochés ne peut être exclu : ils sont déjà exclus ou un changement de statut est déjà en attente.', 'erreur');
    if (!motif.value) return notifier('Choisissez un motif.', 'erreur');
    if (!commentaire.value.trim()) {
      commentaire.focus();
      return notifier('Expliquez la raison en commentaire.', 'erreur');
    }
    if (
      !confirm(
        `Proposer l’exclusion de ${cibles.length} ménage(s)${ignores ? ` (${ignores} ignoré(s) : déjà exclus ou changement en attente)` : ''} ? Chaque proposition sera inscrite séparément au journal et devra être validée par une autre personne.`,
      )
    ) {
      return;
    }
    occupe(`Signature de ${cibles.length} proposition(s)…`, async () => {
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
      notifier(`${cibles.length} exclusion(s) proposée(s). Elles attendent la validation d’une autre personne.`, 'succes');
      await apresModification();
    });
  }, 'danger');
  // Le formulaire d'exclusion ne s'ouvre qu'à la demande : il ne prend pas de place sinon.
  const panneau = h(
    'div',
    { class: 'barre-groupe statique compacte', hidden: !panneauExclusionOuvert },
    h('span', { class: 'titre-barre' }, 'Exclusion en lot'),
    compteur,
    motif,
    commentaire,
    exclure,
    bouton('Fermer', () => {
      panneauExclusionOuvert = false;
      panneau.hidden = true;
    }),
    h(
      'p',
      { class: 'aide' },
      'Chaque exclusion devra être validée par une autre personne. Pour une simple visite terrain, n’excluez pas : décidez « À vérifier sur le terrain » sur les alertes (écran Validation).',
    ),
  );
  const ouvrir = bouton('Exclure…', () => {
    panneauExclusionOuvert = !panneauExclusionOuvert;
    panneau.hidden = !panneauExclusionOuvert;
    if (panneauExclusionOuvert) motif.focus();
  }, 'danger');
  ouvrir.title = 'Proposer l’exclusion des ménages cochés';
  return {
    ouvrir,
    panneau,
    maj: () => {
      const n = cochés().length;
      compteur.textContent = `${n} ménage(s) coché(s)`;
      exclure.textContent = n ? `Proposer l’exclusion de ${n} ménage(s)` : 'Proposer l’exclusion';
      exclure.toggleAttribute('disabled', n === 0);
      ouvrir.textContent = n ? `Exclure les ${n} cochés…` : 'Exclure…';
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
  for (const c of [colDate, ...proposees].filter((c, i, t) => c && t.indexOf(c) === i)) {
    choix.set(c, h('input', { type: 'checkbox', checked: COLONNES_UTILES.test(c) || c === colEnq || c === colDate }));
  }
  const format = h(
    'select',
    { 'aria-label': 'Format de la liste de visite', onchange: () => (memoFormatVisite = format.value) },
    // Kobo d'abord : réponses contrôlées, preuve de visite et retour automatique dans 2x2.
    h('option', { value: 'kobo', selected: memoFormatVisite === 'kobo' }, `Préchargement Kobo (${NOM_PRECHARGEMENT})`),
    h('option', { value: 'xlsx', selected: memoFormatVisite === 'xlsx' }, 'Liste à imprimer : tableur XLSX (Excel)'),
    h('option', { value: 'ods', selected: memoFormatVisite === 'ods' }, 'Liste à imprimer : tableur ODS (LibreOffice)'),
    h('option', { value: 'csv', selected: memoFormatVisite === 'csv' }, 'Liste : CSV'),
  );
  // Étiquette de chaque ménage dans la liste de choix du formulaire Kobo : 2 ou 3 colonnes, au choix,
  // pré-remplies par la détection (nom du chef de ménage, village). Toujours précédées de l'identifiant.
  const detectees = detecterColonnes(o.colonnes);
  const proposeesEtiquette = [colDate, ...proposees].filter((c, i, t) => c && t.indexOf(c) === i);
  const selecteurEtiquette = (n: number, defaut?: string) => {
    if (memoEtiquette[n] === undefined) memoEtiquette[n] = defaut ?? '';
    const sel = h(
      'select',
      { 'aria-label': `Étiquette Kobo, colonne ${n + 1}`, onchange: () => (memoEtiquette[n] = sel.value) },
      h('option', { value: '' }, '—'),
      proposeesEtiquette.map((c) => h('option', { value: c, selected: c === memoEtiquette[n] }, c)),
    );
    return sel;
  };
  const etiquettes = [selecteurEtiquette(0, detectees.nom), selecteurEtiquette(1, detectees.village), selecteurEtiquette(2)];
  const zoneEtiquette = h(
    'div',
    { class: 'ligne etiquette-kobo' },
    h('span', null, 'Affiché dans la liste Kobo : identifiant –'),
    etiquettes.flatMap((e, i) => (i ? [' – ', e] : [e])),
    h('span', { class: 'aide' }, 'La liste est triée selon ces colonnes, dans cet ordre (ex. village puis nom).'),
  );
  const majFormat = () => (zoneEtiquette.hidden = format.value !== 'kobo');
  format.addEventListener('change', majFormat);
  format.classList.add('format-visite');
  majFormat();
  const compteur = h('strong');
  const exporter = bouton('Exporter', () => {
    const ids = cochés();
    const kobo = format.value === 'kobo';
    const etiquette = kobo ? etiquettes.map((e) => e.value).filter((c, i, t) => c && t.indexOf(c) === i) : [];
    // Les colonnes de l'étiquette sortent de l'outil : elles font partie des colonnes exportées (et journalisées).
    const colonnes = [...new Set([...[...choix].filter(([, c]) => c.checked).map(([nom]) => nom), ...etiquette])];
    if (!ids.length) return notifier('Cochez d’abord des ménages.', 'erreur');
    if (kobo && !etiquette.length) return notifier('Choisissez au moins une colonne à afficher dans la liste Kobo (par exemple le nom et le village).', 'erreur');
    if (
      !confirm(
        `Ce fichier contiendra en clair ${ids.length} ménage(s) et les colonnes : ${[o.colonneId, ...colonnes].join(', ')}.\n\n` +
          'Transmettez-le par un canal sûr et supprimez-le après la mission. L’export sera inscrit au journal. Continuer ?',
      )
    ) {
      return;
    }
    occupe('Préparation de la liste…', async () => {
      const d = { ids, colonnes, etiquette, aVerifier: new Map(ids.map((id) => [id, aVerifier(id)])) };
      const f = await exporterVisite(session.liste!, session.etat!, session.identite!, d, kobo ? 'kobo' : 'visite', (kobo ? 'csv' : format.value) as FormatExport);
      telecharger(f.nomFichier, f.octets, f.type);
      panneauVisiteOuvert = false;
      notifier(`${kobo ? 'Fichier de préchargement exporté' : 'Liste de visite exportée'} (${ids.length} ménage(s)), inscription au journal faite.`, 'succes');
      await apresModification();
    });
  }, 'principal');
  const panneau = h(
    'div',
    { class: 'carte panneau-visite', hidden: !panneauVisiteOuvert },
    h('div', { class: 'ligne' }, h('span', { class: 'titre-barre neutre' }, 'Liste de visite terrain'), compteur),
    h('p', { class: 'aide' }, 'Colonnes à inclure (l’identifiant est toujours inclus). Ne cochez que ce qu’il faut pour retrouver et joindre le ménage.'),
    h(
      'div',
      { class: 'choix-colonnes' },
      [...choix].map(([nom, c]) => h('label', { class: 'case' }, c, nom === colDate ? `${nom} (date)` : nom === colEnq ? `${nom} (enquêteur)` : nom)),
    ),
    h('p', { class: 'aide' }, `Ajoutées automatiquement : « À vérifier » (les alertes du ménage) et, pour la liste de visite, des colonnes à remplir sur place : ${COLONNES_RETOUR.join(', ')}.`),
    encadre('alerte', 'Ce fichier fait sortir des données personnelles en clair. Transmettez-le par un canal sûr, gardez-le le moins longtemps possible et supprimez-le après la mission.'),
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
      bouton('Formulaire Kobo de revisite (XLSForm)', async () => {
        const corrigeables = o.colonnes.filter((c) => c !== o.colonneId && !COLONNES_TECHNIQUES.test(c));
        telecharger('formulaire_revisite_2x2.xlsx', await ecrireXlsx(formulaireRevisite(corrigeables)), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        notifier(`Formulaire téléchargé. Dans KoboToolbox : importez-le, ajoutez ${NOM_PRECHARGEMENT} en pièce jointe (média), puis déployez.`, 'succes');
      }),
      bouton('Fermer', () => {
        panneauVisiteOuvert = false;
        panneau.hidden = true;
      }),
    ),
    h(
      'p',
      { class: 'aide' },
      `Avec Kobo : exportez « Préchargement Kobo », téléchargez le formulaire de revisite (il ne contient aucune donnée), importez-le dans KoboToolbox avec ${NOM_PRECHARGEMENT} comme pièce jointe. Après la mission, importez l’export des réponses avec « Retours du terrain… ».`,
    ),
  );
  const ouvrir = bouton('Liste de visite…', () => {
    panneauVisiteOuvert = !panneauVisiteOuvert;
    panneau.hidden = !panneauVisiteOuvert;
  });
  ouvrir.title = 'Exporter les ménages cochés pour une visite ou un appel (tableur ou préchargement Kobo)';
  return {
    ouvrir,
    panneau,
    maj: () => {
      const n = cochés().length;
      compteur.textContent = `${n} ménage(s) coché(s)`;
      ouvrir.textContent = n ? `Liste de visite (${n})…` : 'Liste de visite…';
      ouvrir.toggleAttribute('disabled', n === 0);
      exporter.textContent = n ? `Exporter ${n} ménage(s)` : 'Exporter';
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

const LIBELLES_NATURE_RETOUR: Record<ActionRetour['nature'], string> = { correction: 'Correction', exclusion: 'Exclusion', decision: 'Décision d’alerte' };

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
      h('div', { class: 'ligne' }, h('span', { class: 'titre-barre neutre' }, 'Retours du terrain'), h('strong', null, r.nom), h('span', { class: 'discret' }, `${r.reponses} réponse(s), ${r.actions.length} action(s) proposée(s)`)),
      r.erreurs.length > 0 && encadre('alerte', h('strong', null, `${r.erreurs.length} réponse(s) non exploitée(s) :`), h('ul', null, r.erreurs.slice(0, 20).map((e) => h('li', null, e)))),
      r.actions.length
        ? h(
            'div',
            { class: 'defilement' },
            h(
              'table',
              { class: 'tableau retours' },
              h('thead', null, h('tr', null, ['', 'Ménage', 'Action', 'Détail', 'Source', 'À noter'].map((t) => h('th', null, t)))),
              h(
                'tbody',
                null,
                r.actions.map((a) => {
                  const bloque = a.impossible ?? (autorise(a) ? '' : a.nature === 'decision' ? 'Il faut le rôle « Validation » ou « Responsable ».' : 'Il faut le rôle « Correction ».');
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
                        'aria-label': `Retenir : ${a.menage} ${a.resume}`,
                        onchange: (e: Event) => {
                          (e.target as HTMLInputElement).checked ? r.coches.add(a.cle) : r.coches.delete(a.cle);
                          dessiner();
                        },
                      }),
                    ),
                    h('td', null, a.menage),
                    h('td', null, badge(LIBELLES_NATURE_RETOUR[a.nature], a.nature === 'decision' ? 'neutre' : a.nature === 'exclusion' ? 'refus' : 'attente')),
                    h('td', null, a.resume, a.motif && a.nature !== 'correction' ? h('div', { class: 'discret' }, `Motif : ${a.motif}`) : ''),
                    h('td', { class: 'discret' }, a.commentaire),
                    h('td', null, bloque && h('div', { class: 'discret' }, bloque), a.avertissement && h('div', { class: 'avertissement' }, `⚠ ${a.avertissement}`)),
                  );
                }),
              ),
            ),
          )
        : h('p', { class: 'discret' }, 'Aucune action à proposer.'),
      h(
        'p',
        { class: 'aide' },
        'Les actions marquées ⚠ (visite loin du ménage ou sans position) ne sont pas cochées : vérifiez-les avant de les retenir. Les corrections et exclusions signées attendront la validation d’une autre personne.',
      ),
      h(
        'div',
        { class: 'ligne' },
        bouton(n ? `Signer ${n} action(s)` : 'Signer', () => signer(signables.filter((a) => r.coches.has(a.cle))), 'principal', n === 0),
        bouton('Abandonner ces retours', () => {
          retoursEnCours = undefined;
          dessiner();
        }),
      ),
    );
  }

  function signer(choisies: ActionRetour[]) {
    if (!choisies.length) return;
    if (!confirm(`Signer ${choisies.length} action(s) issues des retours du terrain ? Chacune sera inscrite séparément au journal.`)) return;
    occupe(`Signature de ${choisies.length} action(s)…`, async () => {
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
      notifier(`${faites} action(s) signée(s) depuis les retours du terrain.`, 'succes');
      await apresModification();
    });
  }

  const ouvrir = bouton('Retours du terrain…', async () => {
    const f = await choisirFichier('.xlsx,.ods,.csv');
    if (!f) return;
    await occupe('Lecture des retours du terrain…', async () => {
      const t = await lireExport(f.octets, f.nom);
      const r = lireRetours(t, session.etat!, alertesCourantes(), colonneGps());
      retoursEnCours = {
        nom: f.nom,
        ...r,
        coches: new Set(r.actions.filter((a) => !a.impossible && !a.avertissement && autorise(a)).map((a) => a.cle)),
      };
      dessiner();
    });
  });
  ouvrir.title = 'Importer l’export des réponses du formulaire Kobo de revisite : l’outil propose les corrections, exclusions et décisions correspondantes';
  dessiner();
  return { ouvrir, panneau };
}
