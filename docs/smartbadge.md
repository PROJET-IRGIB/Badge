# SmartBadge

Document unique. Le mode d'emploi du site publié reste le README à la racine. Vercel ne sert pas ce dossier.

## 1. Portail publié

Année affichée sur la carte : 2026-2027. Le portail est le site statique de la racine, relié à Supabase. Le monorepo Next.js et NestJS décrit plus bas est le cadrage, pas ce site.

## Déjà en place

- Inscription étudiant, confirmation d’e-mail, connexion et changement de mot de passe.
- Profil et demande de badge : photo privée, naissance, sexe, téléphone, filière, niveau et site.
- File d’administration : approuver ou rejeter. Le rejet permet une nouvelle demande. Le matricule final `IRGIB-####F` ou `IRGIB-####B` est attribué à l’approbation.
- Carte bilingue 85,60 × 53,98 mm, recto et verso, QR `IRGIB-CARTE:<matricule>`.
- Présence du jour : l’administration crée un QR de séance pour un groupe ; l’étudiant le scanne et confirme.
- Huit filières, cinq niveaux (`LP1`, `LP2`, `LP3`, `M1`, `M2`) et six sites. Le Siège et Akpakpa sont deux sites. L’écran Groupes compte les cartes approuvées par site, filière et niveau.
- Les tables refusent l’accès anonyme. Un administrateur est un compte Auth présent dans `admin_members`.

## Manques encore ouverts

Ces points viennent du cadrage. Ils ne sont pas des pannes du portail actuel.

1. **Avis de carte prête.** Aucun e-mail, message dans l’application ni notification n’annonce l’approbation. L’étudiant le voit en rouvrant son espace.
2. **PDF et trace de téléchargement.** La carte s’imprime depuis l’écran. Il n’y a pas de PDF généré à la validation ni de registre des téléchargements.
3. **Nationalité.** Le cadrage la met sur la carte. Le formulaire et la carte publiés ne l’ont pas.
4. **Arrivée au portail.** Il n’y a pas de rôle sereno, ni de QR d’entrée qui change toutes les quelques minutes, ni d’heure d’arrivée distincte de la séance de cours.
5. **Liste de classe complète.** Le mode actuel est le scan du QR de séance par l’étudiant. L’administration voit ensuite les présents et les absents du jour, séparés par cycle (licence ou master), année de carrière (LP1 à M2), filière et site. Il manque encore le scan par un responsable, la clôture de la séance et l’envoi de la fiche au professeur.
6. **File hors ligne.** Sans réseau, le scan n’est pas conservé sur le téléphone.
7. **QR dynamique de 30 à 60 secondes.** Seul le QR imprimé sur la carte existe.
8. **Blocage.** Un étudiant qui n’est pas à jour, radié, ou dont la carte est perdue n’est pas refusé automatiquement.
9. **Bibliothèque et emprunts.** Pas d’écran ni de registre.
10. **Rôles fins.** Seuls l’étudiant et l’administrateur existent. Sereno, responsable de classe, professeur et bibliothèque restent à créer.
11. **Codes de filière.** `PEA`, `PP`, `BBA` et `SJ` sont encore marqués « À confirmer ». `NUT` est un code proposé.

## 2. Cadrage

Université IRGIB-AFRICA, année 2025-2026. Ce qui est retenu pour la mise en œuvre, section par section. Ceci est le cadrage, pas du code déjà livré.

20 semaines pour deux développeurs. 6 phases. 6 rôles. Une seule règle de validité.

**Règle commune.** Cours, compositions, bibliothèque et emprunts interrogent la même politique : inscrit sur l'année, à jour dans sa scolarité, non radié, et QR encore valable.

## 1. Vision

Passer du badge papier à un badge numérique qui identifie, ouvre le contrôle d'accès, pointe les présences, sert à la bibliothèque et bloque automatiquement un étudiant qui n'est pas à jour. L'étudiant peut toujours imprimer sa carte.

## 2. La carte

Format horizontal, comme une pièce d'identité. Photo à gauche, données en colonnes à droite. Le PDF reprend le modèle : en-tête bleu avec le nom de l'université, l'écusson et l'année ; bande dorée « CARTE D'ÉTUDIANT » ; nom en grand (ESONO NCHAMA) et, dessous, le prénom d'usage (Jesús Esono) ; matricule IRGIB-3424F sous la photo ; QR à droite ; pied de page filière, niveau et année.

