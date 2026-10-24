> Ancienne maquette au stockage local du navigateur. Le site publié est à la racine du dépôt : `etudiant/` et `gestion-campus-irga82/`. Vercel ignore ce dossier.

# IRGIB AFRICA · Portail étudiant et cartes

Cette maquette propose deux entrées séparées, sans lien entre l’espace étudiant et l’administration :

- `etudiant/index.html` : inscription, demande de badge, profil, carte et présence par QR.
- `admin/index.html` : examen des demandes, décisions, registre des étudiants, groupes et présences du jour.

Les écrans sont interactifs. Ils utilisent le stockage local du navigateur et des dossiers fictifs. Sur Windows, lance `start-demo.ps1` pour ouvrir l’espace étudiant sur `http://localhost:8765/etudiant/`; l’administration se trouve séparément sur `http://localhost:8765/admin/`. Garde la fenêtre du serveur ouverte pendant la démonstration. Les deux entrées partagent ainsi le même stockage local et le scanner caméra fonctionne sur `localhost`. La caméra peut être refusée ou non prise en charge; le champ du code de séance reste disponible en saisie manuelle.

## Parcours étudiant

1. Un étudiant déjà inscrit se connecte avec son adresse e-mail et son mot de passe; un nouvel étudiant passe par l’écran « Inscription » avec sexe (`M` ou `F`), filière, niveau, ville/site et téléphone.
2. La maquette affiche un code à 6 chiffres à saisir pour simuler la confirmation par e-mail. Aucun e-mail n’est envoyé. Les comptes et mots de passe (empreinte salée) restent uniquement dans ce navigateur.
3. L’étudiant renseigne les champs de sa demande et joint une photo d’identité. Le texte exige une photo nette, en tenue de l’école, cheveux bien peignés.
4. À l’envoi, la plateforme de démonstration attribue un matricule temporaire `TMP-…`. La demande et les champs sont ensuite en lecture seule côté étudiant.
5. Si une erreur est remarquée, l’étudiant est invité à joindre l’administration de son site d’apprentissage dans les 24 heures, avant la décision.
6. À l’approbation, la maquette attribue un matricule définitif `IRGIB-####F` ou `IRGIB-####B` et affiche une notification dans l’espace étudiant. Le sexe reste un champ séparé, `M` ou `F`.

Avec quatre chiffres et seulement deux lettres finales possibles, le format permet au maximum **20 000 matricules définitifs uniques au total**, tous sites et promotions confondus.

## Parcours administration

- La file d’examen présente la photo, les noms, l’e-mail, le téléphone, le sexe, la filière, le niveau, le site et le matricule temporaire.
- Un rapport vérifie les champs requis, les formats de nom, le sexe, le site et la présence de la photo.
- L’administration peut approuver ou rejeter une demande en attente. Les demandes décidées sont terminales dans cette maquette; une demande approuvée ne peut pas revenir en attente.
- Le matricule définitif est vérifié contre les autres demandes locales. En production, une transaction serveur doit garantir l’unicité à l’échelle de tous les sites et promotions.
- Les présences du jour validées par QR apparaissent dans l’onglet « Présences » et peuvent être exportées en CSV.

## Carte et présences

- Le recto contient le blason, la photo, les noms, la date de naissance, le sexe, le matricule définitif, la filière en français et en anglais, le niveau, la ville, le QR et le site officiel. Le QR encode `IRGIB-CARTE:<matricule>`.
- Le verso utilise les mêmes couleurs. Il indique l’adresse de référence, les téléphones et la filière, en français et en anglais, plus la mention « carte personnelle ».
- L’écran montre le recto et le verso. L’impression les sépare sur deux pages. Dimensions : **85,60 × 53,98 mm**, épaisseur **0,76 mm**.
- Dans « Présences », le lecteur caméra lit un QR de séance. Les informations de l’étudiant sont préremplies; il confirme ensuite sa présence. Aucun identifiant de professeur n’est demandé. Un même étudiant ne peut pas valider deux fois le même code de séance le même jour dans la maquette.
- Le lecteur de démonstration accepte un code simple, un JSON avec `sessionId`, `session` ou `code`, ou une URL qui contient l’un de ces paramètres. Il faudra ajuster ce décodage au format exact du QR utilisé par l’établissement.
- Les palettes du recto et du verso sont les mêmes tons bleu marine et vert canard.
- La génération du QR de carte utilise QRCode.js depuis jsDelivr. Pour une mise en production, il faudra intégrer la bibliothèque localement et passer la validation de présence par une fonction serveur.

## Catalogue et sites retenus

- Niveaux : `LP1`, `LP2`, `LP3`, `M1`, `M2`.
- Toutes les huit filières sont proposées dans les cinq villes : **200 groupes**.
- Clé de groupe : `VILLE-FILIERE-NIVEAU`, par exemple `COT-TIC-LP1`.
- Suite à la consigne « ville = site », Cotonou est une seule ville-clé `COT`. Le Siège et Akpakpa restent des points de service de Cotonou.
- Code court `NUT` proposé pour le nom usuel « Nutrition et environnement »; nom complet de filière « Hygiène, nutrition, santé et environnement ».
- `PEA`, `PP`, `BBA` et `SJ` restent indiqués « À confirmer ».

Les noms complets des huit formations proviennent du [catalogue officiel des formations](https://irgibafrica.university/catalogue-formations.html). Le site public confirme les intitulés, mais pas tous les codes courts; les codes déduits restent donc signalés.

## Limites avant une vraie mise en service

Cette version ne fournit pas d’authentification serveur, d’envoi d’e-mail, de notification distante, de serveur de matricules ou de base partagée. La connexion de démonstration ne fonctionne que dans le navigateur où le compte a été créé. Ne saisis pas de vraies données étudiantes dans cette maquette. Les approbations et présences locales servent à montrer les écrans et le flux, pas à tenir un registre officiel.

## Fichiers

- `assets/blason.jpg` : écusson seul, utilisé sur la carte et dans l’en-tête.
- `assets/irgib-africa-university.svg` et `.png` : blason avec le nom, fourni pour l’équipe.
- `assets/catalog.js` : filières, sites, niveaux et stockage local de démonstration.
- `assets/styles.css` : affichage responsive, dimensions et impression du recto.
- `start-demo.ps1` : serveur local Windows pour partager les données de démonstration et autoriser l’accès caméra sur localhost.
