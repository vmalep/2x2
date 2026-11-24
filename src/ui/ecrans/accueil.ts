import { clePubliqueEnTexte, deverrouillerIdentite, fichierClePublique, genererIdentite } from '../../crypto/cles.ts';
import { MotDePasseIncorrect, type EnveloppeChiffree } from '../../crypto/chiffrement.ts';
import { genererDonneesFictives } from '../../gen/fictif.ts';
import { ecrireCsv } from '../../io/csv.ts';
import { ecrireXlsx } from '../../io/xlsx.ts';
import { bouton, carte, champ, empreinte, encadre, motDePasse } from '../composants.ts';
import { dateLisible, h } from '../dom.ts';
import { choisirFichier, nomDeFichierSur, telecharger } from '../fichiers.ts';
import { aller, notifier, occupe, ouvrirListe, rafraichir, session } from '../session.ts';
import { effacerSecours, lireSecours } from '../secours.ts';

const LONGUEUR_MIN = 12;

function ecranIdentite() {
  // --- Créer ma clé ---
  const nom = h('input', { type: 'text', autocomplete: 'name', placeholder: 'Prénom Nom' });
  const mdp1 = motDePasse('', 'new-password');
  const mdp2 = motDePasse('', 'new-password');
  const creer = h(
    'form',
    {
      onsubmit: (e: Event) => {
        e.preventDefault();
        if (mdp1.value.length < LONGUEUR_MIN) return notifier(`Le mot de passe doit compter au moins ${LONGUEUR_MIN} caractères.`, 'erreur');
        if (mdp1.value !== mdp2.value) return notifier('Les deux mots de passe ne correspondent pas.', 'erreur');
        occupe('Génération de la clé…', async () => {
          const { fichierCle, identite } = await genererIdentite(nom.value, mdp1.value);
          // Un seul fichier ici : la clé privée, qui reste chez vous. La clé publique se transmet ensuite.
          telecharger(`2x2_cle_privee_${nomDeFichierSur(identite.nom)}.2x2cle`, JSON.stringify(fichierCle), 'application/json');
          session.identite = identite;
          session.cleNouvelle = true;
          notifier('Clé créée : votre clé privée a été enregistrée.', 'succes');
          rafraichir();
        });
      },
    },
    champ('Votre nom', nom),
    champ(
      'Mot de passe de la clé',
      mdp1,
      `Au moins ${LONGUEUR_MIN} caractères. Notez-le en lieu sûr : s’il est perdu, la clé ne peut pas être récupérée. Ne le communiquez à personne.`,
    ),
    champ('Confirmer le mot de passe', mdp2),
    h('button', { type: 'submit', class: 'bouton principal' }, 'Créer ma clé'),
  );

  // --- Ouvrir ma clé ---
  let fichierCle: EnveloppeChiffree | undefined;
  const nomFichier = h('span', { class: 'discret' }, 'Aucun fichier choisi');
  const mdp = motDePasse();
  const ouvrir = h(
    'form',
    {
      onsubmit: (e: Event) => {
        e.preventDefault();
        if (!fichierCle) return notifier('Choisissez d’abord votre fichier de clé (.2x2cle).', 'erreur');
        occupe('Déverrouillage de la clé…', async () => {
          try {
            session.identite = await deverrouillerIdentite(fichierCle!, mdp.value);
          } catch (e) {
            if (!(e instanceof MotDePasseIncorrect)) throw e;
            return notifier(
              'Mot de passe incorrect. S’il est perdu, cette clé est inutilisable : créez une nouvelle clé et envoyez la nouvelle clé publique au responsable de la liste.',
              'erreur',
            );
          }
          notifier(`Bonjour ${session.identite.nom}.`, 'succes');
          rafraichir();
        });
      },
    },
    h(
      'div',
      { class: 'champ' },
      h('label', null, 'Fichier de clé personnelle'),
      h(
        'div',
        { class: 'ligne' },
        bouton('Choisir…', async () => {
          const f = await choisirFichier('.2x2cle,application/json');
          if (!f) return;
          try {
            fichierCle = JSON.parse(f.texte());
            nomFichier.textContent = f.nom;
          } catch {
            notifier('Fichier de clé illisible.', 'erreur');
          }
        }),
        nomFichier,
      ),
    ),
    champ('Mot de passe de la clé', mdp),
    h('button', { type: 'submit', class: 'bouton principal' }, 'Déverrouiller'),
  );

  return [
    h('h1', null, 'Votre clé personnelle'),
    h(
      'p',
      { class: 'intro' },
      'Chaque personne signe ses actions avec sa propre clé. La clé privée reste sur votre poste, chiffrée par votre mot de passe. ' +
        'Seule la clé publique est transmise au responsable de la liste.',
    ),
    lireSecours() &&
      encadre(
        'alerte',
        h('strong', null, 'Une liste non enregistrée a été retrouvée dans ce navigateur.'),
        ' Déverrouillez votre clé pour la reprendre.',
      ),
    h('div', { class: 'grille-2' }, carte('J’ai déjà une clé', ouvrir), carte('Créer ma clé', creer)),
    donneesFictives(),
  ];
}

