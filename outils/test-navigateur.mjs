// Tests dans un vrai navigateur (Edge headless via playwright-core), au format téléphone, par de vrais touchers.
//   1. ajout, suppression, annulation (4 cas recalculés à la main)   2. toute la grille
//   3. donnée manquante   4. persistance   5. remise à zéro manuelle   6. minuit (fausse horloge)
//   7. dépense, presse-papiers, affichage 375 px, thème sombre, hors ligne, réseau, console, stockage indisponible
// Lancer : node outils/test-navigateur.mjs   (captures d'écran dans outils/captures/)
//
// Accès de test : les totaux à pleine précision sont lus dans les attributs data-total de l'interface
// (lignes du Bilan « [data-cle] », en-tête « #e-kcal »…, dépense « #a-depense »). Aucun code de test dans l'appli.
import { chromium } from "playwright-core";
import { readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { demarrerServeur } from "./serveur.mjs";

const racine = join(dirname(fileURLToPath(import.meta.url)), "..");
const captures = join(racine, "outils", "captures");
mkdirSync(captures, { recursive: true });
const FOODS = JSON.parse(readFileSync(join(racine, "donnees", "foods.json"), "utf8"));

let echecs = 0;
let total = 0;
function verif(cond, msg, detail = "") {
  total++;
  if (cond) console.log("  ok   " + msg);
  else {
    echecs++;
    console.error("  ÉCHEC " + msg + (detail ? ` → ${detail}` : ""));
  }
}
const proche = (a, b) => typeof a === "number" && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));

const serveur = await demarrerServeur(0);
const BASE = `http://127.0.0.1:${serveur.address().port}/`;
const nav = await chromium.launch({ channel: "msedge" }).catch(() => chromium.launch({ channel: "chrome" }));
const erreursJs = [];
const requetesExternes = [];
let dialogues = 0;

const TELEPHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "fr-FR" };
async function nouveauContexte(opts = {}) {
  const ctx = await nav.newContext({ ...TELEPHONE, ...opts });
  ctx.on("request", (r) => {
    const u = new URL(r.url());
    // Seules les requêtes réseau comptent (pas data:, blob:, ni les pages internes du navigateur comme edge://downloads).
    if (/^(https?|wss?):$/.test(u.protocol) && !["127.0.0.1", "localhost"].includes(u.hostname)) requetesExternes.push(r.url());
  });
  const page = await ctx.newPage();
  surveiller(page);
  return { ctx, page };
}
function surveiller(page) {
  page.on("pageerror", (e) => erreursJs.push(e.message));
  page.on("console", (m) => m.type() === "error" && erreursJs.push(m.text()));
  page.on("dialog", (d) => {
    dialogues++;
    d.dismiss();
  });
}

// ---------- Gestes ----------
const toucher = (loc) => loc.tap();
const onglet = (page, nom) => toucher(page.locator(`.onglets [data-onglet="${nom}"]`));
async function ouvrir(page) {
  await page.goto(BASE);
  await page.locator(".aliment").first().waitFor({ state: "attached" });
}
async function ajouter(page, id, q) {
  const al = page.locator(`.aliment[data-id="${id}"]`);
  if (await al.locator(".quantites").isHidden()) await toucher(al.locator(".al-nom"));
  await toucher(al.locator(`.q[data-q="${q}"]`));
}
const annulerToast = (page) => toucher(page.locator('#toast.visible [data-act="annuler"]'));
// Totaux du Bilan à pleine précision : { cle: { total, incomplet } }.
const totaux = (page) =>
  page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll("#vue-bilan .ligne-nut[data-cle]")].map((el) => [
        el.dataset.cle,
        { total: el.dataset.total === "" ? null : Number(el.dataset.total), incomplet: el.dataset.incomplet === "1" },
      ]),
    ),
  );
const etatStocke = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("suivi-nutrition-v1")));
const histoStocke = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("suivi-nutrition-historique") || "[]"));
async function regler(page, act, d, n) {
  for (let i = 0; i < n; i++) await toucher(page.locator(`[data-act="${act}"][data-d="${d}"]`));
}
// Saisie au clavier : on tape le texte puis Entrée (qui valide le champ).
async function saisir(page, id, texte) {
  const champ = page.locator(`#${id}`);
  await toucher(champ);
  await champ.fill(texte);
  await champ.press("Enter");
}
async function peser(page, kg) {
  await onglet(page, "poids");
  const champ = page.locator("#p-brouillon");
  await toucher(champ);
  await champ.fill(typeof kg === "string" ? kg : String(kg).replace(".", ",")); // nombre : virgule ; texte : tel quel
  await toucher(page.locator('[data-act="enregistrer-poids"]'));
}

// Vérifie un ensemble de totaux attendus (nombres littéraux).
function verifTotaux(t, attendus, cas) {
  const faux = Object.entries(attendus).filter(([c, v]) => !proche(t[c]?.total, v));
  verif(faux.length === 0, `${cas} : ${Object.keys(attendus).join(", ")}`, faux.map(([c, v]) => `${c} = ${t[c]?.total} au lieu de ${v}`).join(" ; "));
}

