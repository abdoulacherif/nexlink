# NexLink · Plateforme Email Marketing

Plateforme d'email marketing pour l'Afrique francophone.
Stack : **Python Flask + Supabase + Vercel + EmailJS**

---

## 🚀 Installation rapide

### 1. Cloner et installer

```bash
git clone https://github.com/abdoulacherif/nexlink.git
cd nexlink
pip install -r requirements.txt
```

### 2. Variables d'environnement

Créez `.env` à la racine :

```env
SUPABASE_URL=https://gstgfdqvqkhgouzfgeyl.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
EMAILJS_PUBLIC_KEY=fNyhiux6zn4u2CtRj
EMAILJS_SERVICE_ID=service_ps61bla
EMAILJS_TEMPLATE_ID=template_aks186b
SECRET_KEY=nexlink-super-secret-2025
```

### 3. Base de données Supabase

Dans le dashboard Supabase → SQL Editor, exécutez `schema.sql`.

Puis définissez votre compte admin :
```sql
UPDATE profiles SET is_admin = TRUE WHERE email = 'votre@email.com';
```

### 4. Lancer en local

```bash
python app.py
```

Ouvrez http://localhost:5000

---

## 📦 Déploiement Vercel

```bash
vercel --prod
```

Ajoutez les variables d'env dans Vercel Dashboard → Settings → Environment Variables.

---

## 📁 Structure

```
nexlink/
├── app.py                    # Flask routes + logique
├── requirements.txt
├── vercel.json
├── schema.sql                # Schéma Supabase
├── .env                      # Variables locales
├── static/
│   ├── css/style.css         # Thème global (blanc/néon/orange)
│   └── js/main.js            # Utilitaires JS
└── templates/
    ├── base.html             # Layout utilisateur
    ├── auth/
    │   ├── register.html     # Inscription
    │   ├── login.html        # Connexion
    │   └── waiting.html      # En attente validation
    ├── app/
    │   ├── dashboard.html    # Dashboard utilisateur
    │   ├── contacts.html     # Contacts + envoi email
    │   ├── tags.html         # Tags
    │   ├── history.html      # Historique
    │   ├── import.html       # Import CSV
    │   ├── stats.html        # Statistiques
    │   └── plans.html        # Plans & Tarifs
    └── admin/
        ├── base_admin.html   # Layout admin
        ├── dashboard.html    # Dashboard admin
        ├── users.html        # Gestion utilisateurs
        ├── conditions.html   # Créer/modifier conditions
        └── plans.html        # Gérer les plans
```

---

## 💰 Plans

| Plan      | Prix      | Emails/jour |
|-----------|-----------|-------------|
| Gratuit   | 0 FCFA    | 10          |
| Starter   | 3 000 F   | 100         |
| Business  | 8 000 F   | 500         |
| Elite     | 15 000 F  | Illimité    |

---

## 🛡️ Admin

Accès : `/admin` (compte avec `is_admin = TRUE` dans Supabase)

Fonctionnalités admin :
- ✅ Valider / refuser les inscriptions
- 💰 Changer le plan d'un utilisateur
- 📋 Créer des conditions (règles affichées aux utilisateurs)
- 📊 Vue globale de la plateforme
