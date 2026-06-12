import os
from flask import Flask, render_template, request, jsonify, redirect, url_for, session
from supabase import create_client, Client
from dotenv import load_dotenv
from functools import wraps
import requests

load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY", "nexlink-dev-secret")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_ANON_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# ── PLANS CONFIG ──────────────────────────────────────────────
PLANS = {
    "free":     {"name": "Gratuit",  "price": 0,     "emails_per_day": 10,   "color": "#6b7280"},
    "starter":  {"name": "Starter",  "price": 3000,  "emails_per_day": 100,  "color": "#00b4ff"},
    "business": {"name": "Business", "price": 8000,  "emails_per_day": 500,  "color": "#ff6b00"},
    "elite":    {"name": "Elite",    "price": 15000, "emails_per_day": -1,   "color": "#eab308"},
}

# ── AUTH HELPERS ──────────────────────────────────────────────
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
        r = supabase.table("profiles").select("*").eq("id", user_id).single().execute()
        return r.data
    except:
        return None

def get_conditions():
    try:
        r = supabase.table("conditions").select("*").order("created_at", desc=True).execute()
        return r.data or []
    except:
        return []

# ══════════════════════════════════════════════════════════════
# AUTH ROUTES
# ══════════════════════════════════════════════════════════════

@app.route("/")
def index():
    if "user" in session:
        if session.get("is_admin"):
            return redirect(url_for("admin_dashboard"))
        return redirect(url_for("dashboard"))
    return render_template("auth/register.html", plans=PLANS)

@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "GET":
        return render_template("auth/login.html")
    data = request.get_json()
    email = data.get("email", "").strip()
    password = data.get("password", "").strip()
    try:
        r = supabase.auth.sign_in_with_password({"email": email, "password": password})
        user = r.user
        profile = get_user_profile(user.id)
        if not profile:
            return jsonify({"error": "Profil introuvable"}), 404
        if profile.get("status") == "pending":
            return jsonify({"error": "Compte en attente de validation"}), 403
        if profile.get("status") == "rejected":
            return jsonify({"error": "Compte refusé par l'administrateur"}), 403
        session["user"] = {"id": user.id, "email": user.email}
        session["profile"] = profile
        session["is_admin"] = profile.get("is_admin", False)
        if session["is_admin"]:
            return jsonify({"redirect": "/admin"})
        return jsonify({"redirect": "/dashboard"})
    except Exception as e:
        return jsonify({"error": "Email ou mot de passe incorrect"}), 401

@app.route("/register", methods=["POST"])
def register():
    data = request.get_json()
    name = data.get("name", "").strip()
    email = data.get("email", "").strip()
    whatsapp = data.get("whatsapp", "").strip()
    reason = data.get("reason", "").strip()
    password = data.get("password", "").strip()
    if not all([name, email, whatsapp, reason, password]):
        return jsonify({"error": "Tous les champs sont requis"}), 400
    if len(password) < 6:
        return jsonify({"error": "Mot de passe minimum 6 caractères"}), 400
    try:
        # Create auth user
        r = supabase.auth.sign_up({"email": email, "password": password})
        user = r.user
        if not user:
            return jsonify({"error": "Erreur lors de la création du compte"}), 400
        # Create profile
        supabase.table("profiles").insert({
            "id": user.id,
            "name": name,
            "email": email,
            "whatsapp": whatsapp,
            "reason": reason,
            "status": "pending",
            "plan": "free",
            "is_admin": False,
            "emails_sent_today": 0,
        }).execute()
        return jsonify({"success": True, "redirect": "/waiting"})
    except Exception as e:
        err = str(e)
        if "already registered" in err.lower():
            return jsonify({"error": "Cet email est déjà utilisé"}), 400
        return jsonify({"error": f"Erreur: {err}"}), 400

