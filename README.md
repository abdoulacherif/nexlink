# NexLink — Reconstruction propre

## ⚠️ Étapes de déploiement (à suivre dans l'ordre)

### 1. Remplacer TOUS les fichiers du repo GitHub
Supprime l'ancien contenu et remplace par celui de ce zip, en gardant la même structure :

```
nexlink/
├── app.py
├── requirements.txt
├── vercel.json
└── templates/
    ├── base.html
    ├── auth/
    │   ├── register.html
    │   ├── login.html
    │   └── waiting.html
    ├── app/
    │   ├── dashboard.html
    │   ├── contacts.html
    │   ├── tags.html
    │   ├── history.html
    │   ├── import.html
    │   ├── stats.html
    │   └── plans.html
    └── admin/
        ├── base_admin.html
        ├── dashboard.html
        ├── users.html
        ├── conditions.html
        └── plans.html
```

### 2. Variables d'environnement sur Vercel
Vérifie dans Vercel → Settings → Environment Variables :
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SECRET_KEY` (n'importe quelle valeur secrète)

### 3. Supabase — AUCUNE modification nécessaire
Les données existantes (users, contacts, etc.) sont conservées. Le schema.sql n'a pas besoin d'être réexécuté.

### 4. Déployer
Push sur GitHub → Vercel redéploie automatiquement.

### 5. Tester le login admin
1. Va sur `/login`
2. Connecte-toi avec `abdoula13cherif@gmail.com`
3. Si "en attente" persiste malgré `status='active'` en BD, visite `/debug-session` après login pour voir l'état exact de la session (route de debug temporaire incluse dans ce build)

---

## 🆕 Ce qui a changé dans cette reconstruction

**app.py**
- Suppression de tous les `except: pass` silencieux → chaque erreur est maintenant loggée dans les logs Vercel (`print(...)`)
- `get_user_profile()` utilise `.execute()` au lieu de `.single()` pour éviter un crash si 0 ou plusieurs lignes existent pour le même `id`
- `/dashboard` recharge TOUJOURS le profil depuis Supabase au lieu de faire confiance à la session — élimine le bug "en attente" persistant après activation
- Nouvelle route `/debug-session` pour diagnostiquer l'état de session en un coup d'œil

**Design**
- `base.html` : header + onglets horizontaux (style "MARATHON") au lieu de la sidebar verticale
- Tout le CSS est inline dans chaque template — aucune dépendance à un fichier `.css` externe

**Contacts**
- 267 contacts uniques de l'annuaire partagé (dédupliqués depuis les données originales)
- Plan Gratuit : accès aux 200 premiers contacts + section "verrouillé" avec CTA upgrade
- Plans payants : accès aux 267 contacts complets
- Chaque utilisateur garde ses propres contacts ajoutés, stockés dans Supabase (table `contacts`, filtré par `user_id`)

**Admin**
- Complètement séparé de l'interface utilisateur (`admin/base_admin.html` dédié)
- Aucun lien admin visible dans la navigation utilisateur
