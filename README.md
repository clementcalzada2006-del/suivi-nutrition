# Suivi nutrition

Appli web personnelle de suivi calorique et nutritionnel, pensée pour le téléphone et le pouce.
Je touche un aliment, je choisis une quantité, et le total du jour se met à jour, avec le pourcentage des références ANSES.

Nutriments suivis (34, liste `nutriments` de `donnees/foods.json`) :
- macros : énergie, protéines, glucides, lipides ;
- oméga : acide oléique (oméga 9), acides linoléique et arachidonique (oméga 6), ALA, EPA, DHA (oméga 3), plus les rapports acide linoléique / ALA (référence ANSES : moins de 5) et oméga 6 / oméga 3 total ;
- vitamines : A, B1, B2, B3, B5, B6, B8, B9, B12, C, D, E, K1, K2. La vitamine B8 (biotine) est absente de la table Ciqual 2025 : pas de total, sa référence est affichée pour mémoire ;
- minéraux : fer, calcium, magnésium, potassium, sodium, zinc, phosphore, manganèse, sélénium, cuivre.
Site statique (HTML, CSS, JavaScript sans framework ni CDN), installable sur l'écran d'accueil, utilisable hors ligne. Aucune requête réseau à l'usage, aucun compte : tout reste dans le stockage du téléphone.

Onglets : **Aliments** (ajout en un toucher, fiche « i » avec la provenance de chaque chiffre), **Journal** (ajouts du jour, suppression, remise à zéro), **Bilan** (tous les nutriments, références, marqueur « incomplet », rapports oméga, dépense), **Activité** (pas et distance, séance de salle, créatine), **Poids** (pesées, courbe, moyenne sur 7 jours, masse grasse).

## Fichiers

- `index.html`, `styles.css`, `app.js` : l'interface.
- `calculs.js` : **tous** les calculs, sans DOM (apports, totaux, références, dépense, dates, presse-papiers, pesées).
- `stockage.js` : enregistrement sur l'appareil (localStorage), avec bandeau d'avertissement si le stockage est indisponible.
- `donnees/foods.json` : nutriments suivis et aliments. Les `valeurs` sont remplies par `outils/ciqual.py`, jamais à la main.
- `donnees/references.json` : références ANSES (homme adulte), avec sources et date.
- `donnees/activite.json` : méthode de calcul de la dépense et modules de séance.
- `manifest.webmanifest`, `sw.js`, `icons/` : installation et hors ligne.
- `outils/` : `ciqual.py` (remplissage et vérification des données), `serveur.mjs`, `icones.mjs`, tests.
- `sources/` : fichiers officiels téléchargés (Ciqual 2025, USDA, ANSES), gardés sur le PC ; voir `sources/LISEZMOI.md`.
- `SPEC.md` : cahier des charges et décisions.

## Ouvrir en local

```bash
npm install
npm run serve
```

Puis ouvrir http://127.0.0.1:5191/ .

## Tester

```bash
npm test
```

Lance `verifier` (chaque valeur de foods.json comparée au XML Ciqual), les tests de `calculs.js` en Node, puis les tests dans Edge headless au format téléphone (ajouts recalculés à la main, toute la grille, donnée manquante, persistance, remise à zéro, passage de minuit, dépense, presse-papiers, affichage à 375 px, thème sombre, hors ligne). Captures d'écran dans `outils/captures/`.

## Installer sur l'iPhone

Une fois le site en ligne (GitHub Pages par exemple) : ouvrir l'adresse dans **Safari**, toucher **Partager**, puis **« Sur l'écran d'accueil »**. L'appli s'ouvre alors en plein écran d'un geste et marche sans réseau.

## Ajouter un aliment

