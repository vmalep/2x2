import { decider, type CorrectionSuivie } from '../../model/journal.ts';
import { bouton, encadre } from '../composants.ts';
import { dateLisible, h } from '../dom.ts';
import { apresModification, aller, nomAuteur, notifier, occupe, peut, session } from '../session.ts';
import { ligneHistorique } from './correction.ts';
import { carteProduireRecu } from './recus.ts';

function carteAttente(c: CorrectionSuivie) {
  const e = c.entree;
  const miennes = e.auteur === session.identite?.empreinte;
  const commentaire = h('input', { type: 'text', placeholder: 'Commentaire (obligatoire pour un refus)', 'aria-label': 'Commentaire de décision' });
  const decision = (d: 'acceptee' | 'refusee') => {
    if (d === 'refusee' && !commentaire.value.trim()) {
      commentaire.focus();
      return notifier('Indiquez la raison du refus en commentaire.', 'erreur');
    }
    occupe('Signature de la décision…', async () => {
      await decider(session.liste!, session.etat!, session.identite!, { correction: e.n, decision: d, commentaire: commentaire.value.trim() });
      session.decisionsDepuisRecu++;
      notifier(d === 'acceptee' ? `Correction n° ${e.n} acceptée.` : `Correction n° ${e.n} refusée.`, 'succes');
      await apresModification();
    });
  };
  return h(
    'article',
    { class: `carte-validation${miennes ? ' bloquee' : ''}` },
    h(
      'header',
      null,
      h(
        'button',
        {
          class: 'lien',
          type: 'button',
          onclick: () => {
            session.menageSelectionne = e.contenu.menage;
            aller('correction');
          },
        },
        `Ménage ${e.contenu.menage}`,
      ),
      h('span', { class: 'discret' }, ` · ${e.contenu.champ} · n° ${e.n}`),
    ),
    h('div', { class: 'diff grand' }, h('del', null, e.contenu.ancienne || '(vide)'), ' → ', h('ins', null, e.contenu.nouvelle || '(vide)')),
    h('div', null, h('strong', null, e.contenu.motif), e.contenu.commentaire && ` — « ${e.contenu.commentaire} »`),
    h('div', { class: 'discret' }, `Proposée par ${nomAuteur(e.auteur)}, ${dateLisible(e.le)}`),
    miennes
      ? encadre('alerte', 'Vous êtes l’auteur de cette correction : une autre personne doit la valider (principe des quatre yeux).')
      : h('div', { class: 'actions' }, commentaire, bouton('Accepter', () => decision('acceptee'), 'principal'), bouton('Refuser', () => decision('refusee'), 'danger')),
  );
}

export function ecranValidation() {
  const etat = session.etat!;
  const toutes = [...etat.corrections.values()];
  const attente = toutes.filter((c) => c.statut === 'en_attente');
  const acceptees = toutes.filter((c) => c.statut === 'acceptee').length;
  const refusees = toutes.filter((c) => c.statut === 'refusee').length;
  const traitees = toutes.filter((c) => c.statut !== 'en_attente').reverse();
  return [
    h('h1', null, 'Validation'),
    h(
      'div',
      { class: 'compteurs' },
      h('div', { class: 'compteur attente' }, h('span', { class: 'nombre' }, String(attente.length)), 'en attente'),
      h('div', { class: 'compteur ok' }, h('span', { class: 'nombre' }, String(acceptees)), 'acceptées'),
      h('div', { class: 'compteur refus' }, h('span', { class: 'nombre' }, String(refusees)), 'refusées'),
    ),
    !peut('validation') && encadre('info', 'Lecture seule : vous n’avez pas le rôle « Validation » dans cette liste.'),
    attente.length === 0
      ? encadre('ok', 'Aucune correction en attente.')
      : peut('validation')
        ? h('div', { class: 'pile' }, attente.map(carteAttente))
        : h('ul', { class: 'liste-historique' }, attente.map(ligneHistorique)),
    peut('validation') && carteProduireRecu(),
    traitees.length > 0 && [h('h2', null, 'Déjà traitées'), h('ul', { class: 'liste-historique' }, traitees.map(ligneHistorique))],
  ];
}
