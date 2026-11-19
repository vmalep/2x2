import { lireFichierClePublique } from '../../crypto/cles.ts';
import { sha256Hex } from '../../crypto/empreinte.ts';
import { lireExport } from '../../io/import.ts';
import type { Tableau } from '../../io/tableau.ts';
import { creerListe, declarerUtilisateur } from '../../model/journal.ts';
import { LIBELLES_ROLES, type Role, type Utilisateur } from '../../model/types.ts';
import { badge, bouton, carte, champ, empreinte, encadre, motDePasse } from '../composants.ts';
import { h, remplacer } from '../dom.ts';
import { choisirFichier, lireFichier, nomDeFichierSur, type FichierLu } from '../fichiers.ts';
import { apresModification, enregistrer, moi, notifier, occupe, rafraichir, session } from '../session.ts';

const ROLES: Role[] = ['responsable', 'correction', 'validation'];

/** Propose la colonne d'identifiant : un nom évocateur, sinon la première colonne aux valeurs uniques. */
function colonneIdProbable(t: Tableau): string {
  const uniques = t.colonnes.filter((_, i) => {
    const v = t.lignes.map((l) => l[i]);
    return v.every((x) => x.trim()) && new Set(v).size === v.length;
  });
  return (
    uniques.find((c) => /(^|[_/])(id_)?menage(_id)?$|household/i.test(c)) ??
    uniques.find((c) => !c.startsWith('_')) ??
    uniques.find((c) => c === '_uuid') ??
    uniques[0] ??
    t.colonnes[0]
  );
}

function tableauUtilisateurs(utilisateurs: Utilisateur[], modifiable: boolean, surChangement: () => void) {
  return h(
    'table',
    { class: 'tableau' },
    h('thead', null, h('tr', null, h('th', null, 'Nom'), h('th', null, 'Empreinte de la clé'), ...ROLES.map((r) => h('th', null, LIBELLES_ROLES[r])), modifiable && h('th', null, ''))),
    h(
      'tbody',
      null,
      utilisateurs.map((u, i) =>
        h(
          'tr',
          null,
          h('td', null, u.nom, u.empreinte === session.identite?.empreinte && ' (vous)'),
          h('td', null, empreinte(u.empreinte)),
          ...ROLES.map((r) =>
            h(
              'td',
              { class: 'centre' },
              modifiable
                ? h('input', {
                    type: 'checkbox',
                    'aria-label': `${u.nom} : ${LIBELLES_ROLES[r]}`,
                    checked: u.roles.includes(r),
                    disabled: r === 'responsable' && i === 0,
                    onchange: (e: Event) => {
                      const coche = (e.target as HTMLInputElement).checked;
                      u.roles = coche ? [...u.roles, r] : u.roles.filter((x) => x !== r);
                      surChangement();
                    },
                  })
                : u.roles.includes(r)
                  ? '✓'
                  : '',
            ),
          ),
          modifiable &&
            h(
              'td',
              null,
              i > 0 &&
                bouton('Retirer', () => {
                  utilisateurs.splice(i, 1);
                  surChangement();
                }),
            ),
        ),
      ),
    ),
  );
}

async function lireClePublique(): Promise<Utilisateur | undefined> {
  const f = await choisirFichier('.json,application/json');
  if (!f) return undefined;
  try {
    const cle = await lireFichierClePublique(f.texte());
    return { nom: cle.nom, cle: cle.cle, empreinte: cle.empreinte, roles: [] };
  } catch (e) {
    notifier((e as Error).message, 'erreur');
    return undefined;
  }
}

