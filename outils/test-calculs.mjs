// Tests unitaires de calculs.js (Node, sans navigateur). Lancer : node outils/test-calculs.mjs
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as C from "../calculs.js";

const racine = join(dirname(fileURLToPath(import.meta.url)), "..");
const lire = (f) => JSON.parse(readFileSync(join(racine, "donnees", f), "utf8"));
const foods = lire("foods.json");
const refs = lire("references.json");
const activite = lire("activite.json");
const parId = C.indexAliments(foods);

let total = 0;
let echecs = 0;
function verif(cond, msg, detail = "") {
  total++;
  if (cond) console.log("  ok   " + msg);
  else {
    echecs++;
    console.error("  ÉCHEC " + msg + (detail ? ` → ${detail}` : ""));
  }
}
const proche = (a, b, tol = 1e-9) => a !== null && b !== null && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

console.log("\nApports");
// Œuf : 2 œufs × 50 g × 1 = 100 g ; énergie 134 kcal/100 g (Ciqual 22010) → 134 kcal.
verif(C.grammesManges(parId.oeuf, 2) === 100, "2 œufs = 100 g mangés");
verif(C.apport(parId.oeuf, 2, "energie") === 134, "2 œufs = 134 kcal");
// Côte de porc : 200 g pesés × 0,66 = 132 g ; protéines 19,8 g/100 g → 26,136 g.
verif(proche(C.grammesManges(parId.cote_porc, 200), 132), "200 g de côte de porc = 132 g mangés (os retiré)");
verif(proche(C.apport(parId.cote_porc, 200, "proteines"), 26.136), "200 g de côte de porc = 26,136 g de protéines");
verif(C.apport(parId.echine_porc, 100, "vitC") === null, "échine : vitamine C null (jamais 0)");
verif(C.apport(parId.avocat, 0.5, "vitC") === 0, "avocat : vitamine C en traces = 0");

console.log("\nTotaux");
const j = [
  { alimentId: "oeuf", quantite: 2 },
  { alimentId: "echine_porc", quantite: 150 },
  { alimentId: "kiwi_vert", quantite: 1 },
];
const t = C.totaux(j, foods);
verif(t.vitC.incomplet && t.vitC.manquants.length === 1 && t.vitC.manquants[0] === parId.echine_porc.nom, "vitamine C incomplète, échine nommée");
verif(!t.energie.incomplet, "énergie complète");
// kcal : 2 × 50 × 134/100 = 134 ; échine 150 × 0,74 = 111 g × 238/100 = 264,18 ; kiwi 90,8 × 60,9/100 = 55,2972 → 453,4772
verif(proche(t.energie.total, 453.4772), "total énergie = somme des apports (453,4772 kcal)");
verif(C.totaux([], foods).energie.total === 0, "journal vide : 0");
verif(C.totaux([{ alimentId: "inconnu", quantite: 1 }], foods).energie.total === 0, "aliment inconnu ignoré");

console.log("\nRapport oméga 6 / oméga 3");
const tOm = C.totaux([{ alimentId: "avocat", quantite: 1 }], foods);
const av = parId.avocat.valeurs;
const attendu = (av.linoleique.v + av.arachidonique.v) / (av.ala.v + av.epa.v + av.dha.v);
const om = C.rapportOmega(tOm);
verif(proche(om.valeur, attendu) && !om.incomplet, "avocat seul : rapport = (linoléique + arachidonique) / (ALA + EPA + DHA)");
verif(C.rapportOmega(t).incomplet, "avec l'échine : rapport incomplet");
verif(C.rapportOmega(C.totaux([], foods)).valeur === null, "journal vide : pas de rapport");
// Linoléique / ALA. 2 œufs (100 g de 22010) : 1,2 / 0,052 = 23,076923… ; 1 kiwi (90,8 g de 13021) : 0,06356 / 0,16344 = 0,38888…
const la = (j) => C.rapportLinoleiqueAla(C.totaux(j, foods));
verif(proche(la([{ alimentId: "oeuf", quantite: 2 }]).valeur, 23.076923076923077), "linoléique / ALA, 2 œufs = 23,08");
verif(proche(la([{ alimentId: "kiwi_vert", quantite: 1 }]).valeur, 0.3888888888888889), "linoléique / ALA, 1 kiwi = 0,39");
const ref5 = C.referenceConcrete(refs.rapport_omega6_omega3, {});
verif(ref5.type === "max" && ref5.bas === 5, "référence linoléique / ALA : à ne pas dépasser 5");
verif(C.etatReference(23.076923076923077, ref5).etat === "depasse" && C.etatReference(0.39, ref5).etat === "ok", "état : dépasse au-delà de 5, ok en dessous");
const laE = la([{ alimentId: "echine_porc", quantite: 100 }, { alimentId: "kiwi_vert", quantite: 1 }]);
verif(laE.incomplet && laE.manquants.join() === parId.echine_porc.nom, "avec l'échine : linoléique / ALA incomplet, échine nommée");
verif(la([]).valeur === null, "sans ALA : pas de rapport");

