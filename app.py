import os
from flask import Flask, render_template, request, jsonify, redirect, url_for, session
from functools import wraps

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "nexlink-secret-2025")

# ══════════════════════════════════════════════════════════════
# SUPABASE (lazy init)
# ══════════════════════════════════════════════════════════════
_supabase = None

def get_supabase():
    """
    Returns a Supabase client using the SERVICE ROLE key when available.
    The service role key bypasses Row Level Security (RLS), which is
    necessary here because our backend acts on behalf of users via
    Flask sessions (not Supabase's own session/JWT mechanism).
    Falls back to the anon key if service role isn't configured
    (auth.sign_in/sign_up still need to work, which anon key supports).
    """
    global _supabase
    if _supabase is None:
        from supabase import create_client
        url = os.environ.get("SUPABASE_URL", "")
        service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
        anon_key = os.environ.get("SUPABASE_ANON_KEY", "")
        key = service_key if service_key else anon_key
        if url and key:
            _supabase = create_client(url, key)
    return _supabase

def get_supabase_auth():
    """
    Returns a Supabase client using the ANON key specifically for
    auth.sign_in_with_password / auth.sign_up calls. Using the
    service role key for auth operations is not recommended.
    """
    from supabase import create_client
    url = os.environ.get("SUPABASE_URL", "")
    anon_key = os.environ.get("SUPABASE_ANON_KEY", "")
    if url and anon_key:
        return create_client(url, anon_key)
    return None

# ══════════════════════════════════════════════════════════════
# PLANS
# ══════════════════════════════════════════════════════════════
PLANS = {
    "free":     {"name": "Gratuit",  "price": 0,     "emails_per_day": 10,  "contacts_limit": 200, "color": "#6b7280"},
    "starter":  {"name": "Starter",  "price": 3000,  "emails_per_day": 100, "contacts_limit": -1,  "color": "#00b4ff"},
    "business": {"name": "Business", "price": 8000,  "emails_per_day": 500, "contacts_limit": -1,  "color": "#ff6b00"},
    "elite":    {"name": "Elite",    "price": 15000, "emails_per_day": -1,  "contacts_limit": -1,  "color": "#eab308"},
}

# ══════════════════════════════════════════════════════════════
# HELPERS
# ══════════════════════════════════════════════════════════════
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
    """Fetch a profile by user_id. Returns dict or None. Raises on real errors only."""
    sb = get_supabase()
    if not sb:
        return None
    try:
        r = sb.table("profiles").select("*").eq("id", user_id).execute()
    except Exception as e:
        print(f"[get_user_profile] Supabase error: {e}")
        return None

    rows = r.data or []
    if len(rows) == 0:
        return None
    if len(rows) > 1:
        print(f"[get_user_profile] WARNING: multiple profiles found for id={user_id}, using first")
    return rows[0]

def get_conditions():
    sb = get_supabase()
    if not sb:
        return []
    try:
        r = sb.table("conditions").select("*").order("created_at", desc=True).execute()
        return r.data or []
    except Exception as e:
        print(f"[get_conditions] Supabase error: {e}")
        return []

def get_plan_info(profile):
    plan_key = (profile or {}).get("plan", "free")
    if plan_key not in PLANS:
        plan_key = "free"
    plan = PLANS[plan_key]
    return plan_key, plan