// =================== 1. AJOUT, SUPPRESSION, ANNULATION ===================
console.log("\n1. Ajout, suppression et annulation (calculs à la main)");
{
  const { ctx, page } = await nouveauContexte();
  await ouvrir(page);
  // Cas 1 : 2 œufs = 2 × 50 g = 100 g de « Oeuf dur » (Ciqual 22010), teneurs brutes du XML pour 100 g :
  // énergie 134 kcal, protéines 13,5 g, glucides 0,52 g, lipides 8,62 g, B12 1,11 µg, fer 1,72 mg, calcium 41 mg,
  // sélénium 7,01 µg, potassium 120 mg, vitamine C 0 → apports = teneurs × 100/100.
  await ajouter(page, "oeuf", 2);
  verif((await page.locator("#toast.visible").textContent()).includes("Ajouté : 2 œufs"), "toast « Ajouté : 2 œufs » avec Annuler");
  verif(proche(Number(await page.locator("#e-kcal").getAttribute("data-total")), 134), "en-tête : 134 kcal tout de suite");
  verif(await page.locator("#e-incomplet").isHidden(), "en-tête : pas de marqueur « incomplet » (macros complètes)");
  verifTotaux(await totaux(page), { energie: 134, proteines: 13.5, glucides: 0.52, lipides: 8.62, vitB12: 1.11, fer: 1.72, calcium: 41, selenium: 7.01, potassium: 120, vitC: 0 }, "cas 1 (2 œufs)");

  // Cas 2 : + 1 kiwi vert = 90,8 g de « Kiwi, chair sans peau, avec pépins, cru » (13021) : énergie 60,9 ; protéines 0,88 ;
  // glucides 11 ; lipides 0,6 ; vit. C 81,9 mg ; calcium 29 mg ; fer 0,16 mg ; potassium 290 mg ; sélénium « < 20 » (0) ; B12 0.
  // Apports kiwi : 90,8 × 60,9 / 100 = 55,2972 kcal ; 0,79904 g P ; 9,988 g G ; 0,5448 g L ; 74,3652 mg C ;
  // 26,332 mg Ca ; 0,14528 mg Fe ; 263,32 mg K.
  // Totaux : 134 + 55,2972 = 189,2972 kcal ; P 14,29904 ; G 10,508 ; L 9,1648 ; C 74,3652 ; Ca 67,332 ; Fe 1,86528 ; K 383,32 ; Se 7,01 ; B12 1,11.
  await ajouter(page, "kiwi_vert", 1);
  verifTotaux(await totaux(page), { energie: 189.2972, proteines: 14.29904, glucides: 10.508, lipides: 9.1648, vitC: 74.3652, calcium: 67.332, fer: 1.86528, potassium: 383.32, selenium: 7.01, vitB12: 1.11 }, "cas 2 (+ 1 kiwi vert)");

  // Cas 3 : + 200 g de côte de porc pesée avec l'os, part comestible 0,66 → 132 g de « Porc, côte crue » (28100) :
  // énergie 164 → 216,48 kcal ; protéines 19,8 → 26,136 g ; fer 0,66 → 0,8712 mg ; potassium 350 → 462 mg ;
  // calcium 7,05 → 9,306 mg ; B12 0,35 → 0,462 µg ; vitamine C 0 ; sélénium « < 40 » → 0.
  // Totaux : 189,2972 + 216,48 = 405,7772 kcal ; P 14,29904 + 26,136 = 40,43504 ; Fe 1,86528 + 0,8712 = 2,73648 ;
  // K 383,32 + 462 = 845,32 ; Ca 67,332 + 9,306 = 76,638 ; B12 1,11 + 0,462 = 1,572 ; C 74,3652 ; Se 7,01.
  await ajouter(page, "cote_porc", 200);
  const cas3 = { energie: 405.7772, proteines: 40.43504, fer: 2.73648, potassium: 845.32, calcium: 76.638, vitB12: 1.572, vitC: 74.3652, selenium: 7.01 };
  verifTotaux(await totaux(page), cas3, "cas 3 (+ 200 g de côte de porc)");

  // Cas 4 : on supprime la ligne des œufs dans le Journal → il reste kiwi + porc :
  // 55,2972 + 216,48 = 271,7772 kcal ; P 0,79904 + 26,136 = 26,93504 ; C 74,3652 ; Ca 26,332 + 9,306 = 35,638 ;
  // Fe 0,14528 + 0,8712 = 1,01648 ; K 263,32 + 462 = 725,32 ; B12 0,462 ; Se 0.
  await onglet(page, "journal");
  verif((await page.locator(".j-ligne").count()) === 3, "journal : 3 lignes");
  const ligneOeuf = page.locator(".j-ligne", { hasText: "Œuf dur" });
  verif((await ligneOeuf.textContent()).includes("134"), "journal : la ligne des œufs affiche 134 kcal");
  await toucher(ligneOeuf.locator('[data-act="supprimer"]'));
  verifTotaux(await totaux(page), { energie: 271.7772, proteines: 26.93504, vitC: 74.3652, calcium: 35.638, fer: 1.01648, potassium: 725.32, vitB12: 0.462, selenium: 0 }, "cas 4 (œufs supprimés)");
  await annulerToast(page);
  verifTotaux(await totaux(page), cas3, "suppression annulée : retour au cas 3");
  verif((await page.locator(".j-ligne").first().textContent()).includes("Côte de porc"), "journal : ligne restaurée à sa place (le plus récent en haut)");
  // Ajout annulé : une banane puis « Annuler » ne change rien.
  await onglet(page, "aliments");
  await ajouter(page, "banane", 1);
  verif(!proche((await totaux(page)).energie.total, cas3.energie), "banane ajoutée");
  await annulerToast(page);
  verifTotaux(await totaux(page), cas3, "ajout de la banane annulé");
  verif((await etatStocke(page)).journal.length === 3, "stockage : 3 entrées");
  await onglet(page, "journal");
  await ctx.close();
}

// =================== 2. TOUTE LA GRILLE ===================
console.log("\n2. Toute la grille (chaque aliment, chaque quantité, chaque nutriment)");
{
  const { ctx, page } = await nouveauContexte();
  await ouvrir(page);
  let essais = 0;
  const erreurs = [];
  for (const al of FOODS.aliments) {
    const qs = [...al.quantites, ...(al.ajustement_g ? [al.ajustement_g] : [])];
    const poids = al.unite === "g" ? 1 : al.poids_unite_g;
    for (const q of qs) {
      await ajouter(page, al.id, q);
      const t = await totaux(page);
      for (const n of FOODS.nutriments) {
        if (n.ciqual.length === 0) {
          // Absent de la table (biotine) : jamais de total ni de marqueur « incomplet ».
          if (t[n.cle].total !== null || t[n.cle].incomplet) erreurs.push(`${al.id} × ${q} ${n.cle} : absent de la table mais total ${t[n.cle].total}`);
          continue;
        }
        const v = al.valeurs[n.cle].v;
        // Attendu : quantité × poids × part comestible × v / 100 ; null → rien ajouté (0) et total marqué incomplet.
        const att = v === null ? 0 : (q * poids * al.part_comestible * v) / 100;
        if (t[n.cle].total !== att || t[n.cle].incomplet !== (v === null)) erreurs.push(`${al.id} × ${q} ${n.cle} : ${t[n.cle].total} au lieu de ${att}`);
      }
      essais++;
      await annulerToast(page);
      if ((await page.locator("#e-kcal").getAttribute("data-total")) !== "0") erreurs.push(`${al.id} × ${q} : pas revenu à 0`);
    }
  }
  verif(erreurs.length === 0, `${essais} boutons × ${FOODS.nutriments.length} nutriments : valeur exacte (égalité stricte)`, erreurs.slice(0, 5).join(" ; "));
  verif(essais === FOODS.aliments.reduce((n, a) => n + a.quantites.length + (a.ajustement_g ? 1 : 0), 0), "tous les boutons testés, « +25 g » compris");
  await ctx.close();
}

// =================== 3. DONNÉE MANQUANTE ===================
console.log("\n3. Donnée manquante");
{
  const { ctx, page } = await nouveauContexte();
  await ouvrir(page);
  await ajouter(page, "echine_porc", 200);
  await ajouter(page, "orange", 1);
  await onglet(page, "bilan");
  const ligne = page.locator('#vue-bilan .ligne-nut[data-cle="vitC"]');
  verif((await ligne.getAttribute("data-incomplet")) === "1", "vitamine C : marquée incomplète");
  verif(await page.locator("#e-incomplet").isHidden(), "en-tête : macros de l'échine complètes, pas de marqueur");
  // Orange 13034 : 131 g × vit. C v/100 ; l'échine n'ajoute rien.
  const vOrange = FOODS.aliments.find((a) => a.id === "orange").valeurs.vitC.v;
  verif(Number(await ligne.getAttribute("data-total")) === (131 * vOrange) / 100, "vitamine C : total partiel = apport de l'orange");
  const bouton = ligne.locator('[data-act="manquants"]');
  verif((await bouton.textContent()).trim() === "incomplet", "marqueur « incomplet » visible");
  verif(await ligne.locator(".manquants").isHidden(), "liste des aliments manquants repliée");
  await toucher(bouton);
  const texte = await ligne.locator(".manquants").textContent();
  verif(texte.includes("Côte d'échine de porc") && !texte.includes("Orange"), "le toucher nomme « Côte d'échine de porc » (et pas l'orange)", texte);
  verif((await page.locator('#vue-bilan .ligne-nut[data-cle="omega"]').getAttribute("data-incomplet")) === "1", "rapport ω6/ω3 total incomplet");
  const la = page.locator('#vue-bilan .ligne-nut[data-cle="rapport_la_ala"]');
  verif((await la.getAttribute("data-incomplet")) === "1", "rapport linoléique / ALA incomplet (échine sans acides gras)");
  await toucher(la.locator('[data-act="manquants"]'));
  verif((await la.locator(".manquants").textContent()).includes("Côte d'échine de porc"), "rapport linoléique / ALA : le toucher nomme l'échine");
  verif((await page.locator('#vue-bilan .ligne-nut[data-cle="energie"]').getAttribute("data-incomplet")) === "0", "énergie : complète");
  // Biotine (absente de Ciqual) : ni total, ni barre, ni « incomplet », référence pour mémoire.
  const b8 = page.locator('#vue-bilan .ligne-nut[data-cle="vitB8"]');
  verif((await b8.getAttribute("data-total")) === "" && (await b8.getAttribute("data-incomplet")) === "0" && (await b8.locator(".barre, .marque-incomplet").count()) === 0, "biotine : sans total, sans barre, sans « incomplet »");
  verif((await b8.textContent()).includes("Absente de la table Ciqual 2025") && (await b8.textContent()).includes("40 µg (pour mémoire)"), "biotine : « Absente de la table Ciqual 2025 », référence 40 µg pour mémoire");
  // Les nutriments marqués « incomplet » sont exactement ceux où l'échine ou l'orange ont null (biotine exclue).
  const vals = (id) => FOODS.aliments.find((x) => x.id === id).valeurs;
  const attendusIncomplets = FOODS.nutriments.filter((n) => n.ciqual.length && (vals("echine_porc")[n.cle].v === null || vals("orange")[n.cle].v === null)).map((n) => n.cle);
  const incomplets = await page.locator('#vue-bilan .ligne-nut[data-incomplet="1"]').evaluateAll((els) => els.map((e) => e.dataset.cle).filter((c) => !["omega", "rapport_la_ala"].includes(c)));
  verif(JSON.stringify(incomplets) === JSON.stringify(attendusIncomplets), "« incomplet » exactement là où une donnée manque (biotine jamais)", `${incomplets} ≠ ${attendusIncomplets}`);
  // Fiche de l'échine : null affiché « non disponible », jamais 0.
  await onglet(page, "aliments");
  await toucher(page.locator('.al-info[data-id="echine_porc"]'));
  const lc = page.locator('#feuille .fiche-ligne[data-cle="vitC"]');
  verif((await lc.textContent()).includes("non disponible"), "fiche : vitamine C « non disponible »");
  verif((await page.locator('#feuille .fiche-ligne[data-cle="energie"]').textContent()).includes("Ciqual 28302"), "fiche : provenance Ciqual 28302");
  await toucher(page.locator('#feuille [data-act="fermer"]'));
  await toucher(page.locator('.al-info[data-id="avocat"]'));
  verif((await page.locator('#feuille .fiche-ligne[data-cle="vitC"]').textContent()).includes("traces"), "fiche avocat : vitamine C « traces » signalée telle quelle");
  await toucher(page.locator('#feuille [data-act="fermer"]'));
  verif(await page.locator("#feuille").isHidden(), "fiche refermée");
  await ctx.close();
}

