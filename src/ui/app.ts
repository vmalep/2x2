import { badge, bouton, empreinte } from './composants.ts';
import { h, remplacer, type Enfant } from './dom.ts';
import { ecranAide } from './ecrans/aide.ts';
import { ecranExport } from './ecrans/export.ts';
import { ecranAccueil } from './ecrans/accueil.ts';
import { ecranCorrection } from './ecrans/correction.ts';
import { ecranImport } from './ecrans/import.ts';
import { ecranJournal } from './ecrans/journal.ts';
import { ecranValidation } from './ecrans/validation.ts';
import { enregistrementDirect } from './fichiers.ts';
import { suivreHauteur } from './hauteurs.ts';
import { alertesCourantes, aller, enregistrer, versionListe, fermerListe, moi, occupe, rafraichir, session, surRafraichissement, type Ecran } from './session.ts';
import { LIBELLES_ROLES } from '../model/types.ts';
import { LANGUES, NOMS_LANGUES, langueCourante, t, type Cle, type Langue } from '../i18n/index.ts';
import { choisirLangue } from './langue.ts';

const ETAPES: { ecran: Ecran; libelle: Cle }[] = [
  { ecran: 'import', libelle: 'nav.import' },
  { ecran: 'correction', libelle: 'nav.correction' },
  { ecran: 'validation', libelle: 'nav.validation' },
  { ecran: 'export', libelle: 'nav.export' },
];

function navigation(): Enfant {
  const ouverte = !!session.liste;
  const attente = session.etat?.enAttente().length ?? 0;
  const etat = session.etat;
  const alertesOuvertes = etat ? alertesCourantes().filter((a) => !etat.decisionsAlertes.has(a.id)).length : 0;
  return h(
    'nav',
    { class: 'navigation', 'aria-label': t('nav.etapes') },
    h(
      'ol',
      null,
      ETAPES.map((e, i) =>
        h(
          'li',
          null,
          h(
            'button',
            {
              type: 'button',
              class: session.ecran === e.ecran ? 'actif' : '',
              'aria-current': session.ecran === e.ecran ? 'page' : undefined,
              disabled: !ouverte && e.ecran !== 'import',
              onclick: () => {
                session.comparaison = undefined;
                aller(e.ecran);
              },
            },
            h('span', { class: 'numero' }, String(i + 1)),
            t(e.libelle),
            e.ecran === 'validation' && attente + alertesOuvertes > 0 && h('span', { class: 'pastille' }, String(attente + alertesOuvertes)),
          ),
        ),
      ),
      h(
        'li',
        { class: 'separe' },
        h(
          'button',
          { type: 'button', class: session.ecran === 'journal' ? 'actif' : '', disabled: !ouverte, onclick: () => aller('journal') },
          h('span', { class: 'numero' }, '≡'),
          t('nav.journal'),
          session.verification && !session.verification.valide && h('span', { class: 'pastille rouge' }, '!'),
        ),
      ),
      h(
        'li',
        null,
        h(
          'button',
          { type: 'button', class: session.ecran === 'aide' ? 'actif' : '', onclick: () => aller('aide') },
          h('span', { class: 'numero' }, '?'),
          t('nav.aide'),
        ),
      ),
    ),
    h('p', { class: 'mention-locale' }, t('nav.local')),
  );
}

function entete(): Enfant {
  const { identite, liste, verification } = session;
  const u = moi();
  return h(
    'header',
    { class: 'entete' },
    h('button', { type: 'button', class: 'logo', onclick: () => aller(liste ? 'correction' : 'accueil'), 'aria-label': t('entete.accueil') }, h('span', { class: 'marque-logo', 'aria-hidden': 'true' }, h('i'), h('i')), '2x2', h('span', { class: 'version', title: t('entete.version_outil') }, `v${__VERSION__}`)),
    h('span', { class: 'prototype' }, t('entete.prototype')),
    h('div', { class: 'espace' }),
    choixLangue(),
    !identite && h('button', { type: 'button', class: `lien${session.ecran === 'aide' ? ' actif' : ''}`, onclick: () => aller('aide') }, t('nav.aide')),
    liste &&
      h(
        'div',
        { class: 'etat-liste' },
        verification?.valide ? badge(t('entete.journal_integre'), 'ok') : badge(t('entete.journal_altere'), 'refus'),
        h('span', { class: 'nom-liste', title: session.nomFichierListe }, session.nomFichierListe ?? ''),
        (() => {
          const v = versionListe(liste);
          return h('span', { class: 'version-liste', title: t('entete.version_liste', { n: v.numero }) }, v.texte);
        })(),
        session.nonEnregistre && badge(t('entete.non_enregistre'), 'attente'),
        bouton(enregistrementDirect ? t('entete.enregistrer') : t('entete.enregistrer_telecharger'), () => occupe(t('entete.chiffrement'), () => enregistrer()), session.nonEnregistre ? 'principal' : 'secondaire'),
        bouton(t('commun.fermer'), fermerListe),
      ),
    identite &&
      h(
        'div',
        { class: 'identite' },
        h('strong', null, identite.nom),
        u && h('span', { class: 'discret' }, u.roles.map((r) => LIBELLES_ROLES[r]).join(', ')),
        h('span', { class: 'petite' }, empreinte(identite.empreinte, 2)),
      ),
  );
}

/** Sélecteur FR / EN de l'en-tête : la page est redessinée dans la langue choisie. */
function choixLangue(): Enfant {
  return h(
    'select',
    {
      class: 'choix-langue',
      'aria-label': t('langue.choix'),
      title: t('langue.choix'),
      onchange: (e: Event) => {
        choisirLangue((e.target as HTMLSelectElement).value as Langue);
        rafraichir();
      },
    },
    LANGUES.map((l) => h('option', { value: l, selected: l === langueCourante(), title: NOMS_LANGUES[l] }, l.toUpperCase())),
  );
}

function ecranCourant(): Enfant {
  if (session.ecran === 'aide') return ecranAide();
  if (!session.identite) return ecranAccueil();
  if (!session.liste) return session.ecran === 'import' ? ecranImport() : ecranAccueil();
  switch (session.ecran) {
    case 'import':
      return ecranImport();
    case 'correction':
      return ecranCorrection();
    case 'validation':
      return ecranValidation();
    case 'export':
      return ecranExport();
    case 'journal':
      return ecranJournal();
    default:
      return ecranCorrection();
  }
}

export function demarrer(racine: HTMLElement) {
  const dessiner = () => {
    remplacer(
      racine,
      entete(),
      h('div', { class: 'corps' }, session.identite && navigation(), h('main', { id: 'contenu', tabindex: -1 }, ecranCourant())),
      h('div', { id: 'notifications', 'aria-live': 'polite' }),
      h('div', { id: 'voile', hidden: true }, h('div', { class: 'boite' }, h('div', { class: 'roue' }), h('p', { class: 'message' }))),
    );
  };
  // Les notifications survivent aux rendus : on déplace la zone existante.
  surRafraichissement(() => {
    const anciennes = document.getElementById('notifications');
    dessiner();
    suivreEntete();
    if (anciennes) document.getElementById('notifications')!.replaceWith(anciennes);
  });
  dessiner();
  suivreEntete();
}

function suivreEntete() {
  const e = document.querySelector<HTMLElement>('.entete');
  if (e) suivreHauteur(e, '--haut-entete');
}
