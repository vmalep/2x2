/** Ouverture et enregistrement de fichiers locaux, sans aucune requête réseau. */
import type { Octets } from '../crypto/encodage.ts';
import { t } from '../i18n/index.ts';

export interface FichierLu {
  nom: string;
  octets: Octets;
  texte(): string;
}

export function choisirFichier(accept: string): Promise<FichierLu | undefined> {
  return new Promise((resoudre) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      resoudre(f ? await lireFichier(f) : undefined);
    });
    input.addEventListener('cancel', () => resoudre(undefined));
    input.click();
  });
}

export async function lireFichier(f: File): Promise<FichierLu> {
  const octets = new Uint8Array(await f.arrayBuffer());
  return { nom: f.name, octets, texte: () => new TextDecoder().decode(octets) };
}

export function telecharger(nom: string, contenu: Octets | string, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([contenu], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nom;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Enregistrement direct sur le disque : Chrome et Edge seulement (API File System Access). */
export const enregistrementDirect = typeof (window as any).showSaveFilePicker === 'function';

export async function demanderEmplacement(nomSuggere: string): Promise<FileSystemFileHandle | undefined> {
  try {
    return await (window as any).showSaveFilePicker({
      suggestedName: nomSuggere,
      types: [{ description: t('fichiers.type_liste'), accept: { 'application/json': ['.2x2'] } }],
    });
  } catch (e) {
    if ((e as DOMException)?.name === 'AbortError') return undefined;
    throw e;
  }
}

export async function ecrireDansPoignee(poignee: FileSystemFileHandle, contenu: string) {
  const flux = await poignee.createWritable();
  await flux.write(contenu);
  await flux.close();
}

export function nomDeFichierSur(texte: string): string {
  return texte.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_|_$/g, '') || 'sans_nom';
}