/** Reprise du travail non enregistré (copie de secours chiffrée gardée par le navigateur). */
function carteReprise() {
  const s = lireSecours();
  if (!s) return null;
  const mdp = motDePasse('', 'new-password');
  mdp.setAttribute('data-lpignore', 'true');
  return h(
    'section',
    { class: 'carte reprise' },
    h('h2', null, 'Travail non enregistré retrouvé'),
    h(
      'p',
      null,
      'La liste ',
      h('strong', null, s.nomFichier),
      ` (version ${s.version}) a été modifiée le ${dateLisible(s.le)} sans être enregistrée. Une copie chiffrée a été gardée par ce navigateur.`,
    ),
    h(
      'form',
      {
        onsubmit: (e: Event) => {
          e.preventDefault();
          occupe('Déchiffrement et vérification du journal…', async () => {
            await ouvrirListe(s.contenu, s.nomFichier, mdp.value, true);
            notifier('Travail repris. Enregistrez la liste pour obtenir le fichier à jour.', 'succes');
            rafraichir();
          });
        },
      },
      champ('Mot de passe de cette liste', mdp),
      h(
        'div',
        { class: 'ligne' },
        h('button', { type: 'submit', class: 'bouton principal' }, 'Reprendre'),
        bouton('Abandonner ces modifications', () => {
          if (!confirm('Supprimer définitivement cette copie ? Les modifications non enregistrées seront perdues.')) return;
          effacerSecours();
          rafraichir();
        }),
      ),
    ),
  );
}

