import './style.css';
import { demarrer } from './ui/app.ts';

if (!globalThis.crypto?.subtle) {
  document.getElementById('app')!.textContent =
    'Ce navigateur ne permet pas le chiffrement (WebCrypto). Utilisez une version récente de Chrome, Edge ou Firefox.';
} else {
  demarrer(document.getElementById('app')!);
}