def base_context(profile=None):
    profile = profile if profile is not None else session.get("profile", {})
    plan_key, plan = get_plan_info(profile)
    limit = plan.get("emails_per_day", 10)
    return {
        "profile": profile,
        "plan_key": plan_key,
        "plan": plan,
        "plan_limit": limit,
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

    if not email or not password:
        return jsonify({"error": "Email et mot de passe requis"}), 400

    sb_auth = get_supabase_auth()
    if not sb_auth:
        return jsonify({"error": "Erreur de configuration serveur (Supabase)"}), 500

    # Step 1: Authenticate (must use anon key client)
    try:
        r = sb_auth.auth.sign_in_with_password({"email": email, "password": password})
        user = r.user
    except Exception as e:
        err = str(e).lower()
        if "invalid" in err or "credential" in err:
            return jsonify({"error": "Email ou mot de passe incorrect"}), 401
        return jsonify({"error": f"Erreur d'authentification: {str(e)}"}), 500

    if not user:
        return jsonify({"error": "Identifiants incorrects"}), 401

    # Step 2: Fetch profile
    profile = get_user_profile(user.id)
    if not profile:
        return jsonify({"error": "Profil introuvable. Contactez l'admin avec votre email: " + email}), 404

    status = profile.get("status", "pending")

    if status == "rejected":
        return jsonify({"error": "Votre compte a été refusé. Contactez l'admin."}), 403

    if status == "pending":
        return jsonify({"error": "Votre compte est en attente de validation par l'admin", "status": "pending"}), 403

    # Step 3: status == 'active' -> create session
    session.permanent = True
    session["user"] = {"id": user.id, "email": user.email}
    session["profile"] = profile
    session["is_admin"] = bool(profile.get("is_admin", False))

    return jsonify({
        "success": True,
        "redirect": "/admin" if session["is_admin"] else "/dashboard"
    })

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

    sb_auth = get_supabase_auth()
    sb = get_supabase()
    if not sb_auth or not sb:
        return jsonify({"error": "Erreur de configuration serveur"}), 500

    try:
        r = sb_auth.auth.sign_up({"email": email, "password": password})
        user = r.user
    except Exception as e:
        err = str(e).lower()
        if "already registered" in err or "already exists" in err or "duplicate" in err:
            return jsonify({"error": "Cet email est déjà utilisé"}), 400
        return jsonify({"error": f"Erreur lors de l'inscription: {str(e)}"}), 400

    if not user:
        return jsonify({"error": "Erreur lors de la création du compte"}), 400

    # Check if profile already exists (avoid duplicates)
    existing = get_user_profile(user.id)
    if existing:
        return jsonify({"success": True, "redirect": "/waiting"})

    try:
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
    except Exception as e:
        return jsonify({"error": f"Erreur lors de la création du profil: {str(e)}"}), 500

    return jsonify({"success": True, "redirect": "/waiting"})

@app.route("/waiting")
def waiting():
    return render_template("auth/waiting.html")

@app.route("/check-status")
def check_status():
    """Polled from waiting.html. Returns current status from DB and updates session."""
    if "user" not in session:
        return jsonify({"redirect": "/login"})

    user_id = session["user"]["id"]
    profile = get_user_profile(user_id)

    if not profile:
        return jsonify({"error": "Profil introuvable"}), 404

    status = profile.get("status", "pending")
    is_admin = bool(profile.get("is_admin", False))

    # Refresh session with latest data
    session["profile"] = profile
    session["is_admin"] = is_admin

    if status == "active":
        return jsonify({
            "status": "active",
            "is_admin": is_admin,
            "redirect": "/admin" if is_admin else "/dashboard"
        })

    return jsonify({"status": status})

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
    # Always refresh profile from DB to avoid stale session
    profile = get_user_profile(session["user"]["id"]) or session.get("profile", {})
    session["profile"] = profile
    session["is_admin"] = bool(profile.get("is_admin", False))

    if session["is_admin"]:
        return redirect(url_for("admin_dashboard"))

    sb = get_supabase()
    total_sent = 0
    if sb:
        try:
            r = sb.table("email_logs").select("id", count="exact").eq("user_id", session["user"]["id"]).execute()
            total_sent = r.count or 0
        except Exception as e:
            print(f"[dashboard] error counting logs: {e}")

    conditions = get_conditions()
    ctx = base_context(profile)
    ctx.update({"total_sent": total_sent, "conditions": conditions})
    return render_template("app/dashboard.html", **ctx)

@app.route("/contacts")
@login_required
def contacts():
    profile = session.get("profile", {})
    ctx = base_context(profile)
    return render_template("app/contacts.html", **ctx)

@app.route("/tags")
@login_required
def tags():
    profile = session.get("profile", {})
    sb = get_supabase()
    user_tags = []
    if sb:
        try:
            r = sb.table("tags").select("*").eq("user_id", session["user"]["id"]).execute()
            user_tags = r.data or []
        except Exception as e:
            print(f"[tags] error: {e}")
    ctx = base_context(profile)
    ctx["user_tags"] = user_tags
    return render_template("app/tags.html", **ctx)

@app.route("/history")
@login_required
def history():
    profile = session.get("profile", {})
    sb = get_supabase()
    logs = []
    if sb:
        try:
            r = sb.table("email_logs").select("*").eq("user_id", session["user"]["id"]).order("created_at", desc=True).limit(100).execute()
            logs = r.data or []
        except Exception as e:
            print(f"[history] error: {e}")
    ctx = base_context(profile)
    ctx["logs"] = logs
    return render_template("app/history.html", **ctx)

@app.route("/import")
@login_required
def import_csv():
    profile = session.get("profile", {})
    ctx = base_context(profile)
    return render_template("app/import.html", **ctx)

@app.route("/stats")
@login_required
def stats():
    profile = session.get("profile", {})
    sb = get_supabase()
    logs = []
    if sb:
        try:
            r = sb.table("email_logs").select("*").eq("user_id", session["user"]["id"]).execute()
            logs = r.data or []
        except Exception as e:
            print(f"[stats] error: {e}")
    ctx = base_context(profile)
    ctx["logs"] = logs
    return render_template("app/stats.html", **ctx)

@app.route("/plans")
@login_required
def plans():
    profile = session.get("profile", {})
    ctx = base_context(profile)
    ctx["current_plan"] = ctx["plan_key"]
    return render_template("app/plans.html", **ctx)

# ══════════════════════════════════════════════════════════════
# API ROUTES
# ══════════════════════════════════════════════════════════════

@app.route("/api/contacts", methods=["GET", "POST"])
@login_required
def api_contacts():
    uid = session["user"]["id"]
    sb = get_supabase()
    if not sb:
        return jsonify([]) if request.method == "GET" else jsonify({"inserted": 0})

    if request.method == "GET":
        try:
            r = sb.table("contacts").select("*").eq("user_id", uid).order("created_at", desc=True).execute()
            return jsonify(r.data or [])
        except Exception as e:
            print(f"[api_contacts GET] error: {e}")
            return jsonify([])

    data = request.get_json() or {}
    contacts_list = data.get("contacts", [])
    inserted = 0
    for c in contacts_list:
        email = (c.get("email") or "").strip()
        if not email or "@" not in email:
            continue
        try:
            sb.table("contacts").insert({
                "user_id": uid,
                "name": c.get("name", ""),
                "email": email,
                "phone": c.get("phone", ""),
            }).execute()
            inserted += 1
        except Exception as e:
            print(f"[api_contacts POST] error inserting {email}: {e}")
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
        except Exception as e:
            print(f"[api_tags GET] error: {e}")
            return jsonify([])

    if request.method == "POST":
        data = request.get_json() or {}
        name = (data.get("name") or "").strip()
        if not name:
            return jsonify({"error": "Nom requis"}), 400
        try:
            r = sb.table("tags").insert({
                "user_id": uid,
                "name": name,
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
        except Exception as e:
            return jsonify({"error": str(e)}), 400

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

    sb = get_supabase()
    if sb:
        try:
            sb.table("email_logs").insert({
                "user_id": session["user"]["id"],
                "subject": subject,
                "recipient_count": count,
                "status": "sent",
            }).execute()
            new_count = sent_today + count
            sb.table("profiles").update({"emails_sent_today": new_count}).eq("id", session["user"]["id"]).execute()
            session["profile"]["emails_sent_today"] = new_count
        except Exception as e:
            print(f"[api_send_email] error: {e}")

    return jsonify({"success": True, "sent": count})

# ══════════════════════════════════════════════════════════════
# ADMIN ROUTES
# ══════════════════════════════════════════════════════════════

@app.route("/admin")
@admin_required
def admin_dashboard():
    sb = get_supabase()
    users, pending, total_users, total_emails = [], [], 0, 0
    conditions = get_conditions()
    if sb:
        try:
            users_r = sb.table("profiles").select("*").execute()
            users = users_r.data or []
            total_users = len(users)
            pending = [u for u in users if u.get("status") == "pending"]
        except Exception as e:
            print(f"[admin_dashboard] users error: {repr(e)}")
        try:
            logs_r = sb.table("email_logs").select("id", count="exact").execute()
            total_emails = logs_r.count or 0
        except Exception as e:
            print(f"[admin_dashboard] logs error: {repr(e)}")

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
    if sb:
        try:
            r = sb.table("profiles").select("*").order("created_at", desc=True).execute()
            users = r.data or []
        except Exception as e:
            print(f"[admin_users] error: {e}")
    return render_template("admin/users.html", users=users, plans=PLANS)

@app.route("/admin/users/<user_id>/validate", methods=["POST"])
@admin_required
def admin_validate_user(user_id):
    data = request.get_json() or {}
    action = data.get("action")
    status = "active" if action == "approve" else "rejected"
    sb = get_supabase()
    if not sb:
        return jsonify({"error": "Supabase non configuré"}), 500
    try:
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
    sb = get_supabase()
    if not sb:
        return jsonify({"error": "Supabase non configuré"}), 500
    try:
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
    sb = get_supabase()
    if not sb:
        return jsonify({"error": "Supabase non configuré"}), 500
    try:
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
    if not sb:
        return jsonify({"error": "Supabase non configuré"}), 500

    if request.method == "DELETE":
        try:
            sb.table("conditions").delete().eq("id", cond_id).execute()
            return jsonify({"success": True})
        except Exception as e:
            return jsonify({"error": str(e)}), 400

    data = request.get_json() or {}
    update_data = {}
    for key in ["title", "description", "applies_to", "plan", "is_active"]:
        if key in data:
            update_data[key] = data[key]
    try:
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

# ══════════════════════════════════════════════════════════════
# DEBUG ROUTE (helps diagnose login issues)
# ══════════════════════════════════════════════════════════════

@app.route("/debug-session")
def debug_session():
    """Temporary route to inspect session state. Remove in production."""
    return jsonify({
        "logged_in": "user" in session,
        "user": session.get("user"),
        "profile": session.get("profile"),
        "is_admin": session.get("is_admin"),
    })

@app.route("/debug-users")
def debug_users():
    """Temporary route to inspect raw Supabase profiles data."""
    sb = get_supabase()
    if not sb:
        return jsonify({"error": "Supabase not configured"}), 500
    try:
        r = sb.table("profiles").select("*").execute()
        return jsonify({
            "count": len(r.data or []),
            "data": r.data
        })
    except Exception as e:
        return jsonify({"error": repr(e)}), 500

# ══════════════════════════════════════════════════════════════
# ERROR HANDLERS
# ══════════════════════════════════════════════════════════════

@app.errorhandler(404)
def not_found(e):
    return render_template("auth/login.html"), 404

@app.errorhandler(500)
def server_error(e):
    return f"<pre style='background:#000;color:#ff3366;padding:20px;font-family:monospace'>Erreur serveur 500:\n{str(e)}</pre>", 500

if __name__ == "__main__":
    app.run(debug=True, port=5000)