console.log("\nNutriment absent de la table (biotine)");
const b8 = foods.nutriments.find((n) => n.cle === "vitB8");
verif(C.absentDeLaTable(b8) && !C.absentDeLaTable(foods.nutriments[0]), "vitB8 : absente de la table, énergie non");
const tB8 = C.totaux([{ alimentId: "oeuf", quantite: 2 }, { alimentId: "echine_porc", quantite: 100 }], foods);
verif(tB8.vitB8.total === null && tB8.vitB8.absent && !tB8.vitB8.incomplet && tB8.vitB8.manquants.length === 0, "vitB8 : pas de total, jamais « incomplet », aucun aliment manquant");
verif(C.teneurTable(parId.oeuf.valeurs.vitB8, b8) === "absente de Ciqual", "fiche : vitB8 « absente de Ciqual »");
verif(foods.nutriments.length === 34 && ["sucres", "fibres", "sel", "ags", "iode"].every((c) => !(c in tB8)), "34 nutriments, retirés absents des totaux");

console.log("\nDépense");
verif(C.depense(activite, null, 15, { km: 5, seance: null }) === null, "sans poids : dépense inconnue");
// 80 kg, 15 % : repos = 370 + 21,6 × 80 × 0,85 = 1838,8 ; × 35/24 = 2681,583333…
// marche 6,2 km : 6,2 × (3,8 − 1,5) × 80 / 5 = 228,16 ; salle pecs + épaules : 12 séries × 3,5 min = 42 min → 0,7 h × 2 × 80 = 112
const d = C.depense(activite, 80, 15, { km: 6.2, seance: "pecs_epaules" });
verif(proche(d.repos, 1838.8), "repos Cunningham = 1838,8 kcal");
verif(proche(d.sedentaire, 2681.5833333333333), "journée sédentaire = 2681,58 kcal");
verif(proche(d.marche, 228.16), "marche 6,2 km = 228,16 kcal");
verif(proche(d.salle, 112) && d.minutesSalle === 42, "pecs + épaules = 42 min, 112 kcal");
verif(proche(d.total, 2681.5833333333333 + 228.16 + 112), "total = 3021,74 kcal");
// Autres modules, 80 kg : dos + épaules 12 séries → 112 ; jambes 10 séries → 35 min → 93,333… ; jambes + épaules 16 séries → 56 min → 149,333…
const salle = (id) => C.depense(activite, 80, 15, { km: 0, seance: id }).salle;
verif(proche(salle("dos_epaules"), 112), "dos + épaules = 112 kcal");
verif(proche(salle("jambes"), 93.33333333333333), "jambes = 93,3 kcal");
verif(proche(salle("jambes_epaules"), 149.33333333333334), "jambes + épaules = 149,3 kcal");
verif(salle(null) === 0, "sans séance : 0");

console.log("\nRéférences");
const ctx = { poids: 80, depense: 3000 };
const r = (c) => C.referenceConcrete(refs.nutriments[c], ctx);
verif(r("energie").bas === 3000, "énergie = dépense");
verif(proche(r("proteines").bas, 66.4), "protéines 0,83 × 80 = 66,4 g");
verif(proche(r("glucides").bas, 300) && proche(r("glucides").haut, 412.5), "glucides 40-55 % de 3000 kcal / 4 = 300 à 412,5 g");
verif(proche(r("lipides").bas, 116.66666666666667) && proche(r("lipides").haut, 133.33333333333334), "lipides 35-40 % de 3000 kcal / 9 = 116,7 à 133,3 g");
verif(r("vitB8").bas === 40, "biotine : référence 40 µg pour mémoire");
verif(proche(r("vitB1").bas, 0.1 * 3000 * 0.004184), "B1 = 0,1 mg/MJ × 12,552 MJ");
verif(r("vitC").bas === 110, "vitamine C = 110 mg");
verif(r("manganese").bas === 2.8 && r("manganese").type === "min", "manganèse : à atteindre 2,8 mg");
verif(r("agmi") === null, "AG monoinsaturés : pas de référence");
verif(C.referenceConcrete(refs.nutriments.proteines, { poids: null, depense: null }).inconnue, "sans poids : référence inconnue");
verif(C.referenceConcrete(refs.nutriments.vitC, { poids: null, depense: null }).bas === 110, "sans poids : référence fixe connue");
verif(C.etatReference(2400, r("sodium")).etat === "depasse", "sodium 2400 mg > 2300 : dépassé");
verif(C.etatReference(2000, r("sodium")).etat === "ok", "sodium 2000 mg : ok");
verif(C.etatReference(250, r("glucides")).etat === "sous", "glucides sous la fourchette");
verif(proche(C.etatReference(55, r("vitC")).pct, 50), "vitamine C 55 mg = 50 %");