function nouvelleListe() {
  const id = session.identite!;
  const etat: {
    tableau?: Tableau;
    nomFichier?: string;
    empreinteFichier?: string;
    colonneId?: string;
    utilisateurs: Utilisateur[];
  } = { utilisateurs: [{ nom: id.nom, cle: id.clePublique, empreinte: id.empreinte, roles: ['responsable'] }] };
  const zone = h('div');
  const mdp1 = motDePasse('', 'new-password');
  const mdp2 = motDePasse('', 'new-password');

  const charger = (f: FichierLu) =>
    occupe('Lecture de l’export et calcul de l’empreinte…', async () => {
      const tableau = await lireExport(f.octets, f.nom);
      Object.assign(etat, { tableau, nomFichier: f.nom, empreinteFichier: await sha256Hex(f.octets), colonneId: colonneIdProbable(tableau) });
      dessiner();
    });

  const depot = h(
    'div',
    {
      class: 'depot',
      tabindex: 0,
      role: 'button',
      onclick: async () => {
        const f = await choisirFichier('.xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        if (f) charger(f);
      },
      onkeydown: (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') (e.currentTarget as HTMLElement).click();
      },
      ondragover: (e: DragEvent) => {
        e.preventDefault();
        (e.currentTarget as HTMLElement).classList.add('survol');
      },
      ondragleave: (e: DragEvent) => (e.currentTarget as HTMLElement).classList.remove('survol'),
      ondrop: async (e: DragEvent) => {
        e.preventDefault();
        (e.currentTarget as HTMLElement).classList.remove('survol');
        const f = e.dataTransfer?.files[0];
        if (f) charger(await lireFichier(f));
      },
    },
    h('strong', null, 'Déposez ici l’export (KoboToolbox ou plateforme de paiement)'),
    h('span', null, 'ou cliquez pour choisir un fichier XLSX ou CSV'),
  );

  function dessiner() {
    const t = etat.tableau;
    remplacer(
      zone,
      carte(
        '1. Export d’origine',
        t
          ? [
              h(
                'dl',
                { class: 'details' },
                h('dt', null, 'Fichier'),
                h('dd', null, etat.nomFichier!),
                h('dt', null, 'Contenu'),
                h('dd', null, `${t.lignes.length} lignes, ${t.colonnes.length} colonnes`),
                h('dt', null, 'Empreinte SHA-256'),
                h('dd', null, empreinte(etat.empreinteFichier!, 16)),
              ),
              encadre(
                'alerte',
                h('strong', null, 'Envoyez dès maintenant cette empreinte au validateur'),
                ' (message, courriel). Elle permettra de prouver plus tard que la liste part bien de cet export, et pas d’une version retouchée.',
              ),
              !t.colonnes.includes('donnees_fictives') &&
                encadre('erreur', h('strong', null, 'Prototype : '), 'cet export ne porte pas la mention de données fictives. N’utilisez jamais de données réelles avec ce prototype.'),
              champ(
                'Colonne d’identifiant du ménage',
                h(
                  'select',
                  { onchange: (e: Event) => (etat.colonneId = (e.target as HTMLSelectElement).value) },
                  t.colonnes.map((c) => h('option', { value: c, selected: c === etat.colonneId }, c)),
                ),
                'Valeurs uniques et non vides. Cet identifiant ne pourra pas être corrigé.',
              ),
              bouton('Choisir un autre export', () => {
                etat.tableau = undefined;
                dessiner();
              }),
            ]
          : depot,
      ),
      t &&
        carte(
          '2. Utilisateurs autorisés',
          h(
            'p',
            null,
            'Ajoutez la clé publique de chaque personne (fichier ',
            h('code', null, '2x2_cle_publique_….json'),
            '). Chacun génère sa clé sur son propre poste : vous ne pouvez pas en fabriquer pour un autre.',
          ),
          tableauUtilisateurs(etat.utilisateurs, true, dessiner),
          h(
            'div',
            { class: 'ligne' },
            bouton('Ajouter une clé publique…', async () => {
              const u = await lireClePublique();
              if (!u) return;
              if (etat.utilisateurs.some((x) => x.empreinte === u.empreinte)) return notifier('Cette clé est déjà dans la liste.', 'erreur');
              u.roles = ['correction'];
              etat.utilisateurs.push(u);
              dessiner();
            }),
          ),
          encadre('info', 'Avant de valider, vérifiez chaque empreinte de vive voix avec la personne concernée (téléphone), en dehors de l’outil.'),
        ),
      t &&
        carte(
          '3. Mot de passe de la liste',
          h('p', null, 'Il chiffre le fichier qui circule entre les personnes. Communiquez-le par un autre canal que le fichier lui-même.'),
          champ('Mot de passe', mdp1, 'Au moins 12 caractères.'),
          champ('Confirmer', mdp2),
          bouton('Créer la liste chiffrée', creer, 'principal'),
        ),
    );
  }

  function creer() {
    const t = etat.tableau!;
    if (mdp1.value.length < 12) return notifier('Le mot de passe de la liste doit compter au moins 12 caractères.', 'erreur');
    if (mdp1.value !== mdp2.value) return notifier('Les deux mots de passe ne correspondent pas.', 'erreur');
    const correcteurs = etat.utilisateurs.filter((u) => u.roles.includes('correction'));
    const validateurs = etat.utilisateurs.filter((u) => u.roles.includes('validation'));
    if (!correcteurs.length || !validateurs.length) return notifier('Il faut au moins une personne en correction et une en validation.', 'erreur');
    if (correcteurs.length === 1 && validateurs.length === 1 && correcteurs[0] === validateurs[0]) {
      return notifier('Les quatre yeux exigent deux personnes : la correction et la validation ne peuvent pas reposer sur la même seule personne.', 'erreur');
    }
    occupe('Création et chiffrement de la liste…', async () => {
      const { liste, etat: e } = await creerListe(
        { nomFichier: etat.nomFichier!, empreinteFichier: etat.empreinteFichier!, colonnes: t.colonnes, colonneId: etat.colonneId!, lignes: t.lignes },
        id,
        etat.utilisateurs,
      );
      const verification = { valide: true, erreurs: [], avertissements: [], etat: e };
      Object.assign(session, {
        liste,
        etat: e,
        verification,
        motDePasseListe: mdp1.value,
        poignee: undefined,
        nomFichierListe: `liste_${nomDeFichierSur(etat.nomFichier!.replace(/\.[^.]+$/, ''))}.2x2`,
        nonEnregistre: true,
        decisionsDepuisRecu: 0,
      });
      await enregistrer();
      session.ecran = 'import';
      rafraichir();
    });
  }

  dessiner();
  return [
    h('h1', null, 'Import d’un export'),
    h('p', { class: 'intro' }, 'L’original est figé : il ne sera jamais modifié. Toute correction passera par le journal signé.'),
    zone,
  ];
}

function listeOuverte() {
  const { liste, etat } = session;
  const o = liste!.original;
  const ouverture = liste!.journal[0];
  const utilisateurs = [...etat!.utilisateurs.values()];
  const responsable = moi()?.roles.includes('responsable') && session.verification?.valide;
  return [
    h('h1', null, 'Import'),
    carte(
      'Export d’origine (figé)',
      h(
        'dl',
        { class: 'details' },
        h('dt', null, 'Fichier'),
        h('dd', null, o.nomFichier),
        h('dt', null, 'Contenu'),
        h('dd', null, `${o.lignes.length} ménages, ${o.colonnes.length} colonnes ; identifiant : `, h('code', null, o.colonneId)),
        h('dt', null, 'Empreinte SHA-256'),
        h('dd', null, empreinte(o.empreinteFichier, 16)),
        h('dt', null, 'Ouverte par'),
        h('dd', null, `${etat!.utilisateurs.get(ouverture.auteur)?.nom ?? '?'}, le ${new Date(ouverture.le).toLocaleString('fr-BE')}`),
      ),
      h('p', { class: 'aide' }, 'Comparez cette empreinte à celle reçue au moment de l’import. Elle doit être identique.'),
    ),
    carte(
      'Utilisateurs autorisés',
      tableauUtilisateurs(utilisateurs, false, () => {}),
      responsable &&
        h(
          'div',
          { class: 'ligne' },
          bouton('Déclarer un nouvel utilisateur…', async () => {
            const u = await lireClePublique();
            if (!u) return;
            const roles = ROLES.filter((r) => r !== 'responsable' && confirm(`Donner le rôle « ${LIBELLES_ROLES[r]} » à ${u.nom} ?`));
            if (!roles.length) return notifier('Aucun rôle choisi : utilisateur non déclaré.', 'info');
            u.roles = roles;
            occupe('Signature…', async () => {
              await declarerUtilisateur(liste!, etat!, session.identite!, u);
              notifier(`${u.nom} est déclaré(e). Vérifiez son empreinte avec lui ou elle.`, 'succes');
              await apresModification();
            });
          }),
          badge('signé et journalisé'),
        ),
    ),
  ];
}

export function ecranImport() {
  return session.liste ? listeOuverte() : nouvelleListe();
}
