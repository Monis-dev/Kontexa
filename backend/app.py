import os
import stripe
from urllib.parse import unquote
from flask import Flask, request, jsonify, session, redirect, url_for, render_template, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.orm import joinedload
from urllib.parse import urlparse
from authlib.integrations.flask_client import OAuth
from flask_cors import CORS
from dotenv import load_dotenv
# from ai_agent import get_ai_answer, get_ai_summary

load_dotenv()
app = Flask(__name__)
app.config.update(
    SESSION_COOKIE_SECURE=True,
    SESSION_COOKIE_SAMESITE="None"
)
app.secret_key = os.getenv("SECRET_KEY", "prod_secret_123")

# --- Production-Ready Database Config ---
uri = os.getenv("DATABASE_URL")
if uri and uri.startswith("postgres://"):
    uri = uri.replace("postgres://", "postgresql://", 1)

app.config["SQLALCHEMY_DATABASE_URI"] = uri
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {
    "pool_pre_ping": True,
    "pool_size": 10,
    "max_overflow": 20,
    "pool_recycle": 300,
    "connect_args": {"sslmode": "require"}
}
db = SQLAlchemy(app)

try:
    with app.app_context():
        print("Connecting to database...")
        db.create_all()
        print("Database connected and tables verified!")
except Exception as e:
    print(f"CRITICAL ERROR: Could not connect to database. Reason: {e}")

# Stripe
stripe.api_key = os.getenv("STRIPE_SECRET_KEY", "sk_test_123...")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "whsec_123...")
PRICE_MONTHLY_ID = os.getenv("STRIPE_PRICE_MONTHLY", "price_123...")
PRICE_LIFETIME_ID = os.getenv("STRIPE_PRICE_LIFETIME", "price_456...")


MOBILE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mobile')
# ─────────────────────────────────────────────────────────────────────────────
#  CORS
#
#  Add MOBILE_PWA_ORIGIN to your .env / Render environment variables.
#  Set it to wherever you host backend/mobile/  e.g.:
#    MOBILE_PWA_ORIGIN=https://contextnote-mobile.netlify.app
#
#  If you serve the PWA from the same Render app (e.g. as a static route),
#  just add "https://context-notes.onrender.com" — it's already in the list.
# ─────────────────────────────────────────────────────────────────────────────
MOBILE_PWA_ORIGIN = os.getenv("MOBILE_PWA_ORIGIN", "https://your-mobile-pwa-domain.com")

CORS(app, supports_credentials=True, resources={
    r"/*": {
        "origins": [
            r"chrome-extension://.*",
            "https://context-notes.onrender.com",
            "http://127.0.0.1:5000",
            "http://localhost:5000",
        ]
    }
})

oauth = OAuth(app)


# ─── Models ──────────────────────────────────────────────────────────────────

class User(db.Model):
    id       = db.Column(db.Integer, primary_key=True)
    email    = db.Column(db.String(120), unique=True, nullable=False)
    is_pro   = db.Column(db.Boolean, default=False)
    websites = db.relationship('Website', backref='user', lazy=True)

class Website(db.Model):
    id          = db.Column(db.Integer, primary_key=True)
    url         = db.Column(db.String(500), nullable=False, index=True)
    domain      = db.Column(db.String(200))
    custom_name = db.Column(db.String(255), nullable=True)
    user_id     = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False, index=True)
    notes       = db.relationship('Note', backref='website', lazy=True, cascade="all, delete-orphan")

class Note(db.Model):
    id         = db.Column(db.Integer, primary_key=True)
    local_id   = db.Column(db.String(50), nullable=False, index=True)
    title      = db.Column(db.String(255), nullable=False, default="Untitled")
    content    = db.Column(db.Text, nullable=True)
    selection  = db.Column(db.Text)
    pinned     = db.Column(db.Boolean, default=False)
    image_data = db.Column(db.Text, nullable=True)
    timestamp  = db.Column(db.String(20), nullable=True)
    folder     = db.Column(db.String(100), nullable=True)
    tags       = db.Column(db.Text, nullable=True)
    website_id = db.Column(db.Integer, db.ForeignKey('website.id'), nullable=False)


# ─── Auth ─────────────────────────────────────────────────────────────────────

google = oauth.register(
    name='google',
    client_id=os.getenv("CLIENT_ID"),
    client_secret=os.getenv("CLIENT_SECRET"),
    server_metadata_url='https://accounts.google.com/.well-known/openid-configuration',
    client_kwargs={'scope': 'openid email profile'}
)

@app.route("/weakUp")
def weakUp():
    return jsonify({"message": "Wake UP!!"}), 200

