import os
from flask import Flask, render_template, request, jsonify, redirect, url_for, session
from functools import wraps

# Load .env only locally (Vercel uses env vars directly)
try:
    from dotenv import load_dotenv
    load_dotenv()
except:
    pass

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "nexlink-secret-2025")
app.permanent_session_lifetime = 86400  # 24 hours

# ── SUPABASE (lazy init) ───────────────────────────────────────
_supabase = None

def get_supabase():
    global _supabase
    if _supabase is None:
        from supabase import create_client
        url = os.environ.get("SUPABASE_URL", "")
        key = os.environ.get("SUPABASE_ANON_KEY", "")
        if url and key:
            _supabase = create_client(url, key)
    return _supabase

# ── PLANS ─────────────────────────────────────────────────────
PLANS = {
    "free":     {"name": "Gratuit",  "price": 0,     "emails_per_day": 10,  "color": "#6b7280"},
    "starter":  {"name": "Starter",  "price": 3000,  "emails_per_day": 100, "color": "#00b4ff"},
    "business": {"name": "Business", "price": 8000,  "emails_per_day": 500, "color": "#ff6b00"},
    "elite":    {"name": "Elite",    "price": 15000, "emails_per_day": -1,  "color": "#eab308"},
}

# ── HELPERS ───────────────────────────────────────────────────
def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if "user" not in session:
            return redirect(url_for("login"))
        return f(*args, **kwargs)
    return decorated

def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if "user" not in session:
            return redirect(url_for("login"))
        if not session.get("is_admin"):
            return redirect(url_for("dashboard"))
        return f(*args, **kwargs)
    return decorated

def get_user_profile(user_id):
    try:
        sb = get_supabase()
        if not sb:
            return None
        r = sb.table("profiles").select("*").eq("id", user_id).single().execute()
        return r.data
    except:
        return None

def get_conditions():
    try:
        sb = get_supabase()
        if not sb:
            return []
        r = sb.table("conditions").select("*").order("created_at", desc=True).execute()
        return r.data or []
    except:
        return []

def get_plan_info(profile):
    plan_key = (profile or {}).get("plan", "free")
    plan = PLANS.get(plan_key, PLANS["free"])
    return plan_key, plan

def base_context(plan_key=None, plan=None, profile=None):
    """Shared context for base.html variables."""
    profile = profile or session.get("profile", {})
    plan_key = plan_key or (profile or {}).get("plan", "free")
    plan = plan or PLANS.get(plan_key, PLANS["free"])
    limit = plan.get("emails_per_day", 10)
    return {
        "profile": profile,
        "plan_key": plan_key,
        "plan": plan,
        "plan_limit": limit,
        "plan_color": plan.get("color", "#6b7280"),
        "plans": PLANS,
    }

# ══════════════════════════════════════════════════════════════
# AUTH ROUTES
# ══════════════════════════════════════════════════════════════

@app.route("/")
def index():
    if "user" in session:
        return redirect(url_for("admin_dashboard") if session.get("is_admin") else url_for("dashboard"))
    return render_template("auth/register.html", plans=PLANS)

@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "GET":
        return render_template("auth/login.html")

    data = request.get_json() or {}
    email = data.get("email", "").strip()
    password = data.get("password", "").strip()

    try:
        sb = get_supabase()
        if not sb:
            return jsonify({"error": "Erreur de configuration serveur"}), 500

        r = sb.auth.sign_in_with_password({"email": email, "password": password})
        user = r.user
        if not user:
            return jsonify({"error": "Identifiants incorrects"}), 401

        profile = get_user_profile(user.id)
        if not profile:
            return jsonify({"error": "Profil introuvable — contactez l'admin"}), 404

        status = profile.get("status", "pending")
        if status == "pending":
            return jsonify({"error": "Votre compte est en attente de validation par l'admin"}), 403
        if status == "rejected":
            return jsonify({"error": "Votre compte a été refusé. Contactez l'admin."}), 403

        session.permanent = True
        session["user"] = {"id": user.id, "email": user.email}
        session["profile"] = profile
        session["is_admin"] = bool(profile.get("is_admin", False))

        return jsonify({"redirect": "/admin" if session["is_admin"] else "/dashboard"})

    except Exception as e:
        err = str(e).lower()
        if "invalid" in err or "credentials" in err or "password" in err:
            return jsonify({"error": "Email ou mot de passe incorrect"}), 401
        return jsonify({"error": f"Erreur: {str(e)}"}), 500