| Zone | Contenu |
|---|---|
| En-tête | UNIVERSITÉ IRGIB-AFRICA et année académique |
| Bande | CARTE D'ÉTUDIANT |
| Identité | Photo, nom, prénom, naissance, sexe, nationalité, téléphone |
| Scolarité | Filière et niveau, choisis dans une liste |
| Sous la photo | Matricule, attribué à la validation |
| QR | Code statique du document imprimé |
| Pied | Filière, niveau, année |

## 3. Demande, validation, téléchargement

La demande et la carte sont deux objets. L'envoi enregistre les données. La validation crée le matricule, le QR et le PDF. L'étudiant télécharge le document et l'imprime lui-même.

| Étape | Qui | Résultat |
|---|---|---|
| Remplir et envoyer | Étudiant | Demande « En révision », avec photo et données |
| Contrôler la file | Administration | Validée, ou renvoyée avec un commentaire |
| Corriger | Étudiant | La même demande repart en révision |
| Produire le PDF | Système, à la validation | Matricule, QR statique, document horizontal |
| Prévenir | E-mail, message dans l'app et notification | Lien de téléchargement |
| Télécharger et imprimer | Étudiant | Trace du téléchargement |

L'e-mail sert à l'avis. Il ne figure pas sur la carte imprimée. Le PDF n'existe qu'après la validation.

## 4. QR hybride

| QR | Où | Durée | Rôle |
|---|---|---|---|
| Statique | PDF et papier | L'année, jusqu'à révocation | Carte imprimée |
| Dynamique | Téléphone | 30 à 60 secondes | Présentation au contrôle |
| Portail | Écran à l'entrée | Quelques minutes | Une arrivée par jour |
| Salle | Cours, labo, bibliothèque | Fixe | Identifie le lieu |

Une carte perdue ou un étudiant radié : le jeton imprimé est révoqué. La carte suivante en porte un autre. Le code papier ne change pas tout seul.

## 5. Arrivée au portail

Une seule arrivée par jour. La première lecture fixe l'heure. Une lecture suivante répond « Déjà enregistré à 07:42 » et ne déplace pas cette heure. Année et filière viennent de la carte validée.

| Situation | Geste | Ce qui est enregistré |
|---|---|---|
| Portail avec sereno | Le sereno scanne le QR du téléphone ou du papier | Photo, nom, année, filière, heure de la première lecture |
| Portail sans sereno | L'étudiant scanne le QR de l'écran et confirme sa propre arrivée | La même heure. Un second passage le même jour ne la change pas |

La confirmation de l'étudiant porte sur son propre nom, déjà connu du carnet. Une liste ouverte de la classe permettrait de cocher quelqu'un d'autre.

## 6. Liste de classe

Entrer sur le campus à 07:42 enregistre l'arrivée. Être dans le cours de 10:00 s'enregistre à part. Le tableau du jour réunit les deux colonnes : heure de portail, puis présent ou absent à chaque séance.

| Mode | Qui scanne | Suite |
|---|---|---|
| A | Le responsable de classe scanne le badge | Plus fiable. Il clôture la séance |
| B | L'étudiant scanne le QR de la salle et choisit son cours | Plus rapide. Les deux modes cohabitent |

Après clôture, la fiche de présence part automatiquement au professeur. L'historique reste consultable. Sans réseau, les scans sont conservés sur l'appareil et envoyés au retour de la connexion.

## 7. Blocage, perte, renouvellement

Un étudiant pas à jour, radié, ou dont la carte est déclarée perdue, est refusé partout avec la même règle. Le renouvellement suit l'année académique : nouvelle inscription, nouveau PDF. Les absences au-delà du seuil déclenchent une alerte.

## 8. Bibliothèque et emprunts

Le même badge sert à l'entrée et à l'emprunt de matériel. Le scan passe par la règle de validité déjà utilisée pour les cours.

## 9. Administration

Dans la première phase : la file des demandes et, avec la présence, le tableau des arrivées et des listes. Dans la phase 5 : facultés, filières, matières, import Excel, détection des doublons, statistiques par département, exports PDF et Excel, droits fins.

## 10. Rôles

| Rôle | Écran | Fait |
|---|---|---|
| Étudiant | /etudiant | Envoie la demande, télécharge le PDF, confirme sa venue si le portail n'a pas de sereno |
| Sereno | /sereno | Scanne la carte au portail. La première lecture du jour fixe l'heure |
| Responsable de classe | /responsable | Scanne, vérifie, clôture et produit la fiche |
| Professeur | /professeur | Reçoit la fiche et consulte l'historique |
| Bibliothèque | /bibliotheque | Entrées et emprunts |
| Administration | /admin | Valide les demandes et suit présences et heures |