@app.route("/")
def home():
    return render_template("index.html")

# ─────────────────────────────────────────────────────────────────────────────
#  MOBILE PWA — served at /mobile and /mobile/*
#
#  Because the PWA lives at the SAME origin as the API server
#  (context-notes.onrender.com), there is NO cross-origin cookie issue at all.
#  You do NOT need to set MOBILE_PWA_ORIGIN — the existing CORS entry for
#  "https://context-notes.onrender.com" already covers it.
#
#  Flask needs to know where the mobile/ folder is.  When Render runs app.py
#  from the backend/ directory, __file__ is backend/app.py, so the mobile
#  folder resolves to backend/mobile/ automatically.
# ─────────────────────────────────────────────────────────────────────────────
MOBILE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mobile')

@app.route("/mobile")
def mobile_redirect():
    return redirect("/mobile/", code=301)

@app.route("/mobile/")
def mobile_app():
    return send_from_directory(MOBILE_DIR, 'index.html')

@app.route("/mobile/<path:filename>")
def mobile_static(filename):
    return send_from_directory(MOBILE_DIR, filename)

# ─────────────────────────────────────────────────────────────────────────────
#  /login
#
#  Works for both desktop extension and mobile PWA.
#  Mobile passes ?mobile=1 so /authorize knows to show the mobile success page
#  instead of the original "close this tab" page.
#
#  Usage from the PWA:
#    window.open("https://context-notes.onrender.com/login?mobile=1", "_blank")
#  The PWA then polls /api/me every 5 s until it gets a 200 (login detected).
# ─────────────────────────────────────────────────────────────────────────────
@app.route("/login")
def login():
    mobile = request.args.get("mobile", "0")
    session["login_origin"] = "mobile" if mobile == "1" else "desktop"
    return google.authorize_redirect(url_for('authorize', _external=True))

@app.route('/authorize')
def authorize():
    token     = google.authorize_access_token()
    user_info = token.get('userinfo')
    user      = User.query.filter_by(email=user_info['email']).first()

    if not user:
        user = User(email=user_info['email'], is_pro=False)
        db.session.add(user)
        db.session.commit()

    session['user_id']    = user.id
    session['user_email'] = user.email
    session.permanent     = True

    origin = session.pop("login_origin", "desktop")

    if origin == "mobile":
        # Friendly page for mobile users — auto-closes, PWA detects via poll
        return """
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Signed in — ContextNote</title>
  <style>
    *{{box-sizing:border-box;margin:0;padding:0}}
    body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
         background:#0f0f13;color:#f0eff8;display:flex;align-items:center;
         justify-content:center;min-height:100vh;text-align:center;padding:24px}}
    .card{{background:#1a1a24;border:1px solid #2a2a38;border-radius:20px;
           padding:40px 32px;max-width:340px;width:100%}}
    .ico{{font-size:52px;margin-bottom:16px}}
    h2{{font-size:22px;font-weight:700;margin-bottom:10px}}
    p{{font-size:14px;color:#b8b6d0;line-height:1.6;margin-bottom:24px}}
    .pill{{display:inline-block;background:#7c6ef2;color:#fff;
           font-size:13px;font-weight:600;padding:10px 24px;border-radius:30px}}
  </style>
</head>
<body>
  <div class="card">
    <div class="ico">✅</div>
    <h2>Signed in!</h2>
    <p>Signed in as <strong>{email}</strong>.<br>
       Switch back to the ContextNote app — your notes will load automatically.</p>
    <div class="pill">You can close this tab</div>
  </div>
  <script>setTimeout(()=>window.close(), 2500);</script>
</body>
</html>""".format(email=user_info['email'])

    # Original desktop behaviour
    return """<html><body>
      <h2 style="text-align:center;margin-top:50px;font-family:sans-serif;">
        Logged in! ✅<br>Close this tab.
      </h2>
      <script>setTimeout(()=>window.close(),2000);</script>
    </body></html>"""

@app.route('/api/me')
def get_me():
    if 'user_id' in session:
        user = db.session.get(User, session['user_id'])
        return jsonify({'email': session['user_email'], 'is_pro': user.is_pro})
    return jsonify({"error": "Not logged in"}), 401

@app.route('/api/logout', methods=['POST', 'GET'])
def logout():
    session.clear()
    return jsonify({"message": "Logged out"}), 200


# ─── Testing routes ───────────────────────────────────────────────────────────

