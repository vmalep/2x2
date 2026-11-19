import { badge, bouton, empreinte } from './composants.ts';
import { h, remplacer, type Enfant } from './dom.ts';
import { ecranAlertes } from './ecrans/alertes.ts';
import { ecranExport } from './ecrans/export.ts';
import { ecranAccueil } from './ecrans/accueil.ts';
import { ecranCorrection } from './ecrans/correction.ts';
import { ecranImport } from './ecrans/import.ts';
import { ecranJournal } from './ecrans/journal.ts';
import { ecranValidation } from './ecrans/validation.ts';
import { enregistrementDirect } from './fichiers.ts';
import { alertesCourantes, aller, enregistrer, fermerListe, moi, occupe, session, surRafraichissement, type Ecran } from './session.ts';

const ETAPES: { ecran: Ecran; libelle: string }[] = [
  { ecran: 'import', libelle: 'Import' },
  { ecran: 'correction', libelle: 'Correction' },
  { ecran: 'validation', libelle: 'Validation' },
  { ecran: 'alertes', libelle: 'Alertes' },
  { ecran: 'export', libelle: 'Export' },
];

function navigation(): Enfant {
  const ouverte = !!session.liste;
  const attente = session.etat?.enAttente().length ?? 0;
  const etat = session.etat;
  const alertesOuvertes = etat ? alertesCourantes().filter((a) => !etat.decisionsAlertes.has(a.id)).length : 0;
  return h(
    'nav',
    { class: 'navigation', 'aria-label': 'Étapes' },
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
              onclick: () => aller(e.ecran),
            },
            h('span', { class: 'numero' }, String(i + 1)),
            e.libelle,
            e.ecran === 'validation' && attente > 0 && h('span', { class: 'pastille' }, String(attente)),
            e.ecran === 'alertes' && alertesOuvertes > 0 && h('span', { class: 'pastille' }, String(alertesOuvertes)),
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
          'Journal',
          session.verification && !session.verification.valide && h('span', { class: 'pastille rouge' }, '!'),
        ),
      ),
    ),
    h('p', { class: 'mention-locale' }, 'Traitement local : aucune donnée ne quitte ce poste en clair.'),
  );
}

function entete(): Enfant {
  const { identite, liste, verification } = session;
  const u = moi();
  return h(
    'header',
    { class: 'entete' },
    h('button', { type: 'button', class: 'logo', onclick: () => aller(liste ? 'correction' : 'accueil'), 'aria-label': 'Accueil' }, h('span', { class: 'marque-logo', 'aria-hidden': 'true' }, h('i'), h('i')), '2x2'),
    h('span', { class: 'prototype' }, 'Prototype · données fictives uniquement'),
    h('div', { class: 'espace' }),
    liste &&
      h(
        'div',
        { class: 'etat-liste' },
        verification?.valide ? badge('Journal intègre', 'ok') : badge('Journal altéré', 'refus'),
        h('span', { class: 'nom-liste', title: session.nomFichierListe }, session.nomFichierListe ?? ''),
        session.nonEnregistre && badge('non enregistré', 'attente'),
        bouton(enregistrementDirect && session.poignee ? 'Enregistrer' : 'Enregistrer (télécharger)', () => occupe('Chiffrement…', () => enregistrer()), session.nonEnregistre ? 'principal' : 'secondaire'),
        bouton('Fermer', fermerListe),
      ),
    identite &&
      h(
        'div',
        { class: 'identite' },
        h('strong', null, identite.nom),
        u && h('span', { class: 'discret' }, u.roles.join(', ')),
        h('span', { class: 'petite' }, empreinte(identite.empreinte, 2)),
      ),
  );
}

function ecranCourant(): Enfant {
  if (!session.identite) return ecranAccueil();
  if (!session.liste) return session.ecran === 'import' ? ecranImport() : ecranAccueil();
  switch (session.ecran) {
    case 'import':
      return ecranImport();
    case 'correction':
      return ecranCorrection();
    case 'validation':
      return ecranValidation();
    case 'alertes':
      return ecranAlertes();
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
    if (anciennes) document.getElementById('notifications')!.replaceWith(anciennes);
  });
  dessiner();
}