1. Chercher l'entrée Ciqual : `python3 -I outils/ciqual.py chercher "pois chiche"` (code, nom officiel, kcal, protéines, glucides, lipides). Prendre l'état tel que pesé (cru, surgelé cru…), jamais « cuit » pour un aliment pesé cru.
2. Ajouter une entrée dans `donnees/foods.json > aliments` en copiant une entrée voisine : `id`, `nom`, `categorie` (une de `categories`), `icone`, `unite` (`"g"` ou le nom de la pièce, avec `unite_pluriel`), `quantites`, `poids_unite_g` et `poids_source` pour une pièce, `part_comestible` et sa source, `etat`, `a_confirmer`, `source_valeurs` (`"ciqual"` ou `"estime"`), `ciqual: { code, nom }` avec le nom officiel exact, `notes`, et `"valeurs": {}`.
3. `python3 -I outils/ciqual.py remplir` puis `python3 -I outils/ciqual.py verifier` (doit finir sans écart ; il contrôle aussi la cohérence de chaque entrée Ciqual, énergie et acides gras, en lisant directement le XML, et écrit `outils/rapport-verification.txt`) ; `python3 -I outils/ciqual.py manquants` montre ce qui manque.
4. `npm test`.
5. Changer `VERSION` dans `sw.js`.

## Saisir une étiquette

Pour un produit de marque, l'étiquette prime pour l'énergie et les macros (protéines, glucides, lipides). Dans `valeurs` de l'aliment, remplacer chacun de ces nutriments par :

```json
"energie": { "v": 255, "brut": "255", "unite": "kcal", "source": "etiquette", "date": "2026-11-10", "photo": "sources/etiquettes/pain_complet-2026-11-10.jpg", "trace": false }
```

Ranger la photo dans `sources/etiquettes/`. `remplir` ne touche jamais une valeur dont la source est `"etiquette"`, et `verifier` ne la compare pas au XML (elle se vérifie sur la photo). Mettre `a_confirmer` à `false` une fois l'énergie et les macros saisies, relever le poids d'une tranche, signaler tout écart de plus de 15 % avec Ciqual, puis `npm test` et changer `VERSION`.

## Raccourci iPhone (pas et distance)

Une appli web ne peut pas lire l'app Santé. Un Raccourci copie les chiffres, l'appli les lit dans le presse-papiers :

1. App **Raccourcis** → « + » → nommer le raccourci « Pas du jour ».
2. Action **Rechercher des échantillons de santé** : « Nombre de pas », date « Aujourd'hui », regrouper par « Jour », valeur « Somme ».
3. Deuxième action **Rechercher des échantillons de santé** : « Distance à pied et en course », date « Aujourd'hui », regrouper par « Jour », valeur « Somme », unité « km ».
4. Action **Texte** : `[pas] pas [distance] km` (insérer chaque résultat avec la barre au-dessus du clavier).
5. Action **Copier dans le presse-papiers**.
6. Lancer le raccourci, ouvrir l'appli, onglet Activité → **Importer depuis le Raccourci**. Le texte peut aussi être « Pas : 8432 ; Distance : 6,2 km » ou dans un autre ordre. À défaut, tape les pas et la distance dans les champs (virgule ou point).

## Bilan de la semaine et export

Onglet Bilan → **Semaine** : une ligne par jour, du lundi au dimanche (kcal mangées, dépense estimée, solde, protéines), puis le verdict de la semaine (déficit ou surplus total, solde moyen par jour, évolution du poids). Les flèches montrent les semaines précédentes.

- Seuls comptent les jours **remplis** (journal non vide) dont la dépense est connue (une pesée à cette date ou avant). Les jours non remplis, à venir ou sans pesée sont affichés mais pas comptés.
- Les jours passés viennent de l'archive faite à minuit. Les copies faites par une remise à zéro manuelle ne comptent pas. Aujourd'hui vient de la journée en cours.
- La dépense est une estimation (Cunningham × facteur sédentaire FAO + marche + salle) ; la masse grasse utilisée est le réglage actuel pour tous les jours.

**Exporter la semaine (Excel)** crée `bilan-semaine-AAAA-MM-JJ.csv` (date du lundi) : UTF-8 avec BOM, séparateur `;`, virgule décimale, pour s'ouvrir directement dans Excel en français. Sur l'iPhone, le menu de partage s'ouvre : « Enregistrer dans Fichiers », Excel ou Numbers. Ailleurs, le fichier est téléchargé. Le dimanche, le Bilan de la semaine le rappelle.

## Mettre à jour le site

Après toute modification (code ou `donnees/*.json`) : `npm test`, puis changer `VERSION` dans `sw.js`, sinon le téléphone garde l'ancienne version en cache. Publier ensuite les fichiers du site (sans `sources/`, `node_modules/`, `outils/captures/`, déjà exclus par `.gitignore`).
