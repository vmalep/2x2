/**
 * Écran Validation : un seul tableau pour tout ce qui appelle une décision signée,
 * les corrections proposées (quatre yeux) et les alertes des règles de contrôle.
 * On coche des lignes, on choisit une décision en en-tête, on signe : chaque ligne
 * reçoit sa propre entrée de journal, exactement comme une décision individuelle.
 */
import type { Alerte } from '../../controles/controles.ts';
import { decider, deciderAlerte } from '../../model/journal.ts';
import { CHAMP_STATUT, DECISIONS_ALERTE, libelleMotif } from '../../model/types.ts';
import { badge, bouton, encadre } from '../composants.ts';
import { dateLisible, h, remplacer, type Enfant } from '../dom.ts';
import { alertesCourantes, aller, apresModification, nomAuteur, notifier, occupe, peut, session } from '../session.ts';
import { carteRegles, enqueteurDe, horodatageDe, jourEntretien, peutDecider } from './alertes.ts';
import { comparer } from './correction.ts';
import { carteProduireRecu } from './recus.ts';
import { choixColonnes } from '../colonnes.ts';
import { libelles, t } from '../../i18n/index.ts';

type Nature = 'correction' | 'alerte';

interface Ligne {
  cle: string;
  nature: Nature;
  objet: string;
  menages: string[];
  enqueteur: string;
  /** Jour(s) de l'entretien des ménages concernés (AAAA-MM-JJ, séparés par des virgules). */
  date: string;
  /** Horodatage le plus ancien, pour trier dans la journée. */
  horodatage: string;
  detail: string;
  auteur: string;
  statut: string;
  aDecider: boolean;
  /** Pourquoi la ligne ne peut pas être cochée (vide si elle peut l'être). */
  bloque: string;
  rendreDetail: () => Enfant;
  rendreStatut: () => Enfant;
  correction?: number;
  alerte?: Alerte;
}

/** Clé de colonne : une des colonnes de base, ou « d:<colonne de l'export> » (données des ménages). */
type Colonne = string;

interface DefColonne {
  cle: Colonne;
  titre: string;
  filtre: 'liste' | 'texte';
}

/** Colonnes de base (titres dans la langue courante). */
const COLONNES_BASE = (): DefColonne[] => [
  { cle: 'nature', titre: t('journal.type'), filtre: 'liste' },
  { cle: 'objet', titre: t('validation.col_objet'), filtre: 'liste' },
  { cle: 'menages', titre: t('validation.col_menages'), filtre: 'texte' },
  { cle: 'enqueteur', titre: t('commun.enqueteur'), filtre: 'liste' },
  { cle: 'date', titre: t('commun.date'), filtre: 'liste' },
  { cle: 'detail', titre: t('validation.col_detail'), filtre: 'texte' },
  { cle: 'auteur', titre: t('validation.col_auteur'), filtre: 'liste' },
  { cle: 'statut', titre: t('validation.col_statut'), filtre: 'liste' },
];

const TOUS = '';
const A_DECIDER = '\u0000a_decider';

/** Filtres, tri et sélection : conservés entre deux rendus de l'écran. */
const vue = {
  filtres: { statut: A_DECIDER } as Record<string, string>,
  tri: null as { cle: Colonne; sens: 1 | -1 } | null,
};
const selection = new Set<string>();

const NATURES: Record<Nature, string> = libelles({ correction: 'journal.t_correction', alerte: 'journal.t_decision_alerte' });
const DECISIONS_CORRECTION: Record<string, string> = libelles({ acceptee: 'validation.accepter', refusee: 'validation.refuser' });
const COMMENTAIRE_OBLIGATOIRE = new Set(['refusee', 'confirmee', 'faux_positif']);

/** Ouvre l'écran Validation, éventuellement filtré sur un type de ligne. */
export function allerValidation(nature?: Nature) {
  vue.filtres = { statut: A_DECIDER, ...(nature ? { nature: NATURES[nature] } : {}) };
  // (le filtre « nature » porte le libellé affiché : il est remis à zéro si la langue change)
  aller('validation');
}