function ecranChoixListe() {
  const id = session.identite!;
  let fichier: { nom: string; texte: string } | undefined;
  const nomFichier = h('span', { class: 'discret' }, 'Aucun fichier choisi');
  // Pas de saisie automatique : le navigateur proposerait le mot de passe de la clé, qui n'est pas celui de la liste.
  const mdp = motDePasse('', 'new-password'); // « off » est ignoré par Firefox pour les mots de passe.
  mdp.setAttribute('data-lpignore', 'true');
  const ouvrir = h(
    'form',
    {
      onsubmit: (e: Event) => {
        e.preventDefault();
        if (!fichier) return notifier('Choisissez d’abord un fichier de liste (.2x2).', 'erreur');
        occupe('Déchiffrement et vérification du journal…', async () => {
          await ouvrirListe(fichier!.texte, fichier!.nom, mdp.value);
          rafraichir();
        });
      },
    },
    h(
      'div',
      { class: 'champ' },
      h('label', null, 'Fichier de liste chiffré'),
      h(
        'div',
        { class: 'ligne' },
        bouton('Choisir…', async () => {
          const f = await choisirFichier('.2x2,application/json');
          if (!f) return;
          fichier = { nom: f.nom, texte: f.texte() };
          nomFichier.textContent = f.nom;
        }),
        nomFichier,
      ),
    ),
    champ('Mot de passe de la liste', mdp),
    h('button', { type: 'submit', class: 'bouton principal' }, 'Ouvrir et vérifier'),
  );

  return [
    h('h1', null, `Bonjour ${id.nom}`),
    session.cleNouvelle &&
      encadre(
        'ok',
        h('strong', null, 'Votre clé est créée.'),
        h(
          'ol',
          null,
          h('li', null, 'Votre ', h('strong', null, 'clé privée'), ' (fichier .2x2cle) vient d’être enregistrée. Gardez-la en lieu sûr, avec son mot de passe. Elle ne se transmet jamais.'),
          h('li', null, 'Transmettez maintenant votre ', h('strong', null, 'clé publique'), ' au responsable de la liste, avec les boutons ci-dessous.'),
        ),
      ),
    encadre(
      'info',
      h('p', null, h('strong', null, 'Votre clé publique'), ' — empreinte : ', empreinte(id.empreinte)),
      h(
        'div',
        { class: 'ligne' },
        bouton(
          'Copier ma clé publique (texte)',
          async () => {
            try {
              await navigator.clipboard.writeText(clePubliqueEnTexte(fichierClePublique(id)));
              notifier('Clé publique copiée : collez-la dans un message au responsable.', 'succes');
            } catch {
              notifier('Copie impossible : utilisez plutôt le fichier.', 'erreur');
            }
          },
          'principal',
        ),
        bouton('Télécharger ma clé publique (.json)', () =>
          telecharger(`2x2_cle_publique_${nomDeFichierSur(id.nom)}.json`, JSON.stringify(fichierClePublique(id), null, 2), 'application/json'),
        ),
      ),
      h('p', { class: 'aide' }, 'Vous pouvez la retransmettre à tout moment. Vérifiez ensuite l’empreinte de vive voix avec le responsable (téléphone), en dehors de l’outil.'),
    ),
    carteReprise(),
    h(
      'div',
      { class: 'grille-2' },
      carte('Ouvrir une liste', ouvrir),
      carte(
        'Nouvelle liste (responsable)',
        h('p', null, 'Importez un export KoboToolbox ou d’une plateforme de paiement (XLSX ou CSV). L’original sera figé et son empreinte calculée.'),
        bouton('Importer un export…', () => aller('import'), 'principal'),
      ),
    ),
    donneesFictives(),
  ];
}

function donneesFictives() {
  return h(
    'details',
    { class: 'fictif' },
    h('summary', null, 'Données fictives pour la démonstration'),
    h(
      'p',
      null,
      h('strong', null, 'Tester seul : '),
      'jouez une personne par navigateur (par exemple Firefox et Chrome), ou rechargez la page pour changer de personne. ',
      'Chaque personne a sa clé ; le responsable ajoute la clé publique de l’autre à l’import.',
    ),
    h(
      'p',
      null,
      'Génère un export Kobo simulé d’environ 300 ménages fictifs (MN-xxxx, deux territoires fictifs), avec des anomalies plantées en proportion connue.',
    ),
    h(
      'div',
      { class: 'ligne' },
      bouton('Télécharger (XLSX)', () =>
        occupe('Génération…', async () => {
          const { tableau } = genererDonneesFictives();
          telecharger('kobo_fictif.xlsx', await ecrireXlsx([{ nom: 'donnees_fictives', tableau }]));
        }),
      ),
      bouton('Télécharger (CSV)', () => {
        const { tableau } = genererDonneesFictives();
        telecharger('kobo_fictif.csv', ecrireCsv(tableau, ','), 'text/csv');
      }),
    ),
  );
}

export function ecranAccueil() {
  return session.identite ? ecranChoixListe() : ecranIdentite();
}