// =================== 4. PERSISTANCE ===================
console.log("\n4. Persistance après rechargement");
{
  const { ctx, page } = await nouveauContexte();
  await ouvrir(page);
  await ajouter(page, "riz_complet", 100);
  await ajouter(page, "filet_poulet", 150);
  await peser(page, 81.3);
  await onglet(page, "activite");
  await saisir(page, "a-km", "4");
  await saisir(page, "a-pas", "3000");
  await toucher(page.locator('[data-act="seance"][data-id="jambes"]'));
  await toucher(page.locator('[data-act="creatine"]'));
  const avant = await totaux(page);
  await page.reload();
  await page.locator(".aliment").first().waitFor({ state: "attached" });
  const apres = await totaux(page);
  verif(JSON.stringify(avant) === JSON.stringify(apres), "totaux identiques après rechargement");
  verif((await page.locator("#vue-journal .j-ligne").count()) === 2, "journal : 2 lignes après rechargement");
  verif((await page.locator("#a-km").getAttribute("data-valeur")) === "4" && (await page.locator("#a-pas").getAttribute("data-valeur")) === "3000", "activité : 4 km et 3000 pas conservés");
  verif((await page.locator('[data-act="seance"][data-id="jambes"]').getAttribute("aria-pressed")) === "true", "séance « Jambes » conservée");
  verif((await page.locator('[data-act="creatine"]').getAttribute("aria-pressed")) === "true", "créatine conservée");
  verif((await page.locator(".pesees tbody tr").count()) === 1 && (await page.locator("#p-brouillon").getAttribute("data-valeur")) === "81.3", "pesée 81,3 kg conservée et préremplie");
  // Nouvelle page dans le même navigateur (appli fermée puis rouverte).
  const p2 = await ctx.newPage();
  surveiller(p2);
  await ouvrir(p2);
  verif((await p2.locator("#vue-journal .j-ligne").count()) === 2, "appli rouverte : journal conservé");
  await ctx.close();
}

// =================== 5. REMISE À ZÉRO MANUELLE ===================
console.log("\n5. Remise à zéro manuelle puis annulation");
{
  const { ctx, page } = await nouveauContexte();
  await ouvrir(page);
  await ajouter(page, "avocat", 0.5);
  await ajouter(page, "pomme", 2);
  await peser(page, 75);
  await onglet(page, "activite");
  await saisir(page, "a-km", "0,3");
  await toucher(page.locator('[data-act="seance"][data-id="dos_epaules"]'));
  const avant = { t: await totaux(page), etat: await etatStocke(page), histo: await histoStocke(page) };
  await onglet(page, "journal");
  await toucher(page.locator('[data-act="raz"]'));
  verif(await page.locator("#feuille").isVisible(), "confirmation dans une feuille (pas de window.confirm)");
  await toucher(page.locator('#feuille [data-act="raz-ok"]'));
  verif((await page.locator(".j-ligne").count()) === 0 && (await page.locator("#e-kcal").getAttribute("data-total")) === "0", "journal vidé, total à 0");
  const e1 = await etatStocke(page);
  verif(e1.activite.km === 0 && e1.activite.seance === null && e1.pesees.length === 1, "activité vidée, pesée gardée");
  const h1 = await histoStocke(page);
  verif(h1.length === avant.histo.length + 1 && h1.at(-1).motif === "manuel" && h1.at(-1).journal.length === 2, "journée archivée avant la remise à zéro");
  verif((await page.locator("#toast.visible").textContent()).includes("Annuler"), "toast « Annuler » affiché");
  await page.waitForTimeout(3000);
  verif(await page.locator("#toast.visible").isVisible(), "toast encore là après 3 s (durée ~8 s)");
  await annulerToast(page);
  verif(JSON.stringify(await totaux(page)) === JSON.stringify(avant.t), "annulation : totaux revenus");
  verif(JSON.stringify(await etatStocke(page)) === JSON.stringify(avant.etat), "annulation : journal, activité et pesées revenus à l'identique");
  verif(JSON.stringify(await histoStocke(page)) === JSON.stringify(avant.histo), "annulation : historique revenu (pas d'archive en double)");
  await ctx.close();
}

// =================== 6. MINUIT ===================
console.log("\n6. Passage de minuit (fausse horloge)");
{
  const ctx = await nav.newContext(TELEPHONE);
  const page = await ctx.newPage();
  surveiller(page);
  await page.clock.install({ time: new Date(2026, 10, 4, 23, 59, 0) });
  await ouvrir(page);
  await ajouter(page, "oeuf", 3);
  await ajouter(page, "riz_complet", 150);
  await peser(page, 78.4);
  await onglet(page, "activite");
  await saisir(page, "a-km", "2");
  await onglet(page, "journal");
  verif((await page.locator(".j-ligne").count()) === 2 && (await etatStocke(page)).jour === "2026-11-04", "23:59 : 2 ajouts le 4 novembre");
  await page.clock.runFor(2 * 60 * 1000); // l'appli reste ouverte ; la minuterie de 30 s voit minuit passer
  verif((await page.locator(".j-ligne").count()) === 0, "après minuit : journal vide à l'écran");
  verif((await page.locator("#e-kcal").getAttribute("data-total")) === "0", "après minuit : total à 0");
  verif((await page.locator("#vue-journal h2").textContent()).includes("5 novembre"), "après minuit : journal du 5 novembre");
  const e = await etatStocke(page);
  verif(e.jour === "2026-11-05" && e.journal.length === 0 && e.activite.km === 0, "stockage : nouvelle journée vide");
  const h = await histoStocke(page);
  verif(h.length === 1 && h[0].jour === "2026-11-04" && h[0].motif === "minuit" && h[0].journal.length === 2 && h[0].activite.km === 2, "historique : la veille (journal + activité)");
  verif(e.pesees.length === 1 && e.pesees[0].kg === 78.4, "pesée conservée");
  const etatStockage = await ctx.storageState();
  await ctx.close();

  // Appli fermée, rouverte le lendemain soir.
  const ctx2 = await nav.newContext({ ...TELEPHONE, storageState: etatStockage });
  const p2 = await ctx2.newPage();
  surveiller(p2);
  await p2.clock.install({ time: new Date(2026, 10, 6, 20, 15, 0) });
  await ouvrir(p2);
  const e2 = await etatStocke(p2);
  verif(e2.jour === "2026-11-06" && (await p2.locator("#vue-journal h2").textContent()).includes("6 novembre"), "rouverte le 6 : bonne date");
  const h2 = await histoStocke(p2);
  verif(h2.length === 2 && h2[0].jour === "2026-11-04" && h2[0].journal.length === 2 && h2[1].jour === "2026-11-05", "historique conservé (4 novembre intact, 5 archivé)");
  verif(e2.pesees.length === 1 && (await p2.locator(".pesees tbody tr").count()) === 1, "pesées conservées");
  await onglet(p2, "activite");
  verif((await p2.locator("#a-depense").getAttribute("data-total")) !== "", "dépense calculée avec la pesée de l'avant-veille");
  await ctx2.close();
}

