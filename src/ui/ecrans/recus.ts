import { confronterRecu, creerRecu, lireRecu, recuEnTexte, type ResultatRecu } from '../../model/recu.ts';
import { bouton, carte, encadre } from '../composants.ts';
import { dateLisible, h, remplacer } from '../dom.ts';
import { choisirFichier, nomDeFichierSur, telecharger } from '../fichiers.ts';
import { notifier, occupe, rafraichir, session } from '../session.ts';

/** Carte « Reçu de validation » : à produire à la fin de chaque séance, à garder hors du fichier. */
export function carteProduireRecu() {
  const zone = h('div');
  const rappel = session.decisionsDepuisRecu > 0;
  return carte(
    'Reçu de validation',
    rappel
      ? encadre('alerte', h('strong', null, `${session.decisionsDepuisRecu} décision(s) depuis votre dernier reçu.`), ' Produisez un reçu avant de fermer la liste.')
      : h('p', null, 'À la fin de chaque séance de validation, produisez un reçu signé et conservez-le en dehors du fichier.'),
    h(
      'p',
      { class: 'aide' },
      'Le reçu atteste le nombre de lignes du journal et l’empreinte de la dernière. Plus tard, il permet de détecter un fichier dont on aurait retiré les dernières lignes.',
    ),
    bouton('Produire mon reçu', () =>
      occupe('Signature du reçu…', async () => {
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
              'Copier le texte',
              async () => {
                try {
                  await navigator.clipboard.writeText(texte);
                  notifier('Reçu copié : envoyez-le par message ou courriel.', 'succes');
                } catch {
                  notifier('Copie impossible : sélectionnez le texte manuellement.', 'erreur');
                }
              },
              'principal',
            ),
            bouton('Télécharger (.txt)', () =>
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
        h('strong', null, 'Reçu conforme. '),
        `Le journal contient bien les ${r.recu.lignes} lignes attestées par ${qui}`,
        r.lignesAjoutees ? `, plus ${r.lignesAjoutees} ligne(s) ajoutée(s) depuis.` : '.',
      );
    case 'tronque':
      return encadre(
        'erreur',
        h('strong', null, `Journal plus court que prévu : ${r.manquantes} ligne(s) manquante(s). `),
        `Le reçu de ${qui} atteste ${r.recu.lignes} lignes. Des lignes ont été supprimées à la fin du journal.`,
      );
    case 'divergent':
      return encadre('erreur', h('strong', null, 'Journal divergent. '), `La ligne ${r.recu.lignes - 1} ne correspond pas au reçu de ${qui}.`);
    case 'autre_liste':
      return encadre('alerte', h('strong', null, 'Ce reçu concerne une autre liste.'));
    case 'signature_invalide':
      return encadre('erreur', h('strong', null, 'Signature du reçu invalide : '), 'le reçu a été modifié ou fabriqué.');
    case 'auteur_inconnu':
      return encadre('erreur', h('strong', null, 'Reçu signé par une clé non déclarée dans cette liste.'));
  }
}

/** Confronter le fichier ouvert à un reçu conservé à part (collé ou chargé depuis un fichier). */
export function carteConfronterRecu() {
  const texte = h('textarea', { rows: 4, placeholder: 'Collez ici le texte du reçu (la ligne « Code : 2X2-RECU-1… » suffit)', 'aria-label': 'Texte du reçu' });
  const resultat = h('div');
  const confronter = (contenu: string) =>
    occupe('Vérification du reçu…', async () => {
      const r = await confronterRecu(session.liste!, session.etat!.utilisateurs, lireRecu(contenu));
      remplacer(resultat, messageResultat(r));
    });
  return carte(
    'Confronter à un reçu de validation',
    h('p', null, 'Vérifiez que le fichier n’a pas perdu de lignes depuis un reçu conservé en dehors du fichier.'),
    texte,
    h(
      'div',
      { class: 'ligne' },
      bouton('Vérifier le texte collé', () => (texte.value.trim() ? confronter(texte.value) : notifier('Collez d’abord le texte du reçu.', 'erreur')), 'principal'),
      bouton('Charger un fichier de reçu…', async () => {
        const f = await choisirFichier('.txt,text/plain');
        if (f) confronter(f.texte());
      }),
    ),
    resultat,
  );
}