function lienMenage(m: string) {
  return h(
    'button',
    {
      type: 'button',
      class: 'lien',
      onclick: () => {
        session.menageSelectionne = m;
        aller('correction');
      },
    },
    m,
  );
}

function datesDe(menages: string[]): { date: string; horodatage: string } {
  const jours = [...new Set(menages.map(jourEntretien).filter(Boolean))].sort();
  const horodatages = menages.map(horodatageDe).filter(Boolean).sort();
  return { date: jours.join(', '), horodatage: horodatages[0] ?? '' };
}

function lignes(): Ligne[] {
  const etat = session.etat!;
  const moiEmpreinte = session.identite?.empreinte;
  const resultat: Ligne[] = [];

  for (const c of etat.corrections.values()) {
    const e = c.entree;
    const k = e.contenu;
    const aDecider = c.statut === 'en_attente';
    const statut = aDecider ? t('validation.a_valider_statut') : c.statut === 'acceptee' ? t('validation.acceptee') : t('validation.refusee');
    resultat.push({
      cle: `c:${e.n}`,
      nature: 'correction',
      objet: k.champ === CHAMP_STATUT ? (k.nouvelle === 'exclu' ? t('validation.exclusion_menage') : t('validation.reintegration_menage')) : t('validation.champ', { champ: k.champ }),
      menages: [k.menage],
      enqueteur: enqueteurDe(k.menage),
      ...datesDe([k.menage]),
      detail: `${k.ancienne} → ${k.nouvelle} ${libelleMotif(k.motif)} ${k.commentaire}`,
      auteur: nomAuteur(e.auteur),
      statut,
      aDecider,
      bloque: !aDecider
        ? t('validation.deja_traitee')
        : !peut('validation')
          ? t('validation.role_validation')
          : e.auteur === moiEmpreinte
            ? t('validation.propre_correction')
            : '',
      rendreDetail: () =>
        h(
          'div',
          null,
          h('div', { class: 'diff' }, h('del', null, k.ancienne || t('commun.vide')), ' → ', h('ins', null, k.nouvelle || t('commun.vide'))),
          h('div', { class: 'discret' }, libelleMotif(k.motif), k.commentaire && t('validation.commentaire', { texte: k.commentaire }), t('validation.numero_date', { n: e.n, date: dateLisible(e.le) })),
        ),
      rendreStatut: () =>
        aDecider
          ? badge(t('validation.a_valider'), 'attente')
          : [
              badge(statut, c.statut === 'acceptee' ? 'ok' : 'refus'),
              c.decision && h('div', { class: 'discret' }, `${nomAuteur(c.decision.auteur)}, ${dateLisible(c.decision.le)}`),
              !!c.decision?.contenu.commentaire && h('div', { class: 'commentaire' }, t('commun.guillemets', { texte: c.decision.contenu.commentaire })),
            ],
      correction: e.n,
    });
  }

  for (const a of alertesCourantes()) {
    const d = etat.decisionsAlertes.get(a.id);
    const options = DECISIONS_ALERTE[a.categorie];
    const statut = d ? (options[d.contenu.decision] ?? d.contenu.decision) : t('validation.alerte_sans_decision');
    resultat.push({
      cle: `a:${a.id}`,
      nature: 'alerte',
      objet: a.libelle,
      menages: a.menages,
      enqueteur: [...new Set(a.menages.map(enqueteurDe).filter(Boolean))].join(', '),
      ...datesDe(a.menages),
      detail: a.message,
      auteur: '',
      statut,
      aDecider: !d,
      bloque: peutDecider() ? '' : t('validation.role_decider'),
      rendreDetail: () => a.message,
      rendreStatut: () =>
        d
          ? [
              badge(statut, d.contenu.decision === 'confirmee' ? 'alerte' : 'ok'),
              h('div', { class: 'discret' }, `${nomAuteur(d.auteur)}, ${dateLisible(d.le)}`),
              !!d.contenu.commentaire && h('div', { class: 'commentaire' }, t('commun.guillemets', { texte: d.contenu.commentaire })),
            ]
          : badge(t('commun.sans_decision'), 'attente'),
      alerte: a,
    });
  }
  return resultat;
}