// =================== 7. DÉPENSE, PRESSE-PAPIERS, AFFICHAGE, HORS LIGNE ===================
console.log("\n7a. Calcul de la dépense");
{
  const { ctx, page } = await nouveauContexte({ permissions: ["clipboard-read", "clipboard-write"] });
  await ouvrir(page);
  await onglet(page, "activite");
  verif((await page.locator("#a-depense").getAttribute("data-total")) === "", "sans pesée : dépense inconnue");
  verif((await page.locator("#vue-activite").textContent()).includes("saisis ton poids"), "sans pesée : invitation à saisir le poids");
  await onglet(page, "bilan");
  verif((await page.locator('#vue-bilan .ligne-nut[data-cle="proteines"] .nut-ref').textContent()).includes("—"), "sans pesée : référence des protéines « — »");
  await peser(page, 80);
  await onglet(page, "activite");
  const dep = async () => Number(await page.locator("#a-depense").getAttribute("data-total"));
  // 80 kg, 15 % : repos 370 + 21,6 × 68 = 1838,8 ; × (36,7 − 3,2 + 1,5)/24 = 1838,8 × 1,4583333333333333 = 2681,5833333333333
  verif(proche(await dep(), 2681.5833333333333), "80 kg, 15 % de masse grasse, sans activité : 2681,58 kcal");
  // Marche 6,2 km : 6,2 × (3,8 − 1,5) × 80 / 5 = 228,16
  await saisir(page, "a-km", "6,2");
  verif(proche(await dep(), 2681.5833333333333 + 228.16), "+ 6,2 km de marche : + 228,16 kcal");
  // Séances (80 kg) : séries × 3,5 min / 60 × (3,5 − 1,5) × 80
  const seances = { pecs_epaules: 112, dos_epaules: 112, jambes: 93.33333333333333, jambes_epaules: 149.33333333333334 };
  for (const [id, kcal] of Object.entries(seances)) {
    await toucher(page.locator(`[data-act="seance"][data-id="${id}"]`));
    verif(proche(await dep(), 2681.5833333333333 + 228.16 + kcal), `séance ${id} : + ${kcal.toFixed(2)} kcal`);
    verif((await page.locator('[data-act="seance"][aria-pressed="true"]').count()) === 1, `séance ${id} : une seule séance choisie`);
  }
  await toucher(page.locator('[data-act="seance"][data-id="jambes_epaules"]'));
  verif(proche(await dep(), 2681.5833333333333 + 228.16), "retoucher la séance l'annule");
  // Masse grasse 14 % : repos = 370 + 21,6 × 80 × 0,86 = 1856,08 ; × 1,4583333333333333 = 2706,7833333
  await onglet(page, "poids");
  await regler(page, "mg", "-0.5", 2);
  await onglet(page, "activite");
  verif(proche(await dep(), 1856.08 * 1.4583333333333333 + 228.16), "masse grasse 14 % : dépense recalculée");
  await onglet(page, "bilan");
  // Protéines (sportif de force, Afssa 2007) : 1,3 × 80 = 104 g à 2,5 × 80 = 200 g
  verif(/104,0 à 200,0/.test(await page.locator('#vue-bilan .ligne-nut[data-cle="proteines"] .nut-ref').textContent()), "référence des protéines : 104,0 à 200,0 g");

  console.log("\n7b. Presse-papiers (Raccourci)");
  await onglet(page, "activite");
  const coller = async (texte) => {
    await page.evaluate((t) => navigator.clipboard.writeText(t), texte);
    await page.evaluate(() => document.querySelector(".message")?.remove()); // attendre le message de CET import
    await toucher(page.locator('[data-act="importer"]'));
    await page.locator(".message").waitFor();
    return { km: await page.locator("#a-km").getAttribute("data-valeur"), pas: await page.locator("#a-pas").getAttribute("data-valeur"), msg: await page.locator(".message").textContent() };
  };
  const variantes = [
    ["8 432 pas 6,21 km", "6.21", "8432"],
    ["8 432 pas 6,21 km", "6.21", "8432"],
    ["Pas : 9432 ; Distance : 6.2 km", "6.2", "9432"],
    ["7,5 km et 10432 pas", "7.5", "10432"],
  ];
  for (const [txt, km, pas] of variantes) {
    const r = await coller(txt);
    verif(r.km === km && r.pas === pas, `« ${txt} » → ${km} km, ${pas} pas`, JSON.stringify(r));
  }
  const r = await coller("liste de courses : pain, œufs");
  verif(r.km === "7.5" && r.pas === "10432" && r.msg.includes("non reconnu"), "texte invalide : rien ne change, message clair", JSON.stringify(r));
  await onglet(page, "poids");
  await ctx.close();
}