@app.route("/register", methods=["POST"])
def register():
    data = request.get_json() or {}
    name = data.get("name", "").strip()
    email = data.get("email", "").strip()
    whatsapp = data.get("whatsapp", "").strip()
    reason = data.get("reason", "").strip()
    password = data.get("password", "").strip()
    plan = data.get("plan", "free")

    if not all([name, email, whatsapp, reason, password]):
        return jsonify({"error": "Tous les champs sont requis"}), 400
    if len(password) < 6:
        return jsonify({"error": "Mot de passe trop court (minimum 6 caractères)"}), 400
    if plan not in PLANS:
        plan = "free"

    try:
        sb = get_supabase()
        if not sb:
            return jsonify({"error": "Erreur de configuration serveur"}), 500

        # Créer l'utilisateur
        r = sb.auth.sign_up({"email": email, "password": password})
        user = r.user
        if not user:
            return jsonify({"error": "Erreur lors de la création du compte"}), 400

        # Créer le profil
        sb.table("profiles").insert({
            "id": user.id,
            "name": name,
            "email": email,
            "whatsapp": whatsapp,
            "reason": reason,
            "status": "pending",
            "plan": plan,
            "is_admin": False,
            "emails_sent_today": 0,
        }).execute()

        # 🔥 CONNECTER L'UTILISATEUR IMMÉDIATEMENT 🔥
        session.permanent = True
        session["user"] = {"id": user.id, "email": user.email}
        session["profile"] = {
            "id": user.id,
            "name": name,
            "email": email,
            "whatsapp": whatsapp,
            "reason": reason,
            "status": "pending",
            "plan": plan,
            "is_admin": False,
            "emails_sent_today": 0,
        }
        session["is_admin"] = False

        return jsonify({"success": True, "redirect": "/waiting"})

    except Exception as e:
        err = str(e)
        if "already registered" in err.lower() or "already exists" in err.lower():
            return jsonify({"error": "Cet email est déjà utilisé"}), 400
        return jsonify({"error": f"Erreur: {err}"}), 400

@app.route("/waiting")
def waiting():
    return render_template("auth/waiting.html")

@app.route("/check-status")
def check_status():
    """Called from waiting.html to check if account is now active."""
    
    # Vérifier si l'utilisateur est connecté
    if "user" not in session:
        # Pas de session -> rediriger vers login
        return jsonify({"redirect": "/login", "status": "no_session"})
    
    user_id = session["user"]["id"]
    profile = get_user_profile(user_id)
    
    if not profile:
        # Profil introuvable -> déconnecter
        session.clear()
        return jsonify({"redirect": "/login", "error": "Profil introuvable"}), 404
    
    status = profile.get("status", "pending")
    is_admin = bool(profile.get("is_admin", False))
    
    # Mettre à jour la session avec les dernières infos
    session["profile"] = profile
    session["is_admin"] = is_admin
    
    if status == "active":
        return jsonify({
            "status": "active",
            "is_admin": is_admin,
            "redirect": "/admin" if is_admin else "/dashboard"
        })
    elif status == "rejected":
        return jsonify({
            "status": "rejected"
        })
    else:  # pending
        return jsonify({
            "status": "pending"
        })

@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))

# ══════════════════════════════════════════════════════════════
# USER ROUTES
# ══════════════════════════════════════════════════════════════

@app.route("/dashboard")
@login_required
def dashboard():
    profile = session.get("profile", {})
    plan_key, plan = get_plan_info(profile)
    conditions = get_conditions()
    try:
        sb = get_supabase()
        r = sb.table("email_logs").select("id", count="exact").eq("user_id", session["user"]["id"]).execute()
        total_sent = r.count or 0
    except:
        total_sent = 0
    ctx = base_context(plan_key, plan, profile)
    ctx.update({"total_sent": total_sent, "conditions": conditions})
    return render_template("app/dashboard.html", **ctx)

@app.route("/contacts")
@login_required
def contacts():
    profile = session.get("profile", {})
    plan_key, plan = get_plan_info(profile)
    ctx = base_context(plan_key, plan, profile)
    return render_template("app/contacts.html", **ctx)

@app.route("/tags")
@login_required
def tags():
    profile = session.get("profile", {})
    try:
        sb = get_supabase()
        r = sb.table("tags").select("*").eq("user_id", session["user"]["id"]).execute()
        user_tags = r.data or []
    except:
        user_tags = []
    ctx = base_context(profile=profile)
    ctx["user_tags"] = user_tags
    return render_template("app/tags.html", **ctx)