function valeurColonne(l: Ligne, c: Colonne): string {
  if (c.startsWith('d:')) {
    const col = c.slice(2);
    return [...new Set(l.menages.map((m) => session.etat!.valeur(m, col) ?? '').filter(Boolean))].join(', ');
  }
  switch (c) {
    case 'nature':
      return NATURES[l.nature];
    case 'menages':
      return l.menages.join(' ');
    default:
      return String((l as unknown as Record<string, unknown>)[c] ?? '');
  }
}

const comparateur = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });

function filtrerTrier(toutes: Ligne[], colonnes: DefColonne[]): Ligne[] {
  const f = vue.filtres;
  const retenues = toutes.filter((l) =>
    colonnes.every(({ cle, filtre }) => {
      const v = f[cle];
      if (!v) return true;
      if (cle === 'statut' && v === A_DECIDER) return l.aDecider;
      if (cle === 'enqueteur') return l.enqueteur.split(', ').includes(v);
      if (cle === 'date') return l.date.split(', ').includes(v);
      return filtre === 'texte' ? valeurColonne(l, cle).toLowerCase().includes(v.toLowerCase()) : valeurColonne(l, cle) === v;
    }),
  );
  const tri = vue.tri;
  const cleTri = (l: Ligne, c: Colonne) => (c === 'date' ? l.horodatage : valeurColonne(l, c));
  if (tri) retenues.sort((a, b) => tri.sens * comparateur.compare(cleTri(a, tri.cle), cleTri(b, tri.cle)));
  return retenues;
}

/** Décisions proposées pour la sélection : il faut que toutes les lignes cochées soient de même type. */
function decisionsPour(choisies: Ligne[]): { options: Record<string, string>; message?: string } {
  const natures = new Set(choisies.map((l) => l.nature));
  if (natures.size === 0) return { options: {}, message: t('validation.cochez_lignes') };
  if (natures.size > 1) {
    return { options: {}, message: t('validation.melange') };
  }
  return { options: natures.has('correction') ? DECISIONS_CORRECTION : DECISIONS_ALERTE.integrite };
}