console.log("\n7c. Affichage à 375 px, cibles de 48 px, captures");
{
  const { ctx, page } = await nouveauContexte({ viewport: { width: 375, height: 740 } });
  await page.clock.install({ time: new Date(2026, 10, 1, 9, 0, 0) });
  await ouvrir(page);
  // Quelques pesées sur plusieurs jours pour la courbe.
  for (const [j, kg] of [[1, 80.4], [2, 80.1], [3, 80.6], [4, 79.9]]) {
    await page.clock.setSystemTime(new Date(2026, 10, j, 9, 0, 0));
    await peser(page, kg);
  }
  await onglet(page, "aliments");
  await ajouter(page, "oeuf", 2);
  await ajouter(page, "echine_porc", 250);
  await ajouter(page, "pain_graines", 3);
  await onglet(page, "activite");
  await toucher(page.locator('[data-act="seance"][data-id="jambes"]'));
  await page.clock.runFor(10000); // horloge simulée : laisser le dernier toast disparaître avant les captures
  async function controle(nom) {
    const pb = await page.evaluate(() => {
      const larg = document.documentElement.clientWidth;
      const res = [];
      if (document.documentElement.scrollWidth > larg) res.push(`défilement horizontal (${document.documentElement.scrollWidth} > ${larg})`);
      const visible = (el) => {
        const s = getComputedStyle(el);
        const rc = el.getBoundingClientRect();
        return s.visibility !== "hidden" && s.display !== "none" && rc.width > 0 && rc.height > 0 && !el.closest("[hidden], .visuellement-cache, #toast:not(.visible), .table-defil");
      };
      for (const el of document.querySelectorAll("body *")) {
        if (!visible(el)) continue;
        const rc = el.getBoundingClientRect();
        if (rc.right > larg + 0.5 || rc.left < -0.5) res.push(`dépasse : <${el.tagName.toLowerCase()} class="${el.className.baseVal ?? el.className}">`);
      }
      for (const el of document.querySelectorAll("button, summary, a[href]")) {
        if (!visible(el)) continue;
        const rc = el.getBoundingClientRect();
        if (rc.height < 47.5 || rc.width < 47.5) res.push(`cible trop petite : « ${el.textContent.trim().slice(0, 25)} » ${Math.round(rc.width)}×${Math.round(rc.height)}`);
      }
      return res;
    });
    verif(pb.length === 0, `375 px : ${nom}`, pb.slice(0, 6).join(" ; "));
  }
  for (const o of ["aliments", "journal", "bilan", "activite", "poids"]) {
    await onglet(page, o);
    if (o === "aliments") await toucher(page.locator('.aliment[data-id="cote_porc"] .al-nom'));
    await page.locator(`#vue-${o} details`).evaluateAll((ds) => ds.forEach((d) => (d.open = true))); // aides et sources dépliées
    await controle(o);
  }
  verif((await page.locator(".courbe path.c-poids").count()) === 1 && (await page.locator(".courbe circle").count()) === 4 && (await page.locator(".courbe .c-moy").count()) === 0, "courbe SVG : 4 pesées, sans moyenne sur 7 jours");
  verif((await page.locator(".pesees thead").textContent()).includes("Variation") && !(await page.locator(".pesees thead").textContent()).includes("Moy"), "tableau : colonne « Variation », plus de moyenne");
  verif((await page.locator("#vue-poids").textContent()).includes("tendance sur plusieurs semaines"), "note créatine : tendance sur plusieurs semaines");
  verif((await page.locator("#vue-poids").textContent()).includes("créatine"), "note sur la créatine sous la courbe");
  await onglet(page, "aliments");
  await toucher(page.locator('.al-info[data-id="pain_graines"]'));
  await controle("fiche ouverte");
  verif((await page.locator('#feuille .fiche-ligne[data-cle="energie"]').textContent()).includes("Étiquette : fiche produit Système U"), "fiche pain : énergie « Étiquette » (fiche Système U)");
  verif((await page.locator('#feuille .fiche-ligne[data-cle="vitC"]').textContent()).includes("Estimé"), "fiche pain : vitamine C « Estimé »");
  verif((await page.locator("#feuille .fiche-ligne").count()) === FOODS.nutriments.length, `fiche : les ${FOODS.nutriments.length} nutriments suivis`);
  verif((await page.locator('#feuille .fiche-ligne[data-cle="vitB8"]').textContent()).includes("absente de Ciqual"), "fiche : biotine « absente de Ciqual »");
  await ctx.close();
}

console.log("\n7d. Thème sombre");
{
  const { ctx, page } = await nouveauContexte({ colorScheme: "dark" });
  await ouvrir(page);
  await ajouter(page, "kiwi_jaune", 2);
  await ajouter(page, "lapin", 300);
  const fond = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  verif(fond === "rgb(22, 21, 20)", "fond sombre appliqué", fond);
  await onglet(page, "bilan");
  await ctx.close();
}

console.log("\n7e. Hors ligne (service worker)");
{
  const { ctx, page } = await nouveauContexte();
  await ouvrir(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise((ok) => navigator.serviceWorker.addEventListener("controllerchange", ok, { once: true }));
  });
  const enCache = await page.evaluate(async () => {
    const cles = await caches.keys();
    const c = await caches.open(cles.find((k) => k.startsWith("suivi-nutrition-")));
    return (await c.keys()).map((r) => new URL(r.url).pathname);
  });
  verif(["/donnees/foods.json", "/donnees/references.json", "/donnees/activite.json", "/icons/icon-192.png", "/calculs.js"].every((f) => enCache.includes(f)), `service worker : ${enCache.length} fichiers en cache, données et icônes comprises`);
  verif(!enCache.some((f) => f.includes("/sources/")), "sources/ jamais en cache");
  await ajouter(page, "brocolis", 300);
  await ctx.setOffline(true);
  await page.reload();
  await page.locator(".aliment").first().waitFor({ state: "attached", timeout: 10000 });
  verif((await page.locator(".aliment").count()) === FOODS.aliments.length, "sans réseau : l'appli s'ouvre avec tous les aliments");
  await ajouter(page, "haricots_verts", 150);
  await onglet(page, "journal");
  verif((await page.locator(".j-ligne").count()) === 2, "sans réseau : ajout possible, journal complet");
  await ctx.close();
}

