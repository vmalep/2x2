import { deverrouillerIdentite, genererIdentite } from '../../crypto/cles.ts';
import type { EnveloppeChiffree } from '../../crypto/chiffrement.ts';
import { genererDonneesFictives } from '../../gen/fictif.ts';
import { ecrireCsv } from '../../io/csv.ts';
import { ecrireXlsx } from '../../io/xlsx.ts';
import { bouton, carte, champ, empreinte, encadre, motDePasse } from '../composants.ts';
import { h } from '../dom.ts';
import { choisirFichier, nomDeFichierSur, telecharger } from '../fichiers.ts';
import { aller, notifier, occupe, ouvrirListe, rafraichir, session } from '../session.ts';

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
          const { fichierCle, fichierPublic, identite } = await genererIdentite(nom.value, mdp1.value);
          const base = nomDeFichierSur(identite.nom);
          telecharger(`2x2_cle_privee_${base}.2x2cle`, JSON.stringify(fichierCle), 'application/json');
          telecharger(`2x2_cle_publique_${base}.json`, JSON.stringify(fichierPublic, null, 2), 'application/json');
          session.identite = identite;
          notifier('Clé créée. Deux fichiers ont été téléchargés.', 'succes');
          rafraichir();
        });
      },
    },
    champ('Votre nom', nom),
    champ('Mot de passe de la clé', mdp1, `Au moins ${LONGUEUR_MIN} caractères. Il protège votre clé privée : ne le communiquez à personne.`),
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
          session.identite = await deverrouillerIdentite(fichierCle!, mdp.value);
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
    h('div', { class: 'grille-2' }, carte('J’ai déjà une clé', ouvrir), carte('Créer ma clé', creer)),
    donneesFictives(),
  ];
}

function ecranChoixListe() {
  const id = session.identite!;
  let fichier: { nom: string; texte: string } | undefined;
  const nomFichier = h('span', { class: 'discret' }, 'Aucun fichier choisi');
  const mdp = motDePasse();
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
    encadre(
      'info',
      h('p', null, 'Empreinte de votre clé publique : ', empreinte(id.empreinte)),
      h('p', { class: 'aide' }, 'Vérifiez-la de vive voix avec le responsable de la liste (téléphone, message), en dehors de l’outil.'),
    ),
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
