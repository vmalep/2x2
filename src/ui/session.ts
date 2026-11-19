/** État de la séance : identité déverrouillée, liste ouverte, enregistrement. Rien n'est stocké dans le navigateur. */
import type { IdentiteDeverrouillee } from '../crypto/cles.ts';
import { calculerAlertes, type Alerte } from '../controles/controles.ts';
import { parametresParDefaut } from '../controles/parametres.ts';
import { chiffrerListe, dechiffrerListe } from '../model/fichier-liste.ts';
import { verifierListe, type Etat, type Verification } from '../model/journal.ts';
import type { Liste, Parametres, Role } from '../model/types.ts';
import { demanderEmplacement, ecrireDansPoignee, enregistrementDirect, nomDeFichierSur, telecharger } from './fichiers.ts';

export type Ecran = 'accueil' | 'import' | 'correction' | 'validation' | 'alertes' | 'export' | 'journal';

export interface Session {
  identite?: IdentiteDeverrouillee;
  liste?: Liste;
  etat?: Etat;
  verification?: Verification;
  /** Gardé en mémoire le temps de la séance pour pouvoir réenregistrer le fichier. */
  motDePasseListe?: string;
  poignee?: FileSystemFileHandle;
  nomFichierListe?: string;
  nonEnregistre: boolean;
  ecran: Ecran;
  menageSelectionne?: string;
  /** Décisions signées par moi depuis l'ouverture ou le dernier reçu : rappel de produire un reçu. */
  decisionsDepuisRecu: number;
}

export const session: Session = { nonEnregistre: false, ecran: 'accueil', decisionsDepuisRecu: 0 };

// ---------- Alertes (recalculées seulement quand le journal change) ----------

let cacheAlertes: { cle: string; alertes: Alerte[] } | undefined;

export function parametresCourants(): Parametres {
  return session.etat!.parametres ?? parametresParDefaut(session.liste!.original.colonnes);
}

export function alertesCourantes(): Alerte[] {
  const { liste, etat } = session;
  if (!liste || !etat) return [];
  const cle = liste.journal.at(-1)!.empreinte;
  if (cacheAlertes?.cle !== cle) cacheAlertes = { cle, alertes: calculerAlertes(etat, parametresCourants()) };
  return cacheAlertes.alertes;
}

let rendu: () => void = () => {};
export function surRafraichissement(f: () => void) {
  rendu = f;
}
export function rafraichir() {
  rendu();
}

export function aller(ecran: Ecran) {
  session.ecran = ecran;
  rafraichir();
}

// ---------- Notifications et opérations longues ----------

export function notifier(message: string, type: 'info' | 'succes' | 'erreur' = 'info') {
  const zone = document.getElementById('notifications');
  if (!zone) return;
  const el = document.createElement('div');
  el.className = `notification ${type}`;
  el.setAttribute('role', type === 'erreur' ? 'alert' : 'status');
  el.textContent = message;
  const fermer = document.createElement('button');
  fermer.className = 'fermer';
  fermer.setAttribute('aria-label', 'Fermer');
  fermer.textContent = '×';
  fermer.addEventListener('click', () => el.remove());
  el.appendChild(fermer);
  zone.appendChild(el);
  // Trois notifications au plus : les plus anciennes disparaissent.
  while (zone.children.length > 3) zone.firstElementChild!.remove();
  if (type !== 'erreur') setTimeout(() => el.remove(), 6000);
}

export async function occupe<T>(message: string, f: () => Promise<T>): Promise<T | undefined> {
  const voile = document.getElementById('voile')!;
  voile.querySelector('.message')!.textContent = message;
  voile.hidden = false;
  try {
    // Laisse le navigateur afficher le voile avant les calculs.
    await new Promise((r) => setTimeout(r, 30));
    return await f();
  } catch (e) {
    console.error(e);
    notifier((e as Error).message || String(e), 'erreur');
    return undefined;
  } finally {
    voile.hidden = true;
  }
}