@app.route("/history")
@login_required
def history():
    profile = session.get("profile", {})
    try:
        sb = get_supabase()
        r = sb.table("email_logs").select("*").eq("user_id", session["user"]["id"]).order("created_at", desc=True).limit(100).execute()
        logs = r.data or []
    except:
        logs = []
    ctx = base_context(profile=profile)
    ctx["logs"] = logs
    return render_template("app/history.html", **ctx)

@app.route("/import")
@login_required
def import_csv():
    profile = session.get("profile", {})
    plan_key, plan = get_plan_info(profile)
    ctx = base_context(plan_key, plan, profile)
    return render_template("app/import.html", **ctx)

@app.route("/stats")
@login_required
def stats():
    profile = session.get("profile", {})
    try:
        sb = get_supabase()
        r = sb.table("email_logs").select("*").eq("user_id", session["user"]["id"]).execute()
        logs = r.data or []
    except:
        logs = []
    ctx = base_context(profile=profile)
    ctx["logs"] = logs
    return render_template("app/stats.html", **ctx)

@app.route("/plans")
@login_required
def plans():
    profile = session.get("profile", {})
    plan_key, plan = get_plan_info(profile)
    ctx = base_context(plan_key, plan, profile)
    ctx["current_plan"] = plan_key
    return render_template("app/plans.html", **ctx)

# ══════════════════════════════════════════════════════════════
# API ROUTES
# ══════════════════════════════════════════════════════════════

@app.route("/api/send-email", methods=["POST"])
@login_required
def api_send_email():
    profile = session.get("profile", {})
    plan_key, plan = get_plan_info(profile)
    limit = plan["emails_per_day"]
    sent_today = profile.get("emails_sent_today", 0)

    if limit != -1 and sent_today >= limit:
        return jsonify({"error": f"Limite journalière atteinte ({limit} emails/jour). Upgradez votre plan."}), 429

    data = request.get_json() or {}
    recipients = data.get("recipients", [])
    subject = data.get("subject", "")
    message = data.get("message", "")

    if not recipients or not subject or not message:
        return jsonify({"error": "Données manquantes"}), 400

    count = len(recipients)
    if limit != -1:
        count = min(count, limit - sent_today)

    try:
        sb = get_supabase()
        if sb:
            sb.table("email_logs").insert({
                "user_id": session["user"]["id"],
                "subject": subject,
                "recipient_count": count,
                "status": "sent",
            }).execute()
            new_count = sent_today + count
            sb.table("profiles").update({"emails_sent_today": new_count}).eq("id", session["user"]["id"]).execute()
            session["profile"]["emails_sent_today"] = new_count
    except:
        pass

    return jsonify({"success": True, "sent": count})

@app.route("/api/contacts", methods=["GET", "POST"])
@login_required
def api_contacts():
    uid = session["user"]["id"]
    sb = get_supabase()
    if not sb:
        return jsonify([]) if request.method == "GET" else jsonify({"inserted": 0})

    if request.method == "GET":
        try:
            r = sb.table("contacts").select("*").eq("user_id", uid).execute()
            return jsonify(r.data or [])
        except:
            return jsonify([])

    data = request.get_json() or {}
    contacts_list = data.get("contacts", [])
    inserted = 0
    for c in contacts_list:
        try:
            sb.table("contacts").insert({
                "user_id": uid,
                "name": c.get("name", ""),
                "email": c.get("email", ""),
                "phone": c.get("phone", ""),
            }).execute()
            inserted += 1
        except:
            pass
    return jsonify({"inserted": inserted})

@app.route("/api/tags", methods=["GET", "POST", "DELETE"])
@login_required
def api_tags():
    uid = session["user"]["id"]
    sb = get_supabase()
    if not sb:
        return jsonify([]) if request.method == "GET" else jsonify({"success": False})

    if request.method == "GET":
        try:
            r = sb.table("tags").select("*").eq("user_id", uid).execute()
            return jsonify(r.data or [])
        except:
            return jsonify([])

    if request.method == "POST":
        data = request.get_json() or {}
        try:
            r = sb.table("tags").insert({
                "user_id": uid,
                "name": data.get("name"),
                "color": data.get("color", "#00b4ff"),
            }).execute()
            return jsonify(r.data[0] if r.data else {})
        except Exception as e:
            return jsonify({"error": str(e)}), 400

    if request.method == "DELETE":
        tag_id = request.args.get("id")
        try:
            sb.table("tags").delete().eq("id", tag_id).eq("user_id", uid).execute()
            return jsonify({"success": True})
        except:
            return jsonify({"success": False})

