import { clePubliqueEnTexte, deverrouillerIdentite, fichierClePublique, genererIdentite } from '../../crypto/cles.ts';
import { MotDePasseIncorrect, type EnveloppeChiffree } from '../../crypto/chiffrement.ts';
import { genererDonneesFictives } from '../../gen/fictif.ts';
import { ecrireCsv } from '../../io/csv.ts';
import { ecrireXlsx } from '../../io/xlsx.ts';
import { bouton, carte, champ, empreinte, encadre, motDePasse } from '../composants.ts';
import { dateLisible, h, tr } from '../dom.ts';
import { choisirFichier, nomDeFichierSur, telecharger } from '../fichiers.ts';
import { aller, notifier, occupe, ouvrirListe, rafraichir, session } from '../session.ts';
import { effacerSecours, lireSecours } from '../secours.ts';
import { t } from '../../i18n/index.ts';

const LONGUEUR_MIN = 12;

function ecranIdentite() {
  // --- Créer ma clé ---
  const nom = h('input', { type: 'text', autocomplete: 'name', placeholder: t('accueil.prenom_nom') });
  const mdp1 = motDePasse('', 'new-password');
  const mdp2 = motDePasse('', 'new-password');
  const creer = h(
    'form',
    {
      onsubmit: (e: Event) => {
        e.preventDefault();
        if (mdp1.value.length < LONGUEUR_MIN) return notifier(t('accueil.mdp_court', { n: LONGUEUR_MIN }), 'erreur');
        if (mdp1.value !== mdp2.value) return notifier(t('commun.mdp_differents'), 'erreur');
        occupe(t('accueil.generation_cle'), async () => {
          const { fichierCle, identite } = await genererIdentite(nom.value, mdp1.value);
          // Un seul fichier ici : la clé privée, qui reste chez vous. La clé publique se transmet ensuite.
          telecharger(`2x2_cle_privee_${nomDeFichierSur(identite.nom)}.2x2cle`, JSON.stringify(fichierCle), 'application/json');
          session.identite = identite;
          session.cleNouvelle = true;
          notifier(t('accueil.cle_creee_notif'), 'succes');
          rafraichir();
        });
      },
    },
    champ(t('accueil.votre_nom'), nom),
    champ(
      t('accueil.mdp_cle'),
      mdp1,
      t('accueil.mdp_cle_aide', { n: LONGUEUR_MIN }),
    ),
    champ(t('accueil.confirmer_mdp'), mdp2),
    h('button', { type: 'submit', class: 'bouton principal' }, t('accueil.creer_cle')),
  );

  // --- Ouvrir ma clé ---
  let fichierCle: EnveloppeChiffree | undefined;
  const nomFichier = h('span', { class: 'discret' }, t('commun.aucun_fichier'));
  const mdp = motDePasse();
  const ouvrir = h(
    'form',
    {
      onsubmit: (e: Event) => {
        e.preventDefault();
        if (!fichierCle) return notifier(t('accueil.choisir_cle_avant'), 'erreur');
        occupe(t('accueil.deverrouillage'), async () => {
          try {
            session.identite = await deverrouillerIdentite(fichierCle!, mdp.value);
          } catch (e) {
            if (!(e instanceof MotDePasseIncorrect)) throw e;
            return notifier(
              t('accueil.mdp_incorrect'),
              'erreur',
            );
          }
          notifier(t('accueil.bonjour_notif', { nom: session.identite.nom }), 'succes');
          rafraichir();
        });
      },
    },
    h(
      'div',
      { class: 'champ' },
      h('label', null, t('accueil.fichier_cle')),
      h(
        'div',
        { class: 'ligne' },
        bouton(t('commun.choisir'), async () => {
          const f = await choisirFichier('.2x2cle,application/json');
          if (!f) return;
          try {
            fichierCle = JSON.parse(f.texte());
            nomFichier.textContent = f.nom;
          } catch {
            notifier(t('accueil.cle_illisible'), 'erreur');
          }
        }),
        nomFichier,
      ),
    ),
    champ(t('accueil.mdp_cle'), mdp),
    h('button', { type: 'submit', class: 'bouton principal' }, t('accueil.deverrouiller')),
  );

  return [
    h('h1', null, t('accueil.titre_cle')),
    h(
      'p',
      { class: 'intro' },
      t('accueil.intro_cle'),
    ),
    lireSecours() &&
      encadre(
        'alerte',
        tr('accueil.secours_trouve'),
      ),
    h('div', { class: 'grille-2' }, carte(t('accueil.deja_cle'), ouvrir), carte(t('accueil.creer_cle'), creer)),
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
    h('h2', null, t('accueil.reprise_titre')),
    h(
      'p',
      null,
      tr('accueil.reprise_texte', { nom: s.nomFichier, version: s.version, date: dateLisible(s.le) }),
    ),
    h(
      'form',
      {
        onsubmit: (e: Event) => {
          e.preventDefault();
          occupe(t('accueil.dechiffrement'), async () => {
            await ouvrirListe(s.contenu, s.nomFichier, mdp.value, true);
            notifier(t('accueil.reprise_ok'), 'succes');
            rafraichir();
          });
        },
      },
      champ(t('accueil.mdp_cette_liste'), mdp),
      h(
        'div',
        { class: 'ligne' },
        h('button', { type: 'submit', class: 'bouton principal' }, t('accueil.reprendre')),
        bouton(t('accueil.abandonner'), () => {
          if (!confirm(t('accueil.abandonner_confirmer'))) return;
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
  const nomFichier = h('span', { class: 'discret' }, t('commun.aucun_fichier'));
  // Pas de saisie automatique : le navigateur proposerait le mot de passe de la clé, qui n'est pas celui de la liste.
  const mdp = motDePasse('', 'new-password'); // « off » est ignoré par Firefox pour les mots de passe.
  mdp.setAttribute('data-lpignore', 'true');
  const ouvrir = h(
    'form',
    {
      onsubmit: (e: Event) => {
        e.preventDefault();
        if (!fichier) return notifier(t('accueil.choisir_liste_avant'), 'erreur');
        occupe(t('accueil.dechiffrement'), async () => {
          await ouvrirListe(fichier!.texte, fichier!.nom, mdp.value);
          rafraichir();
        });
      },
    },
    h(
      'div',
      { class: 'champ' },
      h('label', null, t('accueil.fichier_liste')),
      h(
        'div',
        { class: 'ligne' },
        bouton(t('commun.choisir'), async () => {
          const f = await choisirFichier('.2x2,application/json');
          if (!f) return;
          fichier = { nom: f.nom, texte: f.texte() };
          nomFichier.textContent = f.nom;
        }),
        nomFichier,
      ),
    ),
    champ(t('accueil.mdp_liste'), mdp),
    h('button', { type: 'submit', class: 'bouton principal' }, t('accueil.ouvrir_verifier')),
  );

  return [
    h('h1', null, t('accueil.bonjour', { nom: id.nom })),
    session.cleNouvelle &&
      encadre(
        'ok',
        h('strong', null, t('accueil.cle_creee')),
        h(
          'ol',
          null,
          h('li', null, tr('accueil.cle_creee_1')),
          h('li', null, tr('accueil.cle_creee_2')),
        ),
      ),
    encadre(
      'info',
      h('p', null, tr('accueil.cle_publique', { empreinte: empreinte(id.empreinte) })),
      h(
        'div',
        { class: 'ligne' },
        bouton(
          t('accueil.copier_cle'),
          async () => {
            try {
              await navigator.clipboard.writeText(clePubliqueEnTexte(fichierClePublique(id)));
              notifier(t('accueil.cle_copiee'), 'succes');
            } catch {
              notifier(t('accueil.copie_impossible'), 'erreur');
            }
          },
          'principal',
        ),
        bouton(t('accueil.telecharger_cle'), () =>
          telecharger(`2x2_cle_publique_${nomDeFichierSur(id.nom)}.json`, JSON.stringify(fichierClePublique(id), null, 2), 'application/json'),
        ),
      ),
      h('p', { class: 'aide' }, t('accueil.retransmettre')),
    ),
    carteReprise(),
    h(
      'div',
      { class: 'grille-2' },
      carte(t('accueil.ouvrir_liste'), ouvrir),
      carte(
        t('accueil.nouvelle_liste'),
        h('p', null, t('accueil.nouvelle_liste_texte')),
        bouton(t('accueil.importer'), () => aller('import'), 'principal'),
      ),
    ),
    donneesFictives(),
  ];
}

function donneesFictives() {
  return h(
    'details',
    { class: 'fictif' },
    h('summary', null, t('accueil.fictif')),
    h(
      'p',
      null,
      tr('accueil.fictif_seul'),
    ),
    h(
      'p',
      null,
      t('accueil.fictif_texte'),
    ),
    h(
      'div',
      { class: 'ligne' },
      bouton(t('accueil.telecharger_xlsx'), () =>
        occupe(t('accueil.generation'), async () => {
          const { tableau } = genererDonneesFictives();
          telecharger('kobo_fictif.xlsx', await ecrireXlsx([{ nom: 'donnees_fictives', tableau }]));
        }),
      ),
      bouton(t('accueil.telecharger_csv'), () => {
        const { tableau } = genererDonneesFictives();
        telecharger('kobo_fictif.csv', ecrireCsv(tableau, ','), 'text/csv');
      }),
    ),
  );
}

export function ecranAccueil() {
  return session.identite ? ecranChoixListe() : ecranIdentite();
}
