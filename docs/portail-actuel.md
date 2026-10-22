# Portail publié — état et manques

Année affichée sur la carte : 2026-2027. Le portail est le site statique de la racine, relié à Supabase. Il ne reprend pas le monorepo Next.js et NestJS décrit dans le [cadrage](cadrage/resume-smartbadge.md).

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

## À publier avec le prochain envoi

La liste d’administration enregistrait les demandes téléchargées sans les afficher. La correction est dans `gestion-campus-irga82/admin.js` et n’est pas encore sur le site tant que ce fichier n’est pas poussé.