# ══════════════════════════════════════════════════════════════
# ADMIN ROUTES
# ══════════════════════════════════════════════════════════════

@app.route("/admin")
@admin_required
def admin_dashboard():
    sb = get_supabase()
    users, pending, total_users, total_emails, conditions = [], [], 0, 0, []
    try:
        users_r = sb.table("profiles").select("*").execute()
        users = users_r.data or []
        total_users = len(users)
        pending = [u for u in users if u.get("status") == "pending"]
        logs_r = sb.table("email_logs").select("id", count="exact").execute()
        total_emails = logs_r.count or 0
        conditions = get_conditions()
    except:
        pass
    return render_template("admin/dashboard.html",
        users=users, pending=pending,
        total_users=total_users, total_emails=total_emails,
        conditions=conditions, plans=PLANS
    )

@app.route("/admin/users")
@admin_required
def admin_users():
    sb = get_supabase()
    users = []
    try:
        r = sb.table("profiles").select("*").order("created_at", desc=True).execute()
        users = r.data or []
    except:
        pass
    return render_template("admin/users.html", users=users, plans=PLANS)

@app.route("/admin/users/<user_id>/validate", methods=["POST"])
@admin_required
def admin_validate_user(user_id):
    data = request.get_json() or {}
    action = data.get("action")
    status = "active" if action == "approve" else "rejected"
    try:
        sb = get_supabase()
        sb.table("profiles").update({"status": status}).eq("id", user_id).execute()
        return jsonify({"success": True, "status": status})
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@app.route("/admin/users/<user_id>/plan", methods=["POST"])
@admin_required
def admin_change_plan(user_id):
    data = request.get_json() or {}
    plan = data.get("plan")
    if plan not in PLANS:
        return jsonify({"error": "Plan invalide"}), 400
    try:
        sb = get_supabase()
        sb.table("profiles").update({"plan": plan}).eq("id", user_id).execute()
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@app.route("/admin/conditions")
@admin_required
def admin_conditions():
    conditions = get_conditions()
    return render_template("admin/conditions.html", conditions=conditions)

@app.route("/admin/conditions", methods=["POST"])
@admin_required
def admin_create_condition():
    data = request.get_json() or {}
    try:
        sb = get_supabase()
        r = sb.table("conditions").insert({
            "title": data.get("title"),
            "description": data.get("description"),
            "applies_to": data.get("applies_to", "all"),
            "plan": data.get("plan", "all"),
            "is_active": True,
            "created_by": session["user"]["id"],
        }).execute()
        return jsonify(r.data[0] if r.data else {})
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@app.route("/admin/conditions/<cond_id>", methods=["PUT", "DELETE"])
@admin_required
def admin_update_condition(cond_id):
    sb = get_supabase()
    if request.method == "DELETE":
        try:
            sb.table("conditions").delete().eq("id", cond_id).execute()
            return jsonify({"success": True})
        except Exception as e:
            return jsonify({"error": str(e)}), 400

    data = request.get_json() or {}
    try:
        update_data = {}
        if "title" in data: update_data["title"] = data["title"]
        if "description" in data: update_data["description"] = data["description"]
        if "applies_to" in data: update_data["applies_to"] = data["applies_to"]
        if "plan" in data: update_data["plan"] = data["plan"]
        if "is_active" in data: update_data["is_active"] = data["is_active"]
        sb.table("conditions").update(update_data).eq("id", cond_id).execute()
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@app.route("/admin/plans", methods=["GET", "POST"])
@admin_required
def admin_plans():
    if request.method == "POST":
        data = request.get_json() or {}
        plan_key = data.get("key")
        if plan_key in PLANS:
            if "emails_per_day" in data:
                PLANS[plan_key]["emails_per_day"] = int(data["emails_per_day"])
            if "price" in data:
                PLANS[plan_key]["price"] = int(data["price"])
        return jsonify({"success": True, "plans": PLANS})
    return render_template("admin/plans.html", plans=PLANS)

# ── ERROR HANDLERS ─────────────────────────────────────────────
@app.errorhandler(404)
def not_found(e):
    return render_template("auth/login.html"), 404

@app.errorhandler(500)
def server_error(e):
    return f"<h2>Erreur serveur</h2><pre>{str(e)}</pre>", 500

if __name__ == "__main__":
    app.run(debug=True, port=5000)