# IRGIB AFRICA · Portail étudiant et cartes

Cette maquette propose deux entrées séparées, sans lien entre l’espace étudiant et l’administration :

- `etudiant/index.html` : inscription, demande de badge, profil, carte et présence par QR.
- `gestion-campus-irga82/index.html` : espace administratif avec authentification Supabase.

Les écrans sont interactifs. Les données d’étudiant et les demandes sont encore stockées localement dans le navigateur pour la démonstration. Sur Windows, lance `start-demo.ps1` pour ouvrir l’espace étudiant sur `http://localhost:8765/etudiant/`; l’administration se trouve sur `http://localhost:8765/gestion-campus-irga82/`. Garde la fenêtre du serveur ouverte pendant la démonstration. Les deux entrées partagent ainsi le même stockage local et le scanner peut utiliser `localhost`. Le lecteur caméra utilise `BarcodeDetector` quand il est disponible et `jsQR` en secours pour décoder un QR depuis l’image vidéo. La caméra nécessite HTTPS ou localhost et l’autorisation du navigateur; le code peut également être saisi manuellement.

## Parcours étudiant

1. Un étudiant déjà inscrit se connecte avec son adresse e-mail et son mot de passe; un nouvel étudiant passe par l’écran distinct « Inscription » avec sexe (`M` ou `F`), filière, niveau, ville/site et téléphone.
2. La maquette affiche un code à 6 chiffres à saisir pour simuler la confirmation par e-mail. Aucun e-mail n’est envoyé. Les comptes et mots de passe (empreinte salée) sont conservés uniquement dans le stockage local de ce navigateur; ce n’est pas une authentification de production.
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

Le parcours et les données étudiants restent une maquette locale : l’inscription, le changement de mot de passe, les notifications, les matricules, les demandes et les présences ne sont pas encore centralisés côté serveur. La connexion admin Supabase est prête à configurer mais ne peut pas fonctionner avant l’ajout des paramètres du projet et des comptes autorisés. Ne saisis pas de vraies données étudiantes dans cette maquette; les listes locales ne constituent pas un registre officiel.

La connexion de l’espace administratif passe par Supabase Auth et vérifie l’appartenance à `public.admin_members`. Le script `supabase/admin_members.sql` crée cette liste avec RLS : un utilisateur peut lire uniquement sa propre appartenance et ne peut pas s’ajouter lui-même. Les opérations sur les demandes et présences restent des données de démonstration locales; elles ne sont pas encore connectées à Supabase.

Pour activer la connexion admin, renseigner l’URL du projet Supabase et sa clé publique dans `assets/supabase-config.js`, exécuter `supabase/admin_members.sql`, créer le compte dans Supabase Auth puis ajouter son identifiant à `admin_members`. Ne jamais placer la clé `service_role` dans le navigateur. Pour un usage réel, il faudra ensuite connecter toutes les demandes, photos et présences à des tables et à un stockage Supabase protégés par RLS.

## Fichiers

- `assets/blason.jpg` : blason fourni dans la conversation (144 × 144 px).
- `assets/catalog.js` : filières, sites, niveaux et stockage local de démonstration.
- `assets/styles.css` : affichage responsive, dimensions et impression du recto.
- `start-demo.ps1` : serveur local Windows pour partager les données de démonstration et autoriser l’accès caméra sur localhost.
- `assets/supabase-config.js` : URL Supabase et clé publique à renseigner. `supabase/admin_members.sql` : liste d’autorisation des comptes administrateurs. `archive/legacy-firebase/` conserve les anciens fichiers Firebase à titre d’archive; ils sont exclus du déploiement Vercel.

## Accès administratif

La route de démonstration est `/gestion-campus-irga82/`. Le nom de route n’est pas un mécanisme de sécurité : l’accès est contrôlé par Supabase Auth et la liste RLS `admin_members`. Sans URL/clé Supabase et sans compte autorisé, l’espace reste verrouillé. L’interface de données demeure une maquette locale jusqu’à l’intégration du backend.