## 11. Structure retenue

Un monorepo. Une PWA Next.js et TypeScript avec Tailwind. Une API NestJS. PostgreSQL et Prisma. Avis par e-mail, message dans l'app et notification Firebase. Hébergement VPS ou Railway/Render.

| Dossier | Rôle |
|---|---|
| apps/web | Formulaire, carte, portail, listes, administration |
| apps/api | Demandes, badges, QR, accès, présence, fiches, bibliothèque, avis |
| packages/database | Schéma Prisma |
| packages/card | La même carte horizontale, en PDF |
| packages/shared | Rôles et statuts partagés |

## 12. Phases de mise en œuvre

| Phase | Ce qui est mis en place | Semaines |
|---|---|---|
| 1. Demande et carte | Formulaire, file de validation, PDF, e-mail, message et notification avec le lien | 4 |
| 2. Présence | Arrivée au portail une fois par jour, listes A et B, tableau de présence, file hors ligne | 4 |
| 3. Fiches et blocage | Fiche au professeur, blocage scolarité ou radiation, carte perdue, renouvellement, alertes d'absences | 3 |
| 4. Bibliothèque | Entrée et emprunt avec la même règle | 3 |
| 5. Administration | Facultés et matières, Excel, doublons, statistiques, exports, permissions | 4 |
| 6. Lancement | Tests, formation du responsable de classe, du sereno et de l'administration | 2 |

### Deuxième livraison

Ouverture NFC des portes, réservation de salles, réservation de matériel, hors ligne avec conflits.

Le hors ligne du premier lancement conserve les scans et les envoie quand le réseau revient. Le traitement des conflits entre deux appareils attend la deuxième livraison.

## 3. Écarts avec une spécification reçue

La spécification reprend le brief d'origine. Elle ne contient pas plusieurs décisions déjà closes dans cette conversation. Elle n'est pas prête à être donnée telle quelle à une IA de codage.

Ce qui manque est marqué **en gras**.

## Ce qui correspond déjà

L'objectif est le même : identifier, contrôler l'accès, pointer, bloquer qui n'est pas à jour, produire la fiche, bibliothèque, emprunts, et laisser l'étudiant imprimer sa carte.