@app.route("/revoke")
def revoke():
    if 'user_id' not in session:
        return jsonify({"error": "Login required."}), 401
    user = db.session.get(User, session['user_id'])
    if user:
        user.is_pro = False
        db.session.commit()
        return """
        <html><body style="font-family:sans-serif;text-align:center;margin-top:50px;">
            <h2 style="color:#e11d48;">Access Revoked ❌</h2>
            <p>Your account (<b>{}</b>) is now on the Free Tier.</p>
            <script>setTimeout(()=>window.close(),3000);</script>
        </body></html>""".format(user.email)
    return jsonify({"error": "User not found"}), 404

@app.route("/grant")
def grant():
    if 'user_id' not in session:
        return jsonify({"error": "Login required."}), 401
    user = db.session.get(User, session['user_id'])
    if user:
        user.is_pro = True
        db.session.commit()
        return """
        <html><body style="font-family:sans-serif;text-align:center;margin-top:50px;">
            <h2 style="color:#16a34a;">Access Granted ✅</h2>
            <p>Your account (<b>{}</b>) is now Pro.</p>
            <script>setTimeout(()=>window.close(),3000);</script>
        </body></html>""".format(user.email)
    return jsonify({"error": "User not found"}), 404


# ─── Pricing & Stripe ─────────────────────────────────────────────────────────

@app.route('/pricing')
def pricing():
    if 'user_id' not in session:
        return redirect(url_for('login'))
    user = db.session.get(User, session['user_id'])
    if user.is_pro:
        return "<h2>You are already a Pro user! Close this tab and enjoy the extension.</h2>"
    return render_template('pricing.html', email=user.email)

@app.route('/create-checkout-session', methods=['POST'])
def create_checkout_session():
    print("--- CHECKOUT BUTTON CLICKED ---")
    if 'user_id' not in session:
        return redirect(url_for('login'))

    user_id    = session['user_id']
    user_email = session['user_email']
    plan_type  = request.form.get('plan_type')
    price_id   = os.getenv("STRIPE_PRICE_LIFETIME")
    mode       = 'payment'
    print(f"User: {user_email} | Plan: {plan_type} | Price: {price_id}")

    try:
        checkout_session = stripe.checkout.Session.create(
            customer_email=user_email,
            client_reference_id=str(user_id),
            payment_method_types=['card'],
            line_items=[{'price': price_id, 'quantity': 1}],
            mode=mode,
            success_url=request.host_url + 'success',
            cancel_url=request.host_url + 'pricing',
        )
        return redirect(checkout_session.url, code=303)
    except Exception as e:
        print(f"STRIPE ERROR: {str(e)}")
        return f"""
        <div style="font-family:sans-serif;padding:40px;text-align:center;">
            <h2 style="color:red;">Stripe Error</h2><p><b>{str(e)}</b></p>
            <a href="/pricing">Go Back</a>
        </div>""", 400

@app.route('/success')
def success():
    return """
    <div style="text-align:center;font-family:sans-serif;margin-top:50px;">
        <h1 style="color:#4f46e5;">Payment Successful! 🎉</h1>
        <p>Your account has been upgraded to ContextNote Pro.</p>
        <p><b>Close this tab and click 'Account → Sync' in your extension to activate.</b></p>
    </div>"""

@app.route('/webhook', methods=['POST'])
def webhook():
    payload    = request.data
    sig_header = request.headers.get('Stripe-Signature')
    try:
        event = stripe.Webhook.construct_event(payload, sig_header, STRIPE_WEBHOOK_SECRET)
    except ValueError:
        return 'Invalid payload', 400
    except stripe.error.SignatureVerificationError:
        return 'Invalid signature', 400

    if event['type'] == 'checkout.session.completed':
        session_data = event['data']['object']
        user_id = session_data.get('client_reference_id')
        print(f"WEBHOOK: Payment OK for user_id={user_id}")
        if user_id:
            user = db.session.get(User, int(user_id))
            if user:
                user.is_pro = True
                db.session.commit()
                print(f"Upgraded: {user.email}")
    elif event['type'] in ['customer.subscription.deleted', 'invoice.payment_failed']:
        pass

    return '', 200


# ─── Notes API ────────────────────────────────────────────────────────────────