// ---------- Droits ----------

export function moi() {
  const empreinte = session.identite?.empreinte;
  return empreinte ? session.etat?.utilisateurs.get(empreinte) : undefined;
}

export function peut(role: Role): boolean {
  return !!session.verification?.valide && (moi()?.roles.includes(role) ?? false);
}

export function nomAuteur(empreinte: string): string {
  return session.etat?.utilisateurs.get(empreinte)?.nom ?? 'inconnu';
}

// ---------- Fichier de liste ----------

export async function ouvrirListe(texte: string, nomFichier: string, motDePasse: string) {
  const liste = await dechiffrerListe(texte, motDePasse);
  const verification = await verifierListe(liste);
  Object.assign(session, {
    liste,
    etat: verification.etat,
    verification,
    motDePasseListe: motDePasse,
    poignee: undefined,
    nomFichierListe: nomFichier,
    nonEnregistre: false,
    menageSelectionne: undefined,
    decisionsDepuisRecu: 0,
  });
  session.ecran = verification.valide ? 'correction' : 'journal';
  if (!verification.valide) notifier('Le fichier présente des altérations : il est ouvert en lecture seule.', 'erreur');
  else if (!moi()) notifier('Votre clé n’est pas déclarée dans cette liste : lecture seule.', 'erreur');
}

export function fermerListe() {
  if (session.nonEnregistre && !confirm('Des modifications ne sont pas enregistrées. Fermer quand même ?')) return;
  if (session.decisionsDepuisRecu > 0 && !confirm('Vous avez pris des décisions de validation sans produire de reçu. Fermer quand même ?')) return;
  Object.assign(session, {
    liste: undefined,
    etat: undefined,
    verification: undefined,
    motDePasseListe: undefined,
    poignee: undefined,
    nomFichierListe: undefined,
    nonEnregistre: false,
    menageSelectionne: undefined,
    decisionsDepuisRecu: 0,
    ecran: 'accueil',
  });
  rafraichir();
}

/** Enregistre le fichier chiffré : directement sur le disque si possible, sinon par téléchargement. */
export async function enregistrer(choisirEmplacement = false) {
  const { liste, motDePasseListe } = session;
  if (!liste || !motDePasseListe) return;
  const contenu = await chiffrerListe(liste, motDePasseListe);
  const nom = session.nomFichierListe ?? `liste_${nomDeFichierSur(liste.original.nomFichier.replace(/\.[^.]+$/, ''))}.2x2`;
  if (enregistrementDirect && (choisirEmplacement || !session.poignee)) {
    const poignee = await demanderEmplacement(nom);
    if (!poignee) return;
    session.poignee = poignee;
    session.nomFichierListe = poignee.name;
  }
  if (session.poignee) {
    await ecrireDansPoignee(session.poignee, contenu);
    notifier(`Liste chiffrée enregistrée : ${session.poignee.name}`, 'succes');
  } else {
    telecharger(nom, contenu, 'application/json');
    session.nomFichierListe = nom;
    notifier(`Liste chiffrée téléchargée : ${nom}. Remplacez l’ancienne version par celle-ci.`, 'succes');
  }
  session.nonEnregistre = false;
  rafraichir();
}

/** Après chaque ligne signée : enregistrement automatique si le fichier a un emplacement sur le disque. */
export async function apresModification() {
  session.nonEnregistre = true;
  if (session.poignee) {
    try {
      await ecrireDansPoignee(session.poignee, await chiffrerListe(session.liste!, session.motDePasseListe!));
      session.nonEnregistre = false;
    } catch (e) {
      notifier(`Enregistrement automatique impossible : ${(e as Error).message}`, 'erreur');
    }
  }
  rafraichir();
}

window.addEventListener('beforeunload', (e) => {
  if (session.nonEnregistre) e.preventDefault();
});