console.log("\nAffichage");
verif(C.formater(1234.56, "kcal") === "1 235", "kcal à l'unité", C.formater(1234.56, "kcal"));
verif(C.formater(12.345, "g") === "12,3", "g à 0,1");
verif(C.formater(0.012345, "mg") === "0,0123", "mg à 3 chiffres significatifs");
verif(C.formater(null, "mg") === "—", "null affiché —");
verif(C.libelleQuantite(parId.avocat, 0.5) === "½ avocat", "½ avocat");
verif(C.libelleQuantite(parId.oeuf, 1) === "1 œuf" && C.libelleQuantite(parId.oeuf, 2) === "2 œufs", "1 œuf, 2 œufs");
verif(C.libelleQuantite(parId.riz_complet, 150) === "150 g", "150 g");

console.log("\nJournée");
verif(C.jourLocal(new Date(2026, 10, 4, 23, 59)) === "2026-11-04", "date locale");
const e0 = { jour: "2026-11-04", journal: [{ id: "a" }], activite: { pas: 5, km: 1, seance: "jambes", creatine: true }, pesees: [{ date: "2026-11-04", kg: 80 }], reglages: { masseGrasse: 14 } };
verif(C.changementDeJour(e0, [], new Date(2026, 10, 4, 23, 59, 59)) === null, "même jour : rien");
const ch = C.changementDeJour(e0, [], new Date(2026, 10, 5, 0, 0, 1));
verif(ch.etat.jour === "2026-11-05" && ch.etat.journal.length === 0 && ch.etat.activite.km === 0, "minuit : journée vide");
verif(ch.historique.length === 1 && ch.historique[0].jour === "2026-11-04" && ch.historique[0].journal.length === 1 && ch.historique[0].activite.seance === "jambes", "minuit : veille archivée");
verif(ch.etat.pesees.length === 1 && ch.etat.reglages.masseGrasse === 14, "pesées et masse grasse conservées");
verif(e0.journal.length === 1, "état d'origine non modifié");
verif(C.decalerJour("2026-03-01", -1) === "2026-02-28", "décalage de date");

console.log("\nPresse-papiers");
const pp = (s) => JSON.stringify(C.analyserPressePapiers(s));
verif(pp("8 432 pas 6,21 km") === '{"km":6.21,"pas":8432}', "« 8 432 pas 6,21 km »", pp("8 432 pas 6,21 km"));
verif(pp("8 432 pas 6,21 km") === '{"km":6.21,"pas":8432}', "espaces fines et insécables");
verif(pp("Pas : 8432 ; Distance : 6.2 km") === '{"km":6.2,"pas":8432}', "« Pas : 8432 ; Distance : 6.2 km »");
verif(pp("6,2 km et 8432 pas") === '{"km":6.2,"pas":8432}', "« 6,2 km et 8432 pas »");
verif(pp("12 034 pas") === '{"pas":12034}', "pas seuls");
verif(pp("8,432 pas 6.21 km") === '{"km":6.21,"pas":8432}', "séparateur de milliers à virgule");
verif(C.analyserPressePapiers("bonjour") === null, "texte invalide : null");
verif(C.analyserPressePapiers("") === null && C.analyserPressePapiers(null) === null, "vide ou null : null");
verif(C.analyserPressePapiers("999999 pas") === null, "valeur absurde rejetée");

console.log("\nPesées");
const pes = [
  { date: "2026-11-01", kg: 80 },
  { date: "2026-11-03", kg: 81 },
  { date: "2026-11-10", kg: 79 },
];
verif(C.poidsDuJour(pes, "2026-11-04") === 81, "poids du jour = dernière pesée avant");
verif(C.poidsDuJour(pes, "2026-10-31") === null, "avant toute pesée : null");
const tab = C.tableauPesees(pes);
verif(tab[0].variation === null && tab[1].variation === 1 && tab[2].variation === -2, "variations");
verif(tab[1].moyenne7 === 80.5 && tab[2].moyenne7 === 79, "moyennes sur 7 jours");

console.log(echecs ? `\nÉCHEC : ${echecs} sur ${total} vérifications` : `\nOK : ${total} vérifications des calculs`);
process.exit(echecs ? 1 : 0);