@app.route('/api/sync', methods=['POST'])
def sync_notes():
    if 'user_id' not in session: return jsonify({"error": "Login required"}), 401
    user = db.session.get(User, session['user_id'])
    if not user.is_pro: return jsonify({"error": "Pro upgrade required"}), 403

    notes        = request.json
    existing_ids = {n.local_id for n in Note.query.join(Website).filter(Website.user_id == user.id).all()}
    sites_cache  = {s.url: s for s in Website.query.filter_by(user_id=user.id).all()}
    new_notes    = []

    for note in notes:

        local_id = str(note.get("id"))

        if note.get("deleted"):
            existing_note = (
                Note.query
                .join(Website)
                .filter(
                    Website.user_id == user.id,
                    Note.local_id == local_id
                )
                .first()
            )
            if existing_note:
                site = existing_note.website
                db.session.delete(existing_note)
                if len(site.notes) == 1:
                    db.session.delete(site)
            continue

        if local_id in existing_ids:
            continue

        site = sites_cache.get(note["url"])

        if not site:
            site = Website(
                url=note["url"],
                domain=note.get(
                    "domain",
                    urlparse(note["url"]).netloc
                ),
                user_id=user.id
            )

            db.session.add(site)
            db.session.flush()

            sites_cache[note["url"]] = site

        incoming_tags = note.get("tags")

        if isinstance(incoming_tags, list):
            parsed_tags = ",".join(
                str(t) for t in incoming_tags
            )
        elif incoming_tags:
            parsed_tags = str(incoming_tags)
        else:
            parsed_tags = ""

        new_notes.append(
            Note(
                local_id=local_id,
                title=note.get("title", "Untitled"),
                content=note.get("content", ""),
                selection=note.get("selection", ""),
                pinned=note.get("pinned", False),
                timestamp=note.get("timestamp", ""),
                image_data=note.get("image_data", ""),
                folder=note.get("folder", ""),
                tags=parsed_tags,
                website_id=site.id
            )
        )
    db.session.add_all(new_notes)
    db.session.commit()
    return jsonify({"message": "Sync complete"}), 200

@app.route('/api/notes', methods=['GET'])
def get_notes():
    if 'user_id' not in session: return jsonify([]), 401
    user = db.session.get(User, session['user_id'])
    if not user.is_pro: return jsonify([]), 403

    websites = Website.query.options(joinedload(Website.notes)).filter_by(user_id=user.id).all()
    result = []
    for s in websites:
        result.append({
            "domain": s.domain, "url": s.url, "custom_name": s.custom_name,
            "notes": [{
                "id": n.local_id, "title": n.title, "content": n.content,
                "selection": n.selection, "pinned": n.pinned,
                "timestamp": n.timestamp, "folder": n.folder,
                "image_data": n.image_data,
                "tags": n.tags.split(",") if n.tags else []
            } for n in s.notes]
        })
    return jsonify(result)

@app.route('/api/notes/<string:local_id>', methods=['PUT'])
def update_note(local_id):
    if 'user_id' not in session:
        return jsonify({"error": "Login required"}), 401
    note = Note.query.join(Website).filter(
        Website.user_id == session['user_id'],
        Note.local_id == local_id
    ).first()
    if not note:
        return jsonify({"error": "Note not found"}), 404
    data = request.json
    if 'title'   in data: note.title   = data['title']
    if 'content' in data: note.content = data['content']
    if 'pinned'  in data: note.pinned  = data['pinned']
    if 'folder'  in data: note.folder  = data['folder']
    if 'tags'    in data: note.tags    = data['tags']
    db.session.commit()
    return jsonify({"message": "Updated successfully"})

@app.route('/api/notes/<string:local_id>', methods=['DELETE'])
def delete_note(local_id):
    if 'user_id' not in session: return jsonify({"error": "Login required"}), 401
    note = Note.query.join(Website).filter(
        Website.user_id == session['user_id'],
        Note.local_id == local_id
    ).first()
    if note:
        db.session.delete(note)
        db.session.commit()
        return '', 204
    return jsonify({"error": "Note not found or Unauthorized"}), 404

@app.route('/api/notes/tags', methods=['PUT'])
def update_note_tags():
    if 'user_id' not in session:
        return jsonify({"error": "Login required"}), 401
    user = db.session.get(User, session['user_id'])
    if not user.is_pro:
        return jsonify({"error": "Pro required"}), 403
    data = request.json
    if not data:
        return jsonify({"error": "No data"}), 400

    updated_count = 0
    for item in data:
        local_id = str(item.get("id"))
        new_tags = item.get("tags", [])
        note = Note.query.join(Website).filter(
            Website.user_id == user.id,
            Note.local_id == local_id
        ).first()
        if note:
            existing = set(note.tags.split(",")) if note.tags else set()
            merged   = existing | set(new_tags)
            note.tags = ",".join(t for t in merged if t)
            updated_count += 1

    db.session.commit()
    return jsonify({"message": f"Updated tags for {updated_count} notes"}), 200

# if __name__ == "__main__":
#     app.run(port=5000, debug=True)
