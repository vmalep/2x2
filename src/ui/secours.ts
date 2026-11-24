/**
 * Copie de secours dans le navigateur : après chaque modification non enregistrée, la liste
 * est rechiffrée (même chiffrement que le fichier .2x2) et gardée dans le stockage local.
 * Un rafraîchissement ou une fermeture accidentelle ne fait donc plus perdre le travail :
 * à la réouverture, on reprend la liste avec son mot de passe. Rien n'est stocké en clair.
 * La copie est effacée dès que la liste est enregistrée sur le disque, ou abandonnée.
 */
import { chiffrerListe } from '../model/fichier-liste.ts';
import type { Liste } from '../model/types.ts';

const CLE = '2x2-secours';

export interface Secours {
  format: '2x2-secours';
  nomFichier: string;
  version: string;
  /** Date de la copie. */
  le: string;
  /** Liste chiffrée, identique au contenu d'un fichier .2x2. */
  contenu: string;
}

function stockage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function lireSecours(): Secours | undefined {
  try {
    const brut = stockage()?.getItem(CLE);
    if (!brut) return undefined;
    const s = JSON.parse(brut) as Secours;
    return s.format === '2x2-secours' && typeof s.contenu === 'string' ? s : undefined;
  } catch {
    return undefined;
  }
}

export function effacerSecours() {
  annulerProgramme();
  try {
    stockage()?.removeItem(CLE);
  } catch {
    /* stockage indisponible : rien à effacer */
  }
}

let minuterie: ReturnType<typeof setTimeout> | undefined;
let generation = 0;
function annulerProgramme() {
  if (minuterie) clearTimeout(minuterie);
  minuterie = undefined;
  generation++;
}

/**
 * Programme une copie de secours. Le chiffrement est coûteux (dérivation de clé) : on attend
 * une courte pause dans le travail plutôt que de chiffrer après chaque clic.
 * En cas d'échec (stockage indisponible ou plein), surEchec prévient l'utilisateur.
 */
export function programmerSecours(liste: Liste, motDePasse: string, nomFichier: string, version: () => string, surEchec: (raison: string) => void) {
  annulerProgramme();
  const moi = generation;
  minuterie = setTimeout(async () => {
    try {
      const contenu = await chiffrerListe(liste, motDePasse);
      // Entre-temps, la liste a pu être enregistrée ou fermée : on n'écrit plus rien.
      if (moi !== generation) return;
      const s = stockage();
      if (!s) throw new Error('le stockage du navigateur n’est pas disponible pour cette page');
      const secours: Secours = { format: '2x2-secours', nomFichier, version: version(), le: new Date().toISOString(), contenu };
      s.setItem(CLE, JSON.stringify(secours));
    } catch (e) {
      surEchec((e as Error).message || String(e));
    }
  }, 800);
}
