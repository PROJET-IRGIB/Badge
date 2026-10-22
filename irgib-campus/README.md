# IRGIB AFRICA · Portail étudiant et cartes

Cette maquette propose deux entrées séparées, sans lien entre l’espace étudiant et l’administration :

- `etudiant/index.html` : inscription, demande de badge, profil, carte et présence par QR.
- `admin/index.html` : examen des demandes, décisions, registre des étudiants, groupes et présences du jour.

Les écrans sont interactifs. Ils utilisent le stockage local du navigateur et des dossiers fictifs. Sur Windows, lance `start-demo.ps1` pour ouvrir l’espace étudiant sur `http://localhost:8765/etudiant/`; l’administration se trouve séparément sur `http://localhost:8765/admin/`. Garde la fenêtre du serveur ouverte pendant la démonstration. Les deux entrées partagent ainsi le même stockage local et le scanner caméra fonctionne sur `localhost`. La caméra peut être refusée ou non prise en charge; le champ du code de séance reste disponible en saisie manuelle.

## Parcours étudiant

1. L’étudiant crée son espace avec son adresse e-mail, mot de passe, sexe (`M` ou `F`), filière, niveau, ville/site et téléphone.
2. La maquette affiche un code à 6 chiffres à saisir pour simuler la confirmation par e-mail. Aucun e-mail n’est envoyé et le mot de passe n’est pas enregistré dans le navigateur.
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

- Le recto contient le blason, la photo, les noms, le sexe, le matricule définitif, la filière/niveau, la ville, un QR proéminent et l’adresse du site officiel sous ce QR. Le QR encode l’identifiant `IRGIB-CARTE:<matricule>`; le texte de lien ouvre le site officiel.
- Le verso reprend les mêmes couleurs et affiche les coordonnées du ou des centres du site, ainsi qu’une consigne en cas de perte. Il ne répète ni logo, ni nom d’université, ni filière.
- Les deux faces sont prévisualisées et imprimées sur deux pages successives pour permettre une impression recto-verso. Dimensions : **85,60 × 53,98 mm**, épaisseur **0,76 mm**.
- Dans « Présences », le lecteur caméra lit un QR de séance. Les informations de l’étudiant sont préremplies; il confirme ensuite sa présence. Aucun identifiant de professeur n’est demandé. Un même étudiant ne peut pas valider deux fois le même code de séance le même jour dans la maquette.
- Le lecteur de démonstration accepte un code simple, un JSON avec `sessionId`, `session` ou `code`, ou une URL qui contient l’un de ces paramètres. Il faudra ajuster ce décodage au format exact du QR utilisé par l’établissement.
- Les palettes du recto et du verso sont prévues dans les mêmes tons bleu marine et vert canard; le verso n’est pas affiché comme une seconde carte dans cette version.
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

Cette version ne fournit pas d’authentification, d’envoi d’e-mail, de notification distante, de serveur de matricules ou de base partagée. Ne saisis pas de vraies données étudiantes dans cette maquette. Les approbations et présences locales servent à montrer les écrans et le flux, pas à tenir un registre officiel.

Le fichier `firestore.rules` illustre la séparation des accès : custom claim Firebase `admin`, lecture étudiant limitée à son dossier, demandes/décisions/matricules/présences réservées à des fonctions de confiance, règles refusées par défaut. Il n’est pas déployé.

Avant le lancement, il restera à connecter Firebase Auth avec vérification réelle d’e-mail, créer les projets dev/prod et les deux hébergements, configurer le custom claim côté serveur, implémenter la réservation transactionnelle des matricules et valider le QR de séance côté serveur.

## Fichiers

- `assets/blason.jpg` : blason fourni dans la conversation (144 × 144 px).
- `assets/catalog.js` : filières, sites, niveaux et stockage local de démonstration.
- `assets/styles.css` : affichage responsive, dimensions et impression du recto.
- `start-demo.ps1` : serveur local Windows pour partager les données de démonstration et autoriser l’accès caméra sur localhost.
- `firestore.rules` : règles préparatoires Firebase, non déployées.
