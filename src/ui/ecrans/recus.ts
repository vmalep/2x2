import { confronterRecu, creerRecu, lireRecu, recuEnTexte, type ResultatRecu } from '../../model/recu.ts';
import { bouton, carte, encadre } from '../composants.ts';
import { dateLisible, h, remplacer, tr } from '../dom.ts';
import { choisirFichier, nomDeFichierSur, telecharger } from '../fichiers.ts';
import { notifier, occupe, rafraichir, session } from '../session.ts';
import { t } from '../../i18n/index.ts';

/** Carte « Reçu de validation » : à produire à la fin de chaque séance, à garder hors du fichier. */
export function carteProduireRecu() {
  const zone = h('div');
  const rappel = session.decisionsDepuisRecu > 0;
  return carte(
    t('recus.titre'),
    rappel
      ? encadre('alerte', tr('recus.rappel', { n: session.decisionsDepuisRecu }))
      : h('p', null, t('recus.texte')),
    h(
      'p',
      { class: 'aide' },
      t('recus.aide'),
    ),
    bouton(t('recus.produire'), () =>
      occupe(t('recus.signature'), async () => {
        const recu = await creerRecu(session.liste!, session.identite!);
        const texte = recuEnTexte(recu);
        session.decisionsDepuisRecu = 0;
        rafraichir();
        // Après le rendu, la carte est reconstruite : on affiche le reçu dans la nouvelle zone.
        const cible = document.getElementById('zone-recu');
        if (!cible) return;
        remplacer(
          cible,
          h('pre', { class: 'recu' }, texte),
          h(
            'div',
            { class: 'ligne' },
            bouton(
              t('recus.copier'),
              async () => {
                try {
                  await navigator.clipboard.writeText(texte);
                  notifier(t('recus.copie'), 'succes');
                } catch {
                  notifier(t('commun.copie_impossible'), 'erreur');
                }
              },
              'principal',
            ),
            bouton(t('recus.telecharger'), () =>
              telecharger(`recu_2x2_${nomDeFichierSur(recu.nom)}_${recu.le.slice(0, 16).replace(/[-:]/g, '').replace('T', '_')}.txt`, texte, 'text/plain'),
            ),
          ),
        );
      }),
    'principal'),
    h('div', { id: 'zone-recu' }, zone),
  );
}

function messageResultat(r: ResultatRecu) {
  const qui = `${r.recu.nom}, ${dateLisible(r.recu.le)}`;
  switch (r.statut) {
    case 'conforme':
      return encadre(
        'ok',
        tr(r.lignesAjoutees ? 'recus.conforme_plus' : 'recus.conforme', { lignes: r.recu.lignes, qui, n: r.lignesAjoutees }),
      );
    case 'tronque':
      return encadre(
        'erreur',
        tr('recus.tronque', { n: r.manquantes, qui, lignes: r.recu.lignes }),
      );
    case 'divergent':
      return encadre('erreur', tr('recus.divergent', { n: r.recu.lignes - 1, qui }));
    case 'autre_liste':
      return encadre('alerte', h('strong', null, t('recus.autre_liste')));
    case 'signature_invalide':
      return encadre('erreur', tr('recus.signature_invalide'));
    case 'auteur_inconnu':
      return encadre('erreur', h('strong', null, t('recus.auteur_inconnu')));
  }
}

/** Confronter le fichier ouvert à un reçu conservé à part (collé ou chargé depuis un fichier). */
export function carteConfronterRecu() {
  const texte = h('textarea', { rows: 4, placeholder: t('recus.coller_placeholder'), 'aria-label': t('recus.texte_recu') });
  const resultat = h('div');
  const confronter = (contenu: string) =>
    occupe(t('recus.verification'), async () => {
      const r = await confronterRecu(session.liste!, session.etat!.utilisateurs, lireRecu(contenu));
      remplacer(resultat, messageResultat(r));
    });
  return carte(
    t('recus.confronter'),
    h('p', null, t('recus.confronter_texte')),
    texte,
    h(
      'div',
      { class: 'ligne' },
      bouton(t('recus.verifier_colle'), () => (texte.value.trim() ? confronter(texte.value) : notifier(t('recus.coller_avant'), 'erreur')), 'principal'),
      bouton(t('recus.charger'), async () => {
        const f = await choisirFichier('.txt,text/plain');
        if (f) confronter(f.texte());
      }),
    ),
    resultat,
  );
}
