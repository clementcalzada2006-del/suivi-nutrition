// Enregistrement sur l'appareil (localStorage). Deux clés :
//   suivi-nutrition-v1          : la journée en cours, les pesées et les réglages
//   suivi-nutrition-historique  : les journées archivées avant chaque remise à zéro (jamais effacées)
// Si le stockage ne marche pas, tout reste en mémoire et l'appli affiche un bandeau d'avertissement.
import { jourLocal, activiteVide } from "./calculs.js";

const CLE = "suivi-nutrition-v1";
const CLE_HISTO = "suivi-nutrition-historique";
let disponible = false;
const memoire = {}; // repli quand localStorage est indisponible

// Test d'écriture puis de relecture : en navigation privée ou dans certains contextes, il échoue.
export function testerStockage() {
  try {
    const t = "suivi-nutrition-test";
    localStorage.setItem(t, "1");
    disponible = localStorage.getItem(t) === "1";
    localStorage.removeItem(t);
  } catch {
    disponible = false;
  }
  if (disponible && navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  return disponible;
}

function lire(cle) {
  try {
    const t = disponible ? localStorage.getItem(cle) : memoire[cle];
    return t ? JSON.parse(t) : null;
  } catch {
    return null;
  }
}

function ecrire(cle, valeur) {
  const t = JSON.stringify(valeur);
  if (disponible) {
    try {
      localStorage.setItem(cle, t);
      return true;
    } catch {
      disponible = false; // quota plein ou stockage retiré : on bascule en mémoire, le bandeau s'affiche
    }
  }
  memoire[cle] = t;
  return false;
}

export const stockageDisponible = () => disponible;

export function etatInitial(masseGrasseDefaut) {
  return { jour: jourLocal(), journal: [], activite: activiteVide(), pesees: [], reglages: { masseGrasse: masseGrasseDefaut } };
}

// Lit l'état enregistré en complétant les champs absents (anciennes versions, première ouverture).
export function chargerEtat(masseGrasseDefaut) {
  const base = etatInitial(masseGrasseDefaut);
  const e = lire(CLE);
  if (!e || typeof e !== "object") return base;
  return {
    jour: typeof e.jour === "string" ? e.jour : base.jour,
    journal: Array.isArray(e.journal) ? e.journal : [],
    activite: { ...activiteVide(), ...(e.activite || {}) },
    pesees: Array.isArray(e.pesees) ? e.pesees : [],
    reglages: { ...base.reglages, ...(e.reglages || {}) },
  };
}

export const enregistrerEtat = (etat) => ecrire(CLE, etat);
export const chargerHistorique = () => {
  const h = lire(CLE_HISTO);
  return Array.isArray(h) ? h : [];
};
export const enregistrerHistorique = (h) => ecrire(CLE_HISTO, h);