console.log("\n7f. Unités d'affichage, teneurs brutes, textes visibles");
{
  const { ctx, page } = await nouveauContexte();
  await ouvrir(page);
  await peser(page, 80); // pour afficher la dépense et toutes les références
  verif((await page.locator('#vue-bilan .ligne-nut[data-cle="rapport_la_ala"] .nut-val').textContent()) === "—", "linoléique / ALA sans ALA : « — »");
  await onglet(page, "aliments");
  // 2 œufs = 100 g ; EPA 0,0042 g/100 g (22010) → 0,0042 g, affiché 4,2 mg ; référence 0,25 g → « 250 mg ».
  // Arachidonique 0,1 g/100 g → 0,1 g, affiché 100 mg.
  await ajouter(page, "oeuf", 2);
  await onglet(page, "bilan");
  const epa = page.locator('#vue-bilan .ligne-nut[data-cle="epa"]');
  verif((await epa.locator(".nut-val").textContent()).trim() === "4,2 mg", "EPA : total affiché en mg (4,2 mg)", await epa.locator(".nut-val").textContent());
  verif((await epa.getAttribute("data-total")) === "0.0042", "EPA : data-total en g, pleine précision");
  const refEpa = await epa.locator(".nut-ref").textContent();
  verif(refEpa.includes("250 mg") && !refEpa.includes(" g"), "EPA : référence « 250 mg »", refEpa);
  verif((await page.locator('#vue-bilan .ligne-nut[data-cle="arachidonique"] .nut-val').textContent()).trim() === "100 mg", "arachidonique : 0,1 g affiché 100 mg");
  verif((await page.locator("#vue-bilan .energie").textContent()).includes("marche 3,8 MET, salle 3,5 MET"), "sources de la dépense au format français (3,8 MET)");
  // Rapport linoléique / ALA, 2 œufs : 1,2 / 0,052 = 23,076923076923077 > 5 → « dépasse », barre en alerte.
  const la = page.locator('#vue-bilan .ligne-nut[data-cle="rapport_la_ala"]');
  verif(proche(Number(await la.getAttribute("data-total")), 23.076923076923077) && (await la.locator(".nut-val").textContent()) === "23,1", "linoléique / ALA (2 œufs) = 23,1");
  verif((await la.textContent()).includes("À ne pas dépasser : 5") && (await la.getAttribute("data-etat")) === "depasse" && (await la.locator(".barre.e-depasse").count()) === 1, "référence 5 « à ne pas dépasser », état dépassé, barre en alerte");
  verif((await la.textContent()).includes("avis 2016"), "note de la référence affichée");
  verif((await la.getAttribute("data-incomplet")) === "0", "linoléique / ALA complet avec les œufs");
  const om = page.locator('#vue-bilan .ligne-nut[data-cle="omega"]');
  // ω6/ω3 total, 2 œufs : (1,2 + 0,1) / (0,052 + 0,0042 + 0,032) = 1,3 / 0,0882 = 14,739229024943311
  verif(proche(Number(await om.getAttribute("data-total")), 14.739229024943311) && (await om.locator(".barre").count()) === 0, "ω6/ω3 total (2 œufs) = 14,7, sans référence ni barre");
  // Fiches : teneur exacte de la table pour 100 g.
  await onglet(page, "aliments");
  const fiche = async (id, cle) => {
    await toucher(page.locator(`.al-info[data-id="${id}"]`));
    const t = await page.locator(`#feuille .fiche-ligne[data-cle="${cle}"] .fiche-100`).evaluate((el) => el.firstChild.textContent);
    await toucher(page.locator('#feuille [data-act="fermer"]'));
    return t;
  };
  const f = async (id, cle, attendu, msg) => {
    const t = await fiche(id, cle);
    verif(t === attendu, msg, t);
  };
  await f("oeuf", "fer", "1,72 mg", "fiche œuf : fer « 1,72 mg » (brut de la table)");
  await f("oeuf", "epa", "0,0042 g (4,2 mg)", "fiche œuf : EPA « 0,0042 g (4,2 mg) »");
  await f("pain_complet", "arachidonique", "< 0,003 g (compté 0)", "fiche pain : « < 0,003 g (compté 0) »");
  await f("avocat", "glucides", "traces (compté 0)", "fiche avocat : glucides « traces (compté 0) »");
  await f("echine_porc", "vitC", "non disponible", "fiche échine : vitamine C « non disponible »");
  // Aucun nom de clé technique ni nombre à point décimal visibles (citations bibliographiques exclues : DOI, n° de tableau).
  const CLES = ["facteur_journee", "met_assis", "pct_ae", "par_kg", "par_mj", "kcal_par_g", "source_valeurs", "a_confirmer", "poids_unite_g", "masse_grasse_pct", "vitesse_kmh", "minutes_effort"];
  const problemes = [];
  const controler = async (ou) => {
    const t = await page.evaluate(() => {
      const c = document.body.cloneNode(true);
      c.querySelectorAll(".citation, script, style").forEach((e) => e.remove());
      return c.textContent;
    });
    for (const k of CLES) if (t.includes(k)) problemes.push(`${ou} : « ${k} »`);
    for (const m of t.match(/\d\.\d+/g) || []) problemes.push(`${ou} : nombre à point « ${m} »`);
  };
  for (const o of ["aliments", "journal", "bilan", "activite", "poids"]) {
    await onglet(page, o);
    await page.locator("details").evaluateAll((ds) => ds.forEach((d) => (d.open = true)));
    await controler(o);
  }
  await onglet(page, "aliments");
  for (const al of FOODS.aliments) {
    await toucher(page.locator(`.al-info[data-id="${al.id}"]`));
    await controler(`fiche ${al.id}`);
    await toucher(page.locator('#feuille [data-act="fermer"]'));
  }
  // Nutriments retirés de la liste : aucune ligne, aucun nom visible dans le Bilan, l'en-tête et les fiches.
  const RETIRES = ["sucres", "amidon", "fibres", "ags", "agmi", "agpi", "cholesterol", "retinol", "betacarotene", "folatesNat", "acideFolique", "iode", "sel"];
  const NOMS_RETIRES = ["dont sucres", "amidon", "Fibres", "saturés", "monoinsaturés", "polyinsaturés", "Cholestérol", "rétinol", "Bêta-carotène", "folates naturels", "acide folique", "Iode", "Sel"];
  const vus = await page.evaluate(() => ({
    cles: [...document.querySelectorAll("[data-cle]")].map((e) => e.dataset.cle),
    noms: [...document.querySelectorAll("#entete, .nut-nom, .fiche-nom")].map((e) => e.textContent).join(" | "),
    lignes: document.querySelectorAll("#vue-bilan .ligne-nut[data-cle]").length,
  }));
  verif(!vus.cles.some((c) => RETIRES.includes(c)) && !NOMS_RETIRES.some((n) => vus.noms.includes(n)), "aucun nutriment retiré dans l'interface (en-tête, Bilan)", vus.cles.filter((c) => RETIRES.includes(c)).join());
  verif(vus.lignes === FOODS.nutriments.length + 2, `Bilan : ${FOODS.nutriments.length} nutriments + 2 rapports`, String(vus.lignes));
  await toucher(page.locator('.al-info[data-id="pain_complet"]'));
  const nomsFiche = await page.locator("#feuille .fiche-nom").allTextContents();
  verif(nomsFiche.length === FOODS.nutriments.length && !NOMS_RETIRES.some((n) => nomsFiche.join("|").includes(n)), "fiche : seulement les nutriments suivis");
  await toucher(page.locator('#feuille [data-act="fermer"]'));
  verif(problemes.length === 0, `5 onglets et ${FOODS.aliments.length} fiches : aucune clé technique, aucun nombre à point décimal`, problemes.slice(0, 6).join(" ; "));
  verif(!(await page.locator("#vue-bilan").textContent()).includes("Pour éditer ce fichier"), "Bilan : le champ « format » de references.json n'est pas affiché");
  await ctx.close();
}

console.log("\n7h. Saisie au clavier (pas, distance, poids), zoom au double toucher");
{
  const { ctx, page } = await nouveauContexte();
  await ouvrir(page);
  await onglet(page, "activite");
  // Valeurs valides, virgule et point, puis rechargement.
  await saisir(page, "a-km", "6,25");
  await saisir(page, "a-pas", "8 432");
  verif((await page.locator("#a-km").getAttribute("data-valeur")) === "6.25" && (await page.locator("#a-km").inputValue()) === "6,25", "distance « 6,25 » enregistrée");
  verif((await page.locator("#a-pas").getAttribute("data-valeur")) === "8432", "pas « 8 432 » enregistrés");
  // Enregistrement à la perte du focus (sans Entrée) : on tape puis on touche ailleurs.
  await toucher(page.locator("#a-km"));
  await page.locator("#a-km").fill("7.5");
  await toucher(page.locator("#vue-activite h2").first());
  verif((await etatStocke(page)).activite.km === 7.5, "distance « 7.5 » (point) enregistrée à la perte du focus");
  await peser(page, "81.4");
  verif((await etatStocke(page)).pesees.at(-1).kg === 81.4, "poids « 81.4 » (point) enregistré");
  await peser(page, 81.6);
  verif((await etatStocke(page)).pesees.length === 1 && (await etatStocke(page)).pesees[0].kg === 81.6, "poids « 81,6 » (virgule) : remplace la pesée du jour");
  await page.reload();
  await page.locator(".aliment").first().waitFor({ state: "attached" });
  verif((await page.locator("#a-km").inputValue()) === "7,5" && (await page.locator("#a-pas").inputValue()) === "8432", "après rechargement : 7,5 km et 8432 pas dans les champs");
  verif((await page.locator("#p-brouillon").inputValue()) === "81,6", "après rechargement : poids prérempli 81,6");
  // Saisies invalides : message clair, rien d'enregistré, rien d'effacé.
  const avant = JSON.stringify(await etatStocke(page));
  await onglet(page, "activite");
  for (const [id, texte, motif] of [["a-km", "abc", "nombre"], ["a-km", "301", "entre 0 et 300"], ["a-pas", "12,5", "entier"], ["a-pas", "250000", "entre 0 et 200"]]) {
    await saisir(page, id, texte);
    const msg = (await page.locator(`#${id}-err`).textContent()) || "";
    verif((await page.locator(`#${id}-err`).isVisible()) && msg.toLowerCase().includes(motif) && (await page.locator(`#${id}`).inputValue()) === texte, `« ${texte} » refusé : message « ${msg} », texte gardé`);
  }
  verif(JSON.stringify(await etatStocke(page)) === avant, "saisies invalides : rien n'est enregistré");
  await saisir(page, "a-km", "5");
  verif(await page.locator("#a-km-err").isHidden(), "valeur corrigée : le message disparaît");
  await onglet(page, "poids");
  const champPoids = page.locator("#p-brouillon");
  await toucher(champPoids);
  await champPoids.fill("25");
  await toucher(page.locator('[data-act="enregistrer-poids"]'));
  verif((await page.locator("#p-brouillon-err").textContent()).includes("entre 30 et 300") && (await etatStocke(page)).pesees[0].kg === 81.6, "poids 25 kg refusé : message, pesée inchangée");
  // Police des champs ≥ 16 px (sinon iOS zoome) et pas de zoom au double toucher.
  const polices = await page.locator("input").evaluateAll((els) => els.map((e) => parseFloat(getComputedStyle(e).fontSize)));
  verif(polices.length === 3 && polices.every((t) => t >= 16), `police des 3 champs ≥ 16 px (${polices.join(", ")} px)`);
  const touch = await page.evaluate(() => ({
    html: getComputedStyle(document.documentElement).touchAction,
    boutons: [...document.querySelectorAll("button, input, summary")].filter((e) => getComputedStyle(e).touchAction !== "manipulation").length,
    total: document.querySelectorAll("button").length,
    viewport: document.querySelector('meta[name="viewport"]').content,
  }));
  verif(touch.html === "manipulation" && touch.boutons === 0 && touch.total > 100, `touch-action: manipulation sur html et les ${touch.total} boutons`);
  verif(!touch.viewport.includes("user-scalable") && !touch.viewport.includes("maximum-scale"), "zoom à deux doigts non bloqué (viewport)");
  await ctx.close();
}