@app.route("/waiting")
def waiting():
    return render_template("auth/waiting.html")

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
    plan_key = profile.get("plan", "free")
    plan = PLANS.get(plan_key, PLANS["free"])
    conditions = get_conditions()
    try:
        r = supabase.table("email_logs").select("*", count="exact").eq("user_id", session["user"]["id"]).execute()
        total_sent = r.count or 0
    except:
        total_sent = 0
    return render_template("app/dashboard.html",
        profile=profile, plan=plan, plan_key=plan_key,
        plans=PLANS, total_sent=total_sent,
        conditions=conditions
    )

@app.route("/contacts")
@login_required
def contacts():
    profile = session.get("profile", {})
    plan_key = profile.get("plan", "free")
    plan = PLANS.get(plan_key, PLANS["free"])
    return render_template("app/contacts.html",
        profile=profile, plan=plan, plan_key=plan_key, plans=PLANS
    )

@app.route("/tags")
@login_required
def tags():
    profile = session.get("profile", {})
    try:
        r = supabase.table("tags").select("*").eq("user_id", session["user"]["id"]).execute()
        user_tags = r.data or []
    except:
        user_tags = []
    return render_template("app/tags.html", profile=profile, user_tags=user_tags)

@app.route("/history")
@login_required
def history():
    profile = session.get("profile", {})
    try:
        r = supabase.table("email_logs").select("*").eq("user_id", session["user"]["id"]).order("created_at", desc=True).limit(100).execute()
        logs = r.data or []
    except:
        logs = []
    return render_template("app/history.html", profile=profile, logs=logs)

@app.route("/import")
@login_required
def import_csv():
    profile = session.get("profile", {})
    plan_key = profile.get("plan", "free")
    plan = PLANS.get(plan_key, PLANS["free"])
    return render_template("app/import.html", profile=profile, plan=plan, plan_key=plan_key)

@app.route("/stats")
@login_required
def stats():
    profile = session.get("profile", {})
    try:
        r = supabase.table("email_logs").select("*").eq("user_id", session["user"]["id"]).execute()
        logs = r.data or []
    except:
        logs = []
    return render_template("app/stats.html", profile=profile, logs=logs)

@app.route("/plans")
@login_required
def plans():
    profile = session.get("profile", {})
    plan_key = profile.get("plan", "free")
    return render_template("app/plans.html",
        profile=profile, plans=PLANS, current_plan=plan_key
    )

# ══════════════════════════════════════════════════════════════
# API ROUTES
# ══════════════════════════════════════════════════════════════

@app.route("/api/send-email", methods=["POST"])
@login_required
def api_send_email():
    profile = session.get("profile", {})
    plan_key = profile.get("plan", "free")
    plan = PLANS.get(plan_key, PLANS["free"])
    limit = plan["emails_per_day"]
    sent_today = profile.get("emails_sent_today", 0)
    if limit != -1 and sent_today >= limit:
        return jsonify({"error": f"Limite journalière atteinte ({limit} emails/jour). Upgradez votre plan."}), 429
    data = request.get_json()
    recipients = data.get("recipients", [])
    subject = data.get("subject", "")
    message = data.get("message", "")
    if not recipients or not subject or not message:
        return jsonify({"error": "Données manquantes"}), 400
    # Log the send
    try:
        supabase.table("email_logs").insert({
            "user_id": session["user"]["id"],
            "subject": subject,
            "recipient_count": len(recipients),
            "status": "sent",
        }).execute()
        supabase.table("profiles").update({
            "emails_sent_today": sent_today + len(recipients)
        }).eq("id", session["user"]["id"]).execute()
        session["profile"]["emails_sent_today"] = sent_today + len(recipients)
    except Exception as e:
        pass
    return jsonify({"success": True, "sent": len(recipients)})

@app.route("/api/tags", methods=["GET", "POST", "DELETE"])
@login_required
def api_tags():
    uid = session["user"]["id"]
    if request.method == "GET":
        r = supabase.table("tags").select("*").eq("user_id", uid).execute()
        return jsonify(r.data or [])
    if request.method == "POST":
        data = request.get_json()
        r = supabase.table("tags").insert({
            "user_id": uid,
            "name": data.get("name"),
            "color": data.get("color", "#00b4ff"),
        }).execute()
        return jsonify(r.data[0] if r.data else {})
    if request.method == "DELETE":
        tag_id = request.args.get("id")
        supabase.table("tags").delete().eq("id", tag_id).eq("user_id", uid).execute()
        return jsonify({"success": True})

