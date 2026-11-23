# Fichiers sources (gardés sur le PC, non publiés)

Ces fichiers servent de référence et à la vérification (`python3 -I outils/ciqual.py verifier`). Ils ne sont pas dans le dépôt (taille et droits) : seul ce fichier l'est. Téléchargés le **2026-11-04**. Ce sont des données : ils ne sont jamais exécutés et le site ne les sert pas.

## `ciqual-2025/` : table Ciqual 2025 (ANSES)

Origine : dépôt Zenodo de l'équipe Ciqual, « Ciqual French food composition table 2025 », DOI [10.5281/zenodo.17550133](https://doi.org/10.5281/zenodo.17550133), licence CC-BY 4.0 (ciqual.anses.fr était en maintenance le jour du téléchargement). Sommes MD5 publiées par Zenodo, vérifiées, recopiées dans `ciqual-2025/zenodo_checksums.txt` :

| Fichier | Taille (octets) | MD5 |
|---|---|---|
| alim_2025_11_03.xml | 1 581 031 | 8e1171d63cee4b6010cfce25dd29243d |
| alim_grp_2025_11_03.xml | 80 421 | c31aeea90349c3aab86f98ef5f4f10da |
| compo_2025_11_03.xml | 69 243 149 | 2da725585946434df320d8041631998b |
| const_2025_11_03.xml | 17 955 | d8f2f25fdacb887bc993a6eeaf80f203 |
| sources_2025_11_03.xml | 871 783 | 5469598d6b4811672b65e1644dfc6485 |
| Table Ciqual 2025_ENG_2025_11_03.xlsx | 1 537 602 | a953e8c473d8cee24a32f89a48fbd54d |
| Table Ciqual 2025 doc ENG_2025_11_19.pdf | 4 197 666 | ecb54ba5be359d215ec7001c0e5a2604 |

## `usda-sr-legacy/` : USDA SR28 / FoodData Central SR Legacy (poids des pièces, parts non comestibles)

Origine : USDA Agricultural Research Service, FoodData Central, « SR Legacy » (https://fdc.nal.usda.gov/download-datasets/) et documentation SR28. MD5 calculés localement (pas de somme officielle publiée) :

| Fichier | MD5 |
|---|---|
| sr28_doc.pdf | 3e58d1d243228d0884293ec302957ea8 |
| sr28asc.zip | d9c5e61d76a77ae6fa7e4108227982db |
| sr_legacy_csv.zip | b35951cc9dae0e0d9d1dce93c4532442 |

## `anses/` : références nutritionnelles (copies des pages et de l'avis cités dans `donnees/references.json`)

URL d'origine : voir `sources` dans `donnees/references.json`. MD5 calculés localement :

| Fichier | MD5 |
|---|---|
| ANSES_2016_NUT2012SA0103Ra.pdf | 534df6dfae2fcdeb1d0b186b3bf20b25 |
| les-lipides.html | 03764ad7d1853f801e524dbabbf87659 |
| les-proteines.html | 9588b240abe53339082123a064f516f8 |
| references-vitamines-mineraux.html | cc7e6eecd7d2396f81b9e2d408e37b3d |
| tables.txt (extraction des tableaux de la page précédente, faite le 2026-11-04 pour lecture) | c5fb3112c2b793e2163f2b4a0aff07ff |

## `etiquettes/`

Preuves des valeurs d'étiquette : copies texte des fiches produit Système U (`<id>-fiche-systeme-u-<AAAA-MM-JJ>.txt`) et photos d'étiquettes prises par Clément (`.webp`).

## Sources ajoutées les 5 et 16/11/2026 (explications des nutriments, protéines des sportifs, os du lapin)

MD5 calculés localement :

| Fichier | URL d'origine | MD5 |
|---|---|---|
| anses/AFSSA_2007_proteines.pdf | https://www.anses.fr/fr/system/files/NUT-Ra-Proteines.pdf | 676b614dc7f9d495874e19221f62bb89 |
| anses/sel-chlorure-sodium.html | https://www.anses.fr/fr/article/savoir-consommation-du-sel-chlorure-sodium | 5eef485dc93b658110afba7a6544678e |
| anses/sucres-alimentation.html | https://www.anses.fr/fr/article/sucres-lalimentation | 1988a1cd1d93dd7dcdd7fcfd53e8986f |
| anses/acides-gras-omega-3.html | https://www.anses.fr/fr/article/acides-gras-omega-3 | 007ffea459548725f09f9951a1ac6dc7 |
| anses/que-sont-vitamines.html | https://www.anses.fr/fr/article/que-sont-vitamines | cde4d37a6bf03a93fbbab2ba639d3f5a |
| anses/vitamine-a.html | https://www.anses.fr/fr/article/vitamine-carotenoides-provitaminiques | e7418677bed77f6b3074d180be0cb291 |
| anses/vitamine-b9.html | https://www.anses.fr/fr/article/savoir-vitamine-b9 | 47c36936ba33f2fff8df6d07102d20f1 |
| anses/vitamine-c.html | https://www.anses.fr/fr/article/vitamine-c | 2b4f86156b98cdd10e1584b37cbc4586 |
| anses/vitamine-d.html | https://www.anses.fr/fr/article/vitamine-pourquoi-comment-assurer-apport-suffisant | 25a9c4070792e4273a9f6cc4f11c52d0 |
| anses/calcium.html | https://www.anses.fr/fr/article/calcium-pourquoi-comment-consommer | 7fb1d46728130a6afbe15d433650a0a6 |
| anses/mineraux.html | https://www.anses.fr/fr/article/mineraux | 019029fc4cfdc88530719d1d926e73ea |
| efsa/EFSA_2006_UL_vitamines_mineraux.pdf | https://www.efsa.europa.eu/sites/default/files/efsa_rep/blobserver_assets/ndatolerableuil.pdf | d3caae22ff44bb7abe809388b78d4867 |
| efsa/EFSA_2025_UL_synthese.pdf | https://www.efsa.europa.eu/sites/default/files/2024-05/ul-summary-report.pdf | 029972b8412673d8f74f647948e53211 |
| lapin/ah102.pdf | https://www.ars.usda.gov/ARSUserFiles/80400525/Data/Classics/ah102.pdf | 9e742fa7995e7ec920d2dc688893d333 |

`etiquettes/` contient aussi les photos et copies texte des étiquettes et des fiches Système U (pains, légumes U BIO, chocolats, tartines, huiles).

## Sources ajoutées le 23/11/2026 (tomates cerises, cuisson)

| Fichier | URL d'origine | MD5 |
|---|---|---|
| usda-fndds/fndds.zip | https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_survey_food_csv_2024-10-31.zip | c87a2a7e12b1300eeaf0b91b4dfc1b2c |
| usda-cuisson/rendements.pdf | https://www.ars.usda.gov/ARSUserFiles/80400525/Data/retn/USDA_CookingYields_MeatPoultry.pdf | 4815a89eabd4f383ae1b35a27c64cb17 |
| etiquettes/huile_olive-fiche-systeme-u-2026-11-16.txt | https://www.coursesu.com/p/huile-dolive-vierge-extra--bouteille-de-75cl/930350.html | 8f8eb88b85de8c1c166e9dea094e7088 |