console.log("\n8. Captures (390 × 844, plein écran, clair et sombre)");
for (const theme of ["clair", "sombre"]) {
  const { ctx, page } = await nouveauContexte({ colorScheme: theme === "clair" ? "light" : "dark" });
  await page.clock.install({ time: new Date(2026, 9, 5, 8, 0, 0) });
  await ouvrir(page);
  for (const [m, j, kg] of [[9, 5, 81.6], [9, 12, 81.1], [9, 19, 80.9], [9, 26, 80.3], [10, 2, 79.7]]) { // une pesée par semaine, le lundi
    await page.clock.setSystemTime(new Date(2026, m, j, 8, 0, 0));
    await peser(page, kg);
  }
  await page.clock.setSystemTime(new Date(2026, 10, 5, 12, 30, 0));
  await onglet(page, "aliments");
  await ajouter(page, "oeuf", 2);
  await ajouter(page, "pain_complet", 2);
  await ajouter(page, "avocat", 0.5);
  await ajouter(page, "filet_poulet", 200);
  await ajouter(page, "riz_complet", 100);
  await ajouter(page, "kiwi_vert", 2);
  await onglet(page, "activite");
  await saisir(page, "a-pas", "8432");
  await saisir(page, "a-km", "6,2");
  await toucher(page.locator('[data-act="seance"][data-id="jambes"]'));
  await page.clock.runFor(10000); // le dernier toast disparaît
  const capture = async (nom) => {
    // L'horloge simulée fige les animations : on retire le reflet d'ajout encore affiché.
    await page.evaluate(() => document.querySelectorAll(".flash").forEach((b) => b.classList.remove("flash")));
    await page.screenshot({ path: join(captures, `${theme}-${nom}.png`) });
  };
  await onglet(page, "aliments");
  await toucher(page.locator('.aliment[data-id="filet_poulet"] .al-nom'));
  await page.locator('.categorie[data-cat="Viandes et poissons"]').scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -40));
  await capture("aliments");
  for (const o of ["journal", "bilan", "activite", "poids"]) {
    await onglet(page, o);
    await capture(o);
    if (o === "bilan") {
      // Deuxième vue du Bilan : les nutriments avec leurs barres.
      await page.locator("#vue-bilan .carte").nth(1).evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 120));
      await capture("bilan-nutriments");
    }
  }
  await onglet(page, "aliments");
  await toucher(page.locator('.al-info[data-id="oeuf"]'));
  await capture("fiche");
  await toucher(page.locator('#feuille [data-act="fermer"]'));
  await onglet(page, "journal");
  await toucher(page.locator('[data-act="raz"]'));
  await capture("confirmation");
  await ctx.close();
}
verif(true, "captures écrites dans outils/captures/");