export function ecranValidation() {
  const etat = session.etat!;
  const toutes = lignes();
  // Colonnes affichées : celles de base, et au choix des données des ménages (village, nom…).
  const o = session.liste!.original;
  const choixCols = choixColonnes(
    `2x2-colonnes-validation-${o.empreinteFichier}`,
    [
      ...COLONNES_BASE().map((c) => ({ cle: c.cle, libelle: c.titre, groupe: t('validation.groupe_base'), obligatoire: c.cle === 'menages' || c.cle === 'statut' })),
      ...o.colonnes.filter((c) => c !== o.colonneId).map((c) => ({ cle: `d:${c}`, libelle: c, groupe: t('validation.groupe_donnees') })),
    ],
    COLONNES_BASE().map((c) => c.cle),
    () => aller('validation'),
  );
  const COLONNES: DefColonne[] = choixCols.visibles().map(
    (k) => COLONNES_BASE().find((c) => c.cle === k) ?? { cle: k, titre: k.slice(2), filtre: 'texte' as const },
  );
  for (const k of Object.keys(vue.filtres)) if (!COLONNES.some((c) => c.cle === k)) delete vue.filtres[k];
  if (vue.tri && !COLONNES.some((c) => c.cle === vue.tri!.cle)) vue.tri = null;
  const corrAttente = toutes.filter((l) => l.nature === 'correction' && l.aDecider).length;
  const alertesAttente = toutes.filter((l) => l.nature === 'alerte' && l.aDecider).length;
  const decidees = toutes.filter((l) => !l.aDecider).length;

  // Les cases cochées qui ne correspondent plus à une ligne disparaissent.
  const cles = new Set(toutes.map((l) => l.cle));
  for (const k of [...selection]) if (!cles.has(k)) selection.delete(k);

  const zoneTableau = h('div', { class: 'cadre-tableau' });
  const compteur = h('strong');
  const message = h('p', { class: 'aide' });
  const choix = h('select', { 'aria-label': t('validation.decision_selection') });
  const commentaire = h('input', { type: 'text', placeholder: t('validation.commentaire_placeholder'), 'aria-label': t('commun.commentaire') });
  const signer = bouton(t('commun.signer'), () => signerSelection(), 'principal');
  let affichees: Ligne[] = [];

  const choisies = () => toutes.filter((l) => selection.has(l.cle) && !l.bloque);

  const majBarre = () => {
    const c = choisies();
    const visibles = affichees.filter((l) => selection.has(l.cle)).length;
    compteur.textContent = t('validation.cochees', { n: c.length }) + (c.length !== visibles ? t('validation.hors_filtre', { n: c.length - visibles }) : '');
    const { options, message: m } = decisionsPour(c);
    const avant = choix.value;
    remplacer(choix, h('option', { value: '' }, t('commun.choix_decision')), Object.entries(options).map(([v, l]) => h('option', { value: v, selected: v === avant }, l)));
    choix.disabled = !Object.keys(options).length;
    message.textContent = m ?? '';
    signer.textContent = c.length ? t('validation.signer_pour', { n: c.length }) : t('commun.signer');
    signer.toggleAttribute('disabled', !Object.keys(options).length);
    majCommentaire();
  };
  const majCommentaire = () => {
    commentaire.placeholder = COMMENTAIRE_OBLIGATOIRE.has(choix.value)
      ? t('commun.commentaire_obligatoire')
      : t('validation.commentaire_placeholder');
  };
  choix.addEventListener('change', majCommentaire);

  const signerSelection = () => {
    const c = choisies();
    if (!c.length) return notifier(t('validation.cochez_avant'), 'erreur');
    if (!choix.value) return notifier(t('commun.choisir_decision'), 'erreur');
    if (COMMENTAIRE_OBLIGATOIRE.has(choix.value) && !commentaire.value.trim()) {
      commentaire.focus();
      return notifier(t('commun.decision_motivee'), 'erreur');
    }
    const libelle = choix.selectedOptions[0]?.textContent ?? choix.value;
    const horsFiltre = c.filter((l) => !affichees.includes(l)).length;
    if (
      !confirm(
        t(horsFiltre ? 'validation.confirmer_masquees' : 'validation.confirmer', { libelle, n: c.length, masquees: horsFiltre }),
      )
    ) {
      return;
    }
    const decision = choix.value;
    const texte = commentaire.value.trim();
    occupe(t('validation.signature', { n: c.length }), async () => {
      for (const l of c) {
        if (l.correction !== undefined) {
          await decider(session.liste!, etat, session.identite!, { correction: l.correction, decision: decision as 'acceptee' | 'refusee', commentaire: texte });
          session.decisionsDepuisRecu++;
        } else if (l.alerte) {
          const a = l.alerte;
          await deciderAlerte(session.liste!, etat, session.identite!, { alerte: a.id, categorie: a.categorie, menages: a.menages, decision, commentaire: texte });
          session.decisionsDepuisRecu++;
        }
        selection.delete(l.cle);
      }
      notifier(t('validation.signees', { n: c.length }), 'succes');
      await apresModification();
    });
  };

  // Ligne de filtres : créée une fois, pour ne pas perdre la saisie en cours.
  const valeursDistinctes = (c: Colonne) => {
    const n = new Map<string, number>();
    for (const l of toutes) {
      const vals = c === 'enqueteur' || c === 'date' ? valeurColonne(l, c).split(', ').filter(Boolean) : [valeurColonne(l, c)];
      for (const v of vals) if (v) n.set(v, (n.get(v) ?? 0) + 1);
    }
    return [...n].sort(([a], [b]) => comparateur.compare(a, b));
  };
  const filtres = COLONNES.map(({ cle, titre, filtre }) => {
    if (filtre === 'texte') {
      return h('input', {
        type: 'search',
        placeholder: t('commun.filtrer'),
        'aria-label': t('commun.filtrer_col', { titre }),
        value: vue.filtres[cle] ?? '',
        oninput: (e: Event) => {
          vue.filtres[cle] = (e.target as HTMLInputElement).value;
          dessiner();
        },
      });
    }
    const valeurs = valeursDistinctes(cle);
    const courant = vue.filtres[cle] ?? TOUS;
    if (courant && courant !== A_DECIDER && !valeurs.some(([v]) => v === courant)) vue.filtres[cle] = TOUS;
    return h(
      'select',
      {
        'aria-label': t('commun.filtrer_col', { titre }),
        onchange: (e: Event) => {
          vue.filtres[cle] = (e.target as HTMLSelectElement).value;
          dessiner();
        },
      },
      h('option', { value: TOUS, selected: !vue.filtres[cle] }, t('commun.tous')),
      cle === 'statut' && h('option', { value: A_DECIDER, selected: vue.filtres[cle] === A_DECIDER }, t('validation.a_decider')),
      valeurs.map(([v, n]) => h('option', { value: v, selected: vue.filtres[cle] === v }, `${v} (${n})`)),
    );
  });

  const enTetes = COLONNES.map(({ cle, titre }) => {
    const b = h('button', {
      type: 'button',
      class: 'tri',
      title: t('commun.trier'),
      onclick: () => {
        vue.tri = vue.tri?.cle !== cle ? { cle, sens: 1 } : vue.tri.sens === 1 ? { cle, sens: -1 } : null;
        dessiner();
      },
    });
    return { cle, titre, b };
  });

  const caseTout = h('input', {
    type: 'checkbox',
    'aria-label': t('validation.cocher_tout'),
    title: t('validation.cocher_tout_titre'),
    onchange: (e: Event) => {
      const oui = (e.target as HTMLInputElement).checked;
      for (const l of affichees) if (!l.bloque && l.aDecider) oui ? selection.add(l.cle) : selection.delete(l.cle);
      dessiner();
    },
  });

  const thead = h(
    'thead',
    null,
    h('tr', null, h('th', { class: 'col-case' }, caseTout), enTetes.map(({ b }) => h('th', null, b))),
    h('tr', { class: 'filtres' }, h('th', { class: 'col-case' }), filtres.map((f) => h('th', null, f))),
  );

  function celluleValidation(l: Ligne, cle: Colonne) {
    switch (cle) {
      case 'nature':
        return h('td', null, badge(NATURES[l.nature], l.nature === 'correction' ? 'neutre' : 'alerte'));
      case 'objet':
        return h('td', null, l.objet);
      case 'menages':
        return h(
          'td',
          { class: 'menages' },
          l.menages.map((m, i) => [i > 0 && ' ', lienMenage(m)]),
          l.alerte &&
            l.menages.length > 1 &&
            h('div', null, h('button', { type: 'button', class: 'lien petit', onclick: () => comparer(l.menages, l.alerte!.id) }, t('validation.comparer'))),
        );
      case 'enqueteur':
        return h('td', null, l.enqueteur);
      case 'date':
        return h('td', { class: 'date' }, l.date.split(', ').map((d, i) => [i > 0 && h('br'), d]));
      case 'detail':
        return h('td', { class: 'detail' }, l.rendreDetail());
      case 'auteur':
        return h('td', null, l.auteur);
      case 'statut':
        return h('td', { class: 'statut' }, l.rendreStatut());
      default:
        // Données des ménages : une valeur par ménage concerné (une ligne chacune).
        return h('td', null, l.menages.map((m, i) => [i > 0 && h('br'), etat.valeur(m, cle.slice(2)) ?? '']));
    }
  }

  function rendreLigne(l: Ligne) {
    const coche = selection.has(l.cle);
    return h(
      'tr',
      { class: `${coche ? 'selection' : ''}${l.aDecider ? '' : ' decidee'}` },
      h(
        'td',
        { class: 'col-case' },
        h('input', {
          type: 'checkbox',
          checked: coche && !l.bloque,
          disabled: !!l.bloque,
          title: l.bloque || undefined,
          'aria-label': t('validation.cocher_ligne', { nature: NATURES[l.nature].toLowerCase(), objet: l.objet, menages: l.menages.join(', ') }),
          onchange: (e: Event) => {
            (e.target as HTMLInputElement).checked ? selection.add(l.cle) : selection.delete(l.cle);
            (e.target as HTMLElement).closest('tr')?.classList.toggle('selection', selection.has(l.cle));
            majBarre();
            majCaseTout();
          },
        }),
      ),
      COLONNES.map(({ cle }) => celluleValidation(l, cle)),
    );
  }

  const majCaseTout = () => {
    // « Tout cocher » ne prend que les lignes à décider : une décision prise se révise ligne par ligne.
    const cochables = affichees.filter((l) => !l.bloque && l.aDecider);
    const n = cochables.filter((l) => selection.has(l.cle)).length;
    caseTout.checked = n > 0 && n === cochables.length;
    caseTout.indeterminate = n > 0 && n < cochables.length;
    caseTout.disabled = cochables.length === 0;
  };

  function dessiner() {
    affichees = filtrerTrier(toutes, COLONNES);
    for (const { cle, titre, b } of enTetes) {
      b.textContent = `${titre}${vue.tri?.cle === cle ? (vue.tri.sens === 1 ? ' ▲' : ' ▼') : ''}`;
    }
    remplacer(
      zoneTableau,
      h(
        'table',
        { class: 'tableau validation' },
        thead,
        h(
          'tbody',
          null,
          affichees.length
            ? affichees.map(rendreLigne)
            : h('tr', null, h('td', { colspan: COLONNES.length + 1, class: 'vide' }, t('validation.aucune_ligne'))),
        ),
      ),
    );
    resume.textContent = t('validation.affichees', { n: affichees.length, total: toutes.length });
    majCaseTout();
    majBarre();
  }

  const resume = h('span', { class: 'discret' });

  const peutAgir = peut('validation') || peutDecider();
  const barre =
    peutAgir &&
    h(
      'div',
      { class: 'barre-groupe statique', id: 'barre-decision' },
      h('div', { class: 'ligne' }, compteur, bouton(t('commun.tout_decocher'), () => (selection.clear(), dessiner()))),
      h('div', { class: 'actions' }, choix, commentaire, signer),
      message,
    );

  dessiner();

  return [
    h('h1', null, t('nav.validation')),
    h(
      'p',
      { class: 'intro' },
      t('validation.intro'),
    ),
    h(
      'div',
      { class: 'compteurs' },
      h('div', { class: 'compteur attente' }, h('span', { class: 'nombre' }, String(corrAttente)), t('validation.compteur_corrections')),
      h('div', { class: 'compteur attente' }, h('span', { class: 'nombre' }, String(alertesAttente)), t('validation.compteur_alertes')),
      h('div', { class: 'compteur ok' }, h('span', { class: 'nombre' }, String(decidees)), t('validation.compteur_decidees')),
    ),
    !peutAgir && encadre('info', t('validation.lecture_seule')),
    carteRegles(alertesCourantes()),
    barre,
    h(
      'div',
      { class: 'ligne entre' },
      resume,
      h(
        'div',
        { class: 'ligne serree' },
        choixCols.ouvrir,
        bouton(t('commun.reinitialiser'), () => {
          vue.filtres = { statut: A_DECIDER };
          vue.tri = null;
          aller('validation');
        }),
      ),
    ),
    choixCols.panneau,
    zoneTableau,
    h('p', { class: 'aide' }, t('validation.aide')),
    // Toute personne qui signe des décisions (validation ou responsable) peut produire son reçu.
    (peut('validation') || peutDecider()) && carteProduireRecu(),
  ];
}