@app.route("/api/contacts", methods=["GET", "POST"])
@login_required
def api_contacts():
    uid = session["user"]["id"]
    if request.method == "GET":
        r = supabase.table("contacts").select("*").eq("user_id", uid).execute()
        return jsonify(r.data or [])
    if request.method == "POST":
        data = request.get_json()
        contacts_list = data.get("contacts", [])
        inserted = 0
        for c in contacts_list:
            try:
                supabase.table("contacts").insert({
                    "user_id": uid,
                    "name": c.get("name", ""),
                    "email": c.get("email", ""),
                    "phone": c.get("phone", ""),
                    "tags": c.get("tags", []),
                }).execute()
                inserted += 1
            except:
                pass
        return jsonify({"inserted": inserted})

# ══════════════════════════════════════════════════════════════
# ADMIN ROUTES
# ══════════════════════════════════════════════════════════════

@app.route("/admin")
@admin_required
def admin_dashboard():
    try:
        users_r = supabase.table("profiles").select("*", count="exact").execute()
        users = users_r.data or []
        total_users = users_r.count or 0
        pending = [u for u in users if u.get("status") == "pending"]
        logs_r = supabase.table("email_logs").select("*", count="exact").execute()
        total_emails = logs_r.count or 0
        conditions = get_conditions()
    except Exception as e:
        users, pending, total_users, total_emails, conditions = [], [], 0, 0, []
    return render_template("admin/dashboard.html",
        users=users, pending=pending,
        total_users=total_users, total_emails=total_emails,
        conditions=conditions, plans=PLANS
    )

@app.route("/admin/users")
@admin_required
def admin_users():
    try:
        r = supabase.table("profiles").select("*").order("created_at", desc=True).execute()
        users = r.data or []
    except:
        users = []
    return render_template("admin/users.html", users=users, plans=PLANS)

@app.route("/admin/users/<user_id>/validate", methods=["POST"])
@admin_required
def admin_validate_user(user_id):
    data = request.get_json()
    action = data.get("action")  # "approve" or "reject"
    status = "active" if action == "approve" else "rejected"
    try:
        supabase.table("profiles").update({"status": status}).eq("id", user_id).execute()
        return jsonify({"success": True, "status": status})
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@app.route("/admin/users/<user_id>/plan", methods=["POST"])
@admin_required
def admin_change_plan(user_id):
    data = request.get_json()
    plan = data.get("plan")
    if plan not in PLANS:
        return jsonify({"error": "Plan invalide"}), 400
    try:
        supabase.table("profiles").update({"plan": plan}).eq("id", user_id).execute()
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
    data = request.get_json()
    try:
        r = supabase.table("conditions").insert({
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
    if request.method == "DELETE":
        supabase.table("conditions").delete().eq("id", cond_id).execute()
        return jsonify({"success": True})
    data = request.get_json()
    supabase.table("conditions").update({
        "title": data.get("title"),
        "description": data.get("description"),
        "applies_to": data.get("applies_to"),
        "plan": data.get("plan"),
        "is_active": data.get("is_active", True),
    }).eq("id", cond_id).execute()
    return jsonify({"success": True})

@app.route("/admin/plans", methods=["GET", "POST"])
@admin_required
def admin_plans():
    if request.method == "POST":
        data = request.get_json()
        plan_key = data.get("key")
        if plan_key in PLANS:
            PLANS[plan_key]["emails_per_day"] = int(data.get("emails_per_day", PLANS[plan_key]["emails_per_day"]))
            PLANS[plan_key]["price"] = int(data.get("price", PLANS[plan_key]["price"]))
        return jsonify({"success": True, "plans": PLANS})
    return render_template("admin/plans.html", plans=PLANS)

if __name__ == "__main__":
    app.run(debug=True, port=5000)