console.log("\n9. Bilan de la semaine et export");
// Semaine du lundi 2 au dimanche 8 novembre 2026, remplie jour après jour, appli ouverte (passages de minuit).
// Œuf dur 50 g = 67 kcal et 6,75 g de protéines. 80 kg, 15 % : journée sédentaire = 1838,8 × 35/24 = 2681,5833 kcal.
async function construireSemaine(page) {
  await page.clock.install({ time: new Date(2026, 10, 2, 8, 0, 0) });
  await ouvrir(page);
  await peser(page, 80);
  await onglet(page, "aliments");
  await ajouter(page, "oeuf", 2); // lundi : 134 kcal
  const lendemain = async (j) => {
    await page.clock.setSystemTime(new Date(2026, 10, j, 8, 0, 0));
    await page.clock.runFor(31000); // la minuterie de 30 s voit le changement de jour
  };
  await lendemain(3); // mardi : rien (non rempli)
  await lendemain(4); // mercredi : 4 œufs, 5 km
  await onglet(page, "aliments");
  await ajouter(page, "oeuf", 4);
  await onglet(page, "activite");
  await saisir(page, "a-km", "5");
  await lendemain(5); // jeudi (aujourd'hui) : pesée 79,5 kg, 1 œuf
  await peser(page, 79.5);
  await onglet(page, "aliments");
  await ajouter(page, "oeuf", 1);
  await page.clock.runFor(10000);
  await onglet(page, "bilan");
  await toucher(page.locator('[data-act="bilan-vue"][data-vue="semaine"]'));
}
{
  const { ctx, page } = await nouveauContexte();
  // Pas de menu de partage dans ce navigateur de test : l'export passe par le téléchargement.
  await ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, "canShare", { value: undefined, configurable: true }));
  await construireSemaine(page);
  const jours = await page.locator(".semaine .sj").evaluateAll((els) => els.map((e) => ({ date: e.dataset.date, etat: e.dataset.etat, solde: e.dataset.solde ? Number(e.dataset.solde) : null })));
  verif(jours.length === 7 && jours.map((j) => j.etat).join() === "rempli,non rempli,rempli,rempli,à venir,à venir,à venir", "7 lignes : lundi rempli, mardi non rempli, mercredi et jeudi remplis, 3 à venir", jours.map((j) => j.etat).join());
  // Lundi : 134 − 2681,5833 = −2547,5833 ; mercredi : 268 − (2681,5833 + 5 × 2,3 × 80 / 5 = 184) = −2597,5833 ;
  // jeudi : 67 − 1829,62 × 35/24 (79,5 kg) = 67 − 2668,1958 = −2601,1958.
  verif(proche(jours[0].solde, -2547.5833333333333) && proche(jours[2].solde, -2597.5833333333333) && proche(jours[3].solde, -2601.195833333333), "soldes du lundi, du mercredi et du jeudi");
  verif((await page.locator('.sj[data-date="2026-11-02"] .sj-solde.deficit').textContent()) === "−2 548", "lundi : « −2 548 » en vert (déficit)");
  // Total : 469 − (2681,5833 + 2865,5833 + 2668,1958 = 8215,3625) = −7746,3625 ; moyenne −2582,12 ; protéines 47,25 / 3 = 15,75 g.
  const verdict = page.locator(".verdict");
  verif(proche(Number(await verdict.getAttribute("data-solde")), -7746.3625) && (await verdict.getAttribute("data-jours")) === "3", "solde de la semaine −7746,36 sur 3 jours");
  verif((await verdict.locator(".verdict-texte").textContent()) === "Déficit de 7 746 kcal sur la semaine (3 jours remplis)", "verdict « Déficit de 7 746 kcal sur la semaine (3 jours remplis) »");
  const suite = await verdict.textContent();
  verif(suite.includes("−2 582 kcal par jour") && suite.includes("15,8 g par jour") && suite.includes("Poids de début : 80,0 kg (lun. 02/11). Résultat à la pesée de lundi prochain (09/11)."), "moyenne par jour, protéines et poids (résultat attendu lundi prochain)", suite);
  verif((await page.locator("#vue-bilan .aide").textContent()).includes("estimation") && (await page.locator(".dimanche").count()) === 0, "phrase sur l'estimation ; pas de rappel du dimanche un jeudi");
  verif(await page.locator('[data-act="semaine"][data-d="7"]').isDisabled(), "pas de semaine après la semaine en cours");
  await page.locator(".verdict").evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().bottom + window.scrollY - window.innerHeight + 80)); // verdict visible
  await page.screenshot({ path: join(captures, "clair-semaine.png") });
  // Navigation entre semaines.
  await toucher(page.locator('[data-act="semaine"][data-d="-7"]'));
  verif((await page.locator(".semaine-titre").textContent()) === "Du 26 octobre au 1 novembre" && (await page.locator('.sj[data-etat="non rempli"]').count()) === 7, "semaine précédente : 7 jours non remplis");
  verif((await page.locator(".verdict-texte").textContent()).startsWith("Aucun jour rempli"), "semaine précédente : pas de verdict chiffré");
  await toucher(page.locator('[data-act="semaine"][data-d="7"]'));
  verif((await page.locator(".semaine-titre").textContent()) === "Du 2 au 8 novembre", "retour à la semaine en cours");
  // Le jour reste accessible.
  await toucher(page.locator('[data-act="bilan-vue"][data-vue="jour"]'));
  verif((await page.locator('#vue-bilan .ligne-nut[data-cle="energie"]').getAttribute("data-total")) === "67", "« Jour » : bilan du jour (1 œuf = 67 kcal)");
  await toucher(page.locator('[data-act="bilan-vue"][data-vue="semaine"]'));

  // Export : téléchargement d'un CSV pour Excel.
  const [dl] = await Promise.all([page.waitForEvent("download"), toucher(page.locator('[data-act="exporter"]'))]);
  verif(dl.suggestedFilename() === "bilan-semaine-2026-11-02.csv", "fichier « bilan-semaine-2026-11-02.csv »", dl.suggestedFilename());
  const octets = readFileSync(await dl.path());
  verif(octets[0] === 0xef && octets[1] === 0xbb && octets[2] === 0xbf, "UTF-8 avec BOM");
  const lignes = octets.toString("utf8").slice(1).split("\r\n");
  verif(lignes.length === 20 && lignes[6].split(";").length === 14, "19 lignes, 14 colonnes séparées par « ; »");
  verif(lignes[7] === "2026-11-02;lundi;rempli;134;2682;-2548;13,5;0,5;8,6;0;0,00;;non;80,0", "ligne du lundi", lignes[7]);
  verif(lignes[9].startsWith("2026-11-04;mercredi;rempli;268;2866;-2598;27,0;") && lignes[9].includes(";5,00;"), "ligne du mercredi (5 km)", lignes[9]);
  verif(lignes[15] === "Total (jours comptés);;3 jours;469;8215;-7746", "ligne de total", lignes[15]);
  verif(lignes[18] === "Verdict;Déficit de 7 746 kcal sur la semaine (3 jours remplis)", "verdict dans le fichier", lignes[18]);

  // iPhone : menu de partage quand il accepte le fichier ; annulation sans erreur ni téléchargement.
  await page.evaluate(() => {
    navigator.canShare = () => true;
    navigator.share = async ({ files }) => {
      const octets = new Uint8Array(await files[0].arrayBuffer()); // text() retirerait le BOM
      window.partage = { nom: files[0].name, bom: [...octets.slice(0, 3)].join(), debut: new TextDecoder("utf-8", { ignoreBOM: true }).decode(octets).slice(1, 20) };
    };
  });
  let telechargements = 0;
  page.on("download", () => telechargements++);
  await toucher(page.locator('[data-act="exporter"]'));
  await page.waitForFunction(() => window.partage);
  const partage = await page.evaluate(() => window.partage);
  verif(partage.nom === "bilan-semaine-2026-11-02.csv" && partage.bom === "239,187,191" && partage.debut.startsWith("Bilan de la semaine"), "partage : fichier transmis au menu de partage", JSON.stringify(partage));
  await page.evaluate(() => {
    navigator.share = async () => {
      throw new DOMException("annulé", "AbortError");
    };
  });
  await toucher(page.locator('[data-act="exporter"]'));
  await page.clock.runFor(1000);
  verif(telechargements === 0, "partage annulé : ni erreur ni téléchargement");

  // Le dimanche : rappel discret.
  await page.clock.setSystemTime(new Date(2026, 10, 8, 10, 0, 0));
  await page.clock.runFor(31000);
  verif((await page.locator(".dimanche").textContent()).includes("exporte ton bilan"), "dimanche : « C'est dimanche : exporte ton bilan de la semaine. »");

  // Lundi 09/11 : rappel de pesée, puis pesée de 79,4 kg ; la semaine du 02/11 montre alors son résultat.
  verif(await page.locator("#rappel-aliments").isHidden(), "dimanche : pas de rappel de pesée");
  await page.clock.setSystemTime(new Date(2026, 10, 9, 7, 30, 0));
  await page.clock.runFor(31000);
  await onglet(page, "aliments");
  const rappel = page.locator("#rappel-aliments");
  verif(await rappel.isVisible() && (await rappel.textContent()) === "Lundi : pense à te peser ce matin.", "lundi sans pesée : rappel en haut des Aliments");
  await toucher(rappel);
  verif((await page.locator('.onglets [aria-current="page"]').getAttribute("data-onglet")) === "poids" && (await page.locator("#rappel-poids").isVisible()), "toucher le rappel → onglet Poids (rappel aussi en haut)");
  await peser(page, 79.4);
  verif(await page.locator("#rappel-poids").isHidden(), "pesée enregistrée : le rappel disparaît (Poids)");
  await onglet(page, "aliments");
  verif(await page.locator("#rappel-aliments").isHidden(), "pesée enregistrée : le rappel disparaît (Aliments)");
  await onglet(page, "bilan");
  verif((await page.locator(".evolution-poids").textContent()) === "Poids de début : 79,4 kg (lun. 09/11). Résultat à la pesée de lundi prochain (16/11).", "semaine du 09/11 : résultat attendu à la pesée du 16/11");
  await toucher(page.locator('[data-act="semaine"][data-d="-7"]'));
  verif((await page.locator(".evolution-poids").textContent()) === "Poids : 80,0 kg (lun. 02/11) → 79,4 kg (lun. 09/11), soit −0,6 kg", "semaine du 02/11 : 80,0 → 79,4 kg, soit −0,6 kg");
  // Mercredi 04/11 (pas de pesée ce jour-là) : dépense avec la pesée du lundi 02/11 = 80 kg → 2681,5833 + 184 (5 km).
  verif(proche(Number(await page.locator('.sj[data-date="2026-11-04"]').getAttribute("data-solde")), 268 - 2865.5833333333333), "mercredi : dépense calculée avec la pesée du lundi");
  await ctx.close();
}
{
  const { ctx, page } = await nouveauContexte({ colorScheme: "dark" });
  await construireSemaine(page);
  await page.locator(".verdict").evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().bottom + window.scrollY - window.innerHeight + 80));
  await page.screenshot({ path: join(captures, "sombre-semaine.png") });
  await ctx.close();
}

console.log("\n7g. Stockage indisponible");
{
  const ctx = await nav.newContext(TELEPHONE);
  await ctx.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new Error("bloqué");
    };
  });
  const page = await ctx.newPage();
  surveiller(page);
  await ouvrir(page);
  verif(await page.locator("#bandeau-stockage").isVisible(), "bandeau « Stockage indisponible » affiché");
  await ajouter(page, "oeuf", 1);
  verif((await page.locator("#e-kcal").getAttribute("data-total")) !== "0", "l'appli marche quand même (en mémoire)");
  verif(await page.locator("#bandeau-stockage").isVisible(), "bandeau toujours là après un ajout");
  await ctx.close();
}

verif(requetesExternes.length === 0, "aucune requête vers un autre domaine", requetesExternes.slice(0, 3).join(" "));
verif(erreursJs.length === 0, "aucune erreur dans la console", erreursJs.slice(0, 5).join(" | "));
verif(dialogues === 0, "aucune boîte de dialogue du navigateur (confirm/alert)");

await nav.close();
serveur.close();
console.log(echecs ? `\nÉCHEC : ${echecs} sur ${total} vérifications` : `\nOK : ${total} vérifications dans le navigateur`);
process.exit(echecs ? 1 : 0);