Correspondent aussi le mode A (le responsable scanne) et le mode B (l'étudiant scanne le QR de la salle et choisit le cours), sur la même session. Seul le responsable clôture. Le PDF part au professeur, qui ne configure rien. Le QR du téléphone dure 30 à 60 secondes. Celui du papier ne tourne pas seul et peut être révoqué. Chaque scan vérifie l'identité et la scolarité. La bibliothèque et le prêt, avec date de retour et scan de restitution, suivent la même règle. La pile est la même : Next.js, NestJS, PostgreSQL, Prisma, PWA, Firebase, VPS ou Railway.

Le passage « en attente » puis « confirmé » à la clôture, et la liste des absents, vont dans le même sens. **Il manque la table des inscrits au cours**, sans laquelle la liste des absents ne se calcule pas. Le schéma Prisma ne l'a pas.

## Ce qui manque

**1. Le format horizontal de la carte.** En-tête avec l'université et l'année, bande « CARTE D'ÉTUDIANT », photo à gauche, nom en grand, prénom d'usage dessous, deux colonnes (naissance, sexe, nationalité, niveau, filière, téléphone), matricule sous la photo, QR à droite, pied de page filière, niveau et année. Le modèle `Student` ne garde que le matricule, la photo, la filière et le niveau. **Il manque la date de naissance, le sexe, la nationalité et le téléphone sur la carte.**

**2. La demande, puis la validation.** L'étudiant envoie le formulaire. La demande reste « en révision ». L'administration valide ou renvoie. Le matricule, le QR et le PDF n'existent qu'après la validation. L'avis part en même temps par **e-mail, message dans l'app et notification**, avec le lien de téléchargement. **L'e-mail ne s'imprime pas.** La spécification n'a ni formulaire, ni file de validation, ni avis de carte prête.

**3. L'arrivée au portail, une fois par jour.** C'est un enregistrement distinct de la liste de classe. La première lecture fixe l'heure. Le sereno scanne l'étudiant, ou l'étudiant scanne le QR du portail (il change toutes les quelques minutes) et confirme sa propre arrivée, sans retaper le mot de passe. L'année et la carrière viennent de la carte. L'administration voit les deux colonnes : heure d'entrée, puis présent ou absent à chaque séance. **Il manque le rôle sereno, le portail, le QR de portail et l'écran des arrivées.**

**4. La file hors ligne des scans.** Sans réseau, la caméra lit quand même le code. L'enregistrement reste sur le téléphone et part au retour de la connexion. La spécification ne prévoit hors ligne que l'affichage du badge.

## Là où les deux textes se contredisent

| Sujet | Décision déjà close | Spécification reçue |
|---|---|---|
| Impression | Le PDF existe après la validation | Bouton « Imprimer » et jeton créé à l'impression |
| Arrivée | Portail, une fois par jour, avec sereno | Liste de classe seulement, modes A et B |
| Avis de la carte | E-mail, message et notification avec le lien | Firebase, SMS facultatif. Pas d'avis de téléchargement |
| Situation de l'étudiant | À jour, radié, carte perdue ou révoquée | Un booléen, faux par défaut, qui bloquerait tout le monde |
| Durée | Environ 20 semaines, avec formulaire, validation et portail | 13 à 16 semaines, sans ces pièces |
| Dossiers | `packages/card` pour le PDF et `packages/database` | Prisma à la racine, seul `packages/shared` |

## Trous du schéma, à corriger avant de coder

**Il manque l'inscription de l'étudiant à un cours**, alors que la clôture doit créer les absents. **`Course.teacherId` n'est pas relié à `User`.** **`staticQrToken` est obligatoire** : on ne peut pas créer l'étudiant avant le jeton, ce qui bloque la demande en révision. **`isAdministrativelyUpToDate` vaut faux par défaut.**

## Pour coder

La spécification reçue peut servir de base pour le badge et la liste de classe. Avant de la donner à une IA de codage, il faut y écrire **la demande avec validation, le format horizontal de la carte, le sereno et l'arrivée unique du jour.**

## 4. Autre projet — cours, examens et quiz

Projet distinct de SmartBadge. Une autre application, pilotée par les étudiants. Les phases, la base de données et l'administration de l'université restent celles du badge.

Le seul lien avec le badge est le matricule. L'étudiant crée son profil avec ce numéro de série, par exemple IRGIB-3424F. Un numéro, un compte.

## 1. Profil

L'étudiant s'inscrit avec le numéro de série de son carnet. L'équipe étudiante gère l'application. L'administration de l'université ne valide pas ces comptes.

## 2. Carrière et année

Deux sections obligatoires après le profil.

1. L'étudiant choisit sa carrière.
2. Il choisit l'année dans laquelle il est.

Les cours, les anciens examens et la classe du jour s'affichent pour cette carrière et cette année. Choisir une autre carrière, ou une année antérieure, ouvre ce rayon-là, par exemple pour consulter les examens d'une année passée.

## 3. Cours

Les documents sont dans le cloud, classés par thème, et se téléchargent depuis l'application. Chaque thème propose ses méthodes de classe.

## 4. Examens des années précédentes

Les examens de chaque année antérieure restent archivés. Le filtre est la carrière et l'année choisies dans les deux sections.

## 5. Séance du jour

Chaque jour, une classe est proposée selon le thème de cette carrière et de cette année. La séance s'appuie sur les documents de cette classe.

## 6. Quiz

À la fin de la classe du jour, un court questionnaire porte sur ce qui a été étudié. Les questions viennent des documents de cette séance.

Le quiz s'ouvre seulement après une séance menée jusqu'au bout.

## 7. Règle de la classe commencée

Une classe commencée se termine dans l'application. Si l'étudiant quitte l'app — il la ferme, passe à une autre application, ou sort de la séance — cette classe est interrompue. Il la recommence depuis le début.

## 8. IA étudiante

L'application inclut une aide pour étudier. L'étudiant pose ses questions dans l'app. Les réponses s'appuient sur les documents de sa carrière, de son année et de la séance en cours, les mêmes documents que le quiz.

L'aide accompagne la révision. Elle ne remplace pas la séance ni le quiz.

## 9. Paiement et blocage

L'accès coûte 1 000 par mois. L'unité monétaire reste à confirmer.

L'étudiant paie. L'équipe étudiante constate le paiement et active le compte pour le mois. Sans renouvellement, le compte se bloque automatiquement. Les documents et les examens restent dans le cloud. Sans compte actif, ils ne s'ouvrent pas.

## 10. Ce que ce projet ne reprend pas

SmartBadge continue de couvrir le carnet, le portail, la liste de classe, la bibliothèque et le blocage de scolarité. Ceux-là ne font pas partie de cette application.
