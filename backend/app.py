import os
import razorpay
import hmac
import hashlib
from datetime import datetime, timedelta

from urllib.parse import unquote
from flask import Flask, request, jsonify, session, redirect, url_for, render_template, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.orm import joinedload
from urllib.parse import urlparse
from authlib.integrations.flask_client import OAuth
from flask_cors import CORS
from dotenv import load_dotenv
from markupsafe import escape
# from ai_agent import get_ai_answer, get_ai_summary

load_dotenv()
app = Flask(__name__)

# ─── Startup validation — fail fast if required env vars are missing ──────────
_REQUIRED_ENV = ["SECRET_KEY", "DATABASE_URL", "CLIENT_ID", "CLIENT_SECRET",
                 "RAZORPAY_KEY_ID", "RAZORPAY_SECRET_KEY"]
_missing = [k for k in _REQUIRED_ENV if not os.getenv(k)]
if _missing:
    raise RuntimeError(f"Missing required environment variables: {', '.join(_missing)}")

app.config.update(
    SESSION_COOKIE_SECURE=True,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="None",
    PERMANENT_SESSION_LIFETIME=timedelta(days=30),
)

# No fallback — raises KeyError at startup if SECRET_KEY is not set
app.secret_key = os.environ["SECRET_KEY"]

# ─── Database ─────────────────────────────────────────────────────────────────
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

# ─── Razorpay ─────────────────────────────────────────────────────────────────
RAZORPAY_KEY_ID = os.getenv("RAZORPAY_KEY_ID")
RAZORPAY_SECRET = os.getenv("RAZORPAY_SECRET_KEY")
client = razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_SECRET))

# ─── CORS ─────────────────────────────────────────────────────────────────────
# Set EXTENSION_ID in your environment to your published Chrome Web Store ID.
# For local unpacked development, also set EXTENSION_ID_DEV.
EXTENSION_ID     = os.getenv("EXTENSION_ID", "")
EXTENSION_ID_DEV = os.getenv("EXTENSION_ID_DEV", "")

_allowed_origins = [
    "https://context-notes.onrender.com",
    "http://127.0.0.1:5000",
    "http://localhost:5000",
]
if EXTENSION_ID:
    _allowed_origins.append(f"chrome-extension://{EXTENSION_ID}")
if EXTENSION_ID_DEV:
    _allowed_origins.append(f"chrome-extension://{EXTENSION_ID_DEV}")

CORS(app, supports_credentials=True, resources={
    r"/*": {"origins": _allowed_origins}
})

MOBILE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mobile')

oauth = OAuth(app)

# ─── Helpers ──────────────────────────────────────────────────────────────────

def _admin_token_required():
    """Returns True if the request carries a valid admin token, False otherwise.
    The token must be sent as the X-Admin-Token header and must match the
    ADMIN_SECRET environment variable."""
    secret = os.getenv("ADMIN_SECRET", "")
    if not secret:
        return False
    provided = request.headers.get("X-Admin-Token", "")
    # Constant-time comparison to prevent timing attacks
    return hmac.compare_digest(provided, secret)

_NOTE_MAX_COUNT       = 500
_NOTE_TITLE_MAX       = 255
_NOTE_CONTENT_MAX     = 100_000   # 100 KB of plain text
_NOTE_IMAGE_MAX       = 2_000_000 # 2 MB base64
_FOLDER_NAME_MAX      = 100


# ─── Models ───────────────────────────────────────────────────────────────────

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
    deleted    = db.Column(db.Boolean, default=False)
    deleted_at = db.Column(db.DateTime, nullable=True)


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


# ─── Self-ping (keep-alive for Render free tier) ──────────────────────────────
# Prefer an external uptime monitor (e.g. UptimeRobot) over this thread.
# If you upgrade to a paid Render plan, delete this block entirely.
import threading
import requests
import time

_stop_ping = threading.Event()

def self_ping():
    while not _stop_ping.wait(600):   # 10 minutes; stops cleanly on shutdown
        try:
            requests.get("https://context-notes.onrender.com/weakUp", timeout=10)
            app.logger.info("Self-ping OK")
        except Exception as e:
            app.logger.warning(f"Self-ping failed: {e}")

ping_thread = threading.Thread(target=self_ping, daemon=True)
ping_thread.start()


# ─── Mobile PWA ───────────────────────────────────────────────────────────────

@app.route("/mobile")
def mobile_redirect():
    return redirect("/mobile/", code=301)

@app.route("/mobile/")
def mobile_app():
    return send_from_directory(MOBILE_DIR, 'index.html')

@app.route("/mobile/<path:filename>")
def mobile_static(filename):
    return send_from_directory(MOBILE_DIR, filename)


# ─── Login / OAuth ────────────────────────────────────────────────────────────

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

    # Escape email before embedding in HTML to prevent XSS
    safe_email = escape(user_info['email'])

    if origin == "mobile":
        return f"""<!DOCTYPE html>
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
    <div class="ico">&#x2705;</div>
    <h2>Signed in!</h2>
    <p>Signed in as <strong>{safe_email}</strong>.<br>
       Switch back to the ContextNote app &mdash; your notes will load automatically.</p>
    <div class="pill">You can close this tab</div>
  </div>
  <script>setTimeout(()=>window.close(), 2500);</script>
</body>
</html>"""

    return """<html><body>
      <h2 style="text-align:center;margin-top:50px;font-family:sans-serif;">
        Logged in! &#x2705;<br>Close this tab.
      </h2>
      <script>setTimeout(()=>window.close(),2000);</script>
    </body></html>"""

@app.route('/api/me')
def get_me():
    if 'user_id' not in session:
        return jsonify({"error": "Not logged in"}), 401
    user = db.session.get(User, session['user_id'])
    return jsonify({'email': session['user_email'], 'is_pro': user.is_pro})

@app.route('/api/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({"message": "Logged out"}), 200


# ─── Database initialisation (admin-only) ─────────────────────────────────────
# Protected by X-Admin-Token header. Run once after first deployment,
# then prefer Flask-Migrate for subsequent schema changes.

@app.route("/init-db")
def init_db():
    if not _admin_token_required():
        return jsonify({"error": "Forbidden"}), 403
    try:
        db.create_all()
        with db.engine.connect() as con:
            try:
                con.execute(db.text("ALTER TABLE note ADD COLUMN deleted BOOLEAN DEFAULT FALSE"))
                con.execute(db.text("ALTER TABLE note ADD COLUMN deleted_at TIMESTAMP"))
                con.commit()
                app.logger.info("DB columns added.")
            except Exception as col_err:
                app.logger.info(f"Columns may already exist: {col_err}")
        return "Database initialized!", 200
    except Exception as e:
        app.logger.error(f"init-db error: {e}")
        return "Internal error during DB init.", 500


# ─── Pricing & Razorpay ───────────────────────────────────────────────────────

@app.route('/pricing')
def pricing():
    if 'user_id' not in session:
        return redirect(url_for('login'))
    user = db.session.get(User, session['user_id'])
    if user.is_pro:
        return "<h2>You are already a Pro user! Close this tab and enjoy the extension.</h2>"
    return render_template('pricing.html', email=user.email, razorpay_key_id=RAZORPAY_KEY_ID)

@app.route('/create-order', methods=['POST'])
def create_order():
    if 'user_id' not in session:
        return jsonify({"error": "Login required"}), 401
    user_id = session['user_id']
    data = request.json
    if not data:
        return jsonify({"error": "Invalid request"}), 400
    plan_type = data.get("plan_type")
    if plan_type == "lifetime":
        amount   = 200000
        currency = "INR"
    elif plan_type == "monthly":
        amount   = 20000
        currency = "INR"
    else:
        return jsonify({"error": "Invalid plan"}), 400
    order = client.order.create({
        "amount": amount,
        "currency": currency,
        "payment_capture": 1,
        "notes": {
            "user_id": str(user_id),
            "plan_type": plan_type
        }
    })
    return jsonify(order)

@app.route('/verify-payment', methods=['POST'])
def verify_payment():
    # Must be logged in
    if 'user_id' not in session:
        return jsonify({"error": "Login required"}), 401

    data = request.json
    if not data:
        return jsonify({"status": "failed", "error": "Invalid request"}), 400

    razorpay_order_id   = data.get('razorpay_order_id')
    razorpay_payment_id = data.get('razorpay_payment_id')
    razorpay_signature  = data.get('razorpay_signature')

    if not all([razorpay_order_id, razorpay_payment_id, razorpay_signature]):
        return jsonify({"status": "failed", "error": "Missing payment fields"}), 400

    try:
        # 1. Verify the cryptographic signature first
        client.utility.verify_payment_signature({
            'razorpay_order_id':   razorpay_order_id,
            'razorpay_payment_id': razorpay_payment_id,
            'razorpay_signature':  razorpay_signature
        })

        # 2. Fetch the order and extract the user_id stored in notes
        order           = client.order.fetch(razorpay_order_id)
        order_user_id   = int(order["notes"]["user_id"])
        session_user_id = session['user_id']

        # 3. Ensure the logged-in user matches the order owner (TOCTOU guard)
        if order_user_id != session_user_id:
            app.logger.warning(
                f"Payment user mismatch: order owner {order_user_id} "
                f"vs session user {session_user_id}"
            )
            return jsonify({"status": "failed", "error": "User mismatch"}), 403

        # 4. Grant Pro access
        user = db.session.get(User, session_user_id)
        if user:
            user.is_pro = True
            db.session.commit()

        return jsonify({"status": "success"})

    except Exception as e:
        app.logger.error(f"verify-payment error: {e}")
        return jsonify({"status": "failed"}), 400

@app.route('/success')
def success():
    return """
    <div style="text-align:center;font-family:sans-serif;margin-top:50px;">
        <h1 style="color:#4f46e5;">Payment Successful! &#127881;</h1>
        <p>Your account has been upgraded to ContextNote Pro.</p>
        <p><b>Close this tab and click 'Account &rarr; Sync' in your extension to activate.</b></p>
    </div>"""


# ─── Notes API ────────────────────────────────────────────────────────────────

@app.route('/api/sync', methods=['POST'])
def sync_notes():
    if 'user_id' not in session:
        return jsonify({"error": "Login required"}), 401
    user = db.session.get(User, session['user_id'])
    if not user.is_pro:
        return jsonify({"error": "Pro upgrade required"}), 403

    notes = request.json
    if not isinstance(notes, list):
        return jsonify({"error": "Invalid payload"}), 400

    # Guard: cap total notes per sync to prevent abuse
    if len(notes) > _NOTE_MAX_COUNT:
        return jsonify({"error": f"Sync limit is {_NOTE_MAX_COUNT} notes per request"}), 400

    existing_ids = {n.local_id for n in Note.query.join(Website).filter(Website.user_id == user.id).all()}
    sites_cache  = {s.url: s for s in Website.query.filter_by(user_id=user.id).all()}
    new_notes    = []

    for note in notes:
        local_id = str(note.get("id", ""))[:50]  # cap local_id length

        if note.get("deleted"):
            existing_note = (
                Note.query
                .join(Website)
                .filter(Website.user_id == user.id, Note.local_id == local_id)
                .first()
            )
            if existing_note:
                db.session.delete(existing_note)
            continue

        if local_id in existing_ids:
            continue

        # Validate and truncate fields
        title      = str(note.get("title", "Untitled"))[:_NOTE_TITLE_MAX]
        content    = str(note.get("content", ""))[:_NOTE_CONTENT_MAX]
        image_data = str(note.get("image_data", ""))
        if len(image_data) > _NOTE_IMAGE_MAX:
            image_data = ""   # drop oversized images silently; log if needed

        site = sites_cache.get(note.get("url", ""))
        if not site:
            raw_url = str(note.get("url", ""))[:500]
            site = Website(
                url=raw_url,
                domain=note.get("domain", urlparse(raw_url).netloc)[:200],
                user_id=user.id
            )
            db.session.add(site)
            db.session.flush()
            sites_cache[raw_url] = site

        incoming_tags = note.get("tags")
        if isinstance(incoming_tags, list):
            parsed_tags = ",".join(str(t)[:50] for t in incoming_tags[:50])
        elif incoming_tags:
            parsed_tags = str(incoming_tags)[:500]
        else:
            parsed_tags = ""

        new_notes.append(Note(
            local_id=local_id,
            title=title,
            content=content,
            selection=str(note.get("selection", ""))[:5000],
            pinned=bool(note.get("pinned", False)),
            timestamp=str(note.get("timestamp", ""))[:20],
            image_data=image_data,
            folder=str(note.get("folder", ""))[:_FOLDER_NAME_MAX],
            tags=parsed_tags,
            website_id=site.id
        ))

    db.session.add_all(new_notes)
    db.session.commit()
    return jsonify({"message": "Sync complete"}), 200

@app.route('/api/notes', methods=['GET'])
def get_notes():
    if 'user_id' not in session:
        return jsonify([]), 401
    user = db.session.get(User, session['user_id'])
    if not user.is_pro:
        return jsonify([]), 403

    websites = Website.query.options(joinedload(Website.notes)).filter_by(user_id=user.id).all()
    result = []
    for s in websites:
        if s.url == "general://notes":
            continue
        filtered_notes = [{
            "id":        n.local_id,
            "title":     n.title,
            "content":   n.content,
            "selection": n.selection,
            "pinned":    n.pinned,
            "timestamp": n.timestamp,
            "folder":    n.folder,
            "image_data": n.image_data,
            "tags":      n.tags.split(",") if n.tags else [],
            "deleted":   n.deleted
        } for n in s.notes]
        if not filtered_notes:
            continue
        result.append({
            "domain":      s.domain,
            "url":         s.url,
            "custom_name": s.custom_name,
            "notes":       filtered_notes
        })
    return jsonify(result)

@app.route('/api/general-notes', methods=['GET'])
def get_general_notes():
    if 'user_id' not in session:
        return jsonify([]), 401
    user = db.session.get(User, session['user_id'])
    if not user.is_pro:
        return jsonify([]), 403

    site = Website.query.filter_by(url="general://notes", user_id=user.id).first()
    if not site:
        return jsonify([])

    notes = [{
        "id":        n.local_id,
        "title":     n.title,
        "content":   n.content,
        "selection": n.selection,
        "pinned":    n.pinned,
        "timestamp": n.timestamp,
        "folder":    n.folder,
        "image_data": n.image_data,
        "tags":      n.tags.split(",") if n.tags else [],
        "deleted":   n.deleted,
        "url":       "general://notes",
        "domain":    "general",
        "_synced":   True
    } for n in site.notes if not n.deleted]

    return jsonify(notes)

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
    if not data:
        return jsonify({"error": "Invalid request"}), 400
    if 'title'   in data: note.title   = str(data['title'])[:_NOTE_TITLE_MAX]
    if 'content' in data: note.content = str(data['content'])[:_NOTE_CONTENT_MAX]
    if 'pinned'  in data: note.pinned  = bool(data['pinned'])
    if 'folder'  in data: note.folder  = str(data['folder'])[:_FOLDER_NAME_MAX]
    if 'tags'    in data: note.tags    = data['tags']
    if 'deleted' in data: note.deleted = bool(data['deleted'])
    db.session.commit()
    return jsonify({"message": "Updated successfully"})

@app.route('/api/notes/<string:local_id>', methods=['DELETE'])
def delete_note(local_id):
    if 'user_id' not in session:
        return jsonify({"error": "Login required"}), 401
    try:
        note = Note.query.join(Website).filter(
            Website.user_id == session['user_id'],
            Note.local_id == local_id
        ).first()
        if not note:
            return '', 204
        db.session.delete(note)
        db.session.commit()
        return '', 204
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"delete_note error: {e}")
        return jsonify({"error": "An internal error occurred"}), 500

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
        local_id = str(item.get("id", ""))[:50]
        new_tags = item.get("tags", [])
        note = Note.query.join(Website).filter(
            Website.user_id == user.id,
            Note.local_id == local_id
        ).first()
        if note:
            existing = set(note.tags.split(",")) if note.tags else set()
            merged   = existing | set(str(t)[:50] for t in new_tags)
            note.tags = ",".join(t for t in merged if t)
            updated_count += 1

    db.session.commit()
    return jsonify({"message": f"Updated tags for {updated_count} notes"}), 200

@app.route('/api/websites/rename', methods=['PUT'])
def rename_website():
    if 'user_id' not in session:
        return jsonify({"error": "Login required"}), 401

    data = request.json
    if not data:
        return jsonify({"error": "Invalid request"}), 400

    url = str(data.get("url", ""))[:500]
    custom_name = data.get("custom_name")

    if not url:
        return jsonify({"error": "URL is required"}), 400

    if custom_name is not None:
        custom_name = str(custom_name).strip()[:255]
        if not custom_name:
            custom_name = None

    user_id = session['user_id']

    try:
        website = Website.query.filter_by(user_id=user_id, url=url).first()

        if website:
            website.custom_name = custom_name
            db.session.commit()
            return jsonify({"message": "Source renamed successfully"}), 200
        else:
            from urllib.parse import urlparse
            domain = urlparse(url).netloc[:200] if "://" in url else url[:200]
            
            new_site = Website(
                url=url, 
                domain=domain, 
                custom_name=custom_name, 
                user_id=user_id
            )
            db.session.add(new_site)
            db.session.commit()
            return jsonify({"message": "Source tracked and renamed successfully"}), 200

    except Exception as e:
        db.session.rollback()
        app.logger.error(f"rename_website error: {e}")
        return jsonify({"error": "An internal error occurred"}), 500

@app.route('/api/folders/<string:folder_name>', methods=['DELETE'])
def delete_folder(folder_name):
    if 'user_id' not in session:
        return jsonify({"error": "Login required"}), 401

    folder_name = unquote(folder_name)[:_FOLDER_NAME_MAX]
    if not folder_name:
        return jsonify({"error": "Invalid folder name"}), 400

    try:
        notes = (
            Note.query.join(Website)
            .filter(Website.user_id == session['user_id'], Note.folder == folder_name)
            .all()
        )
        for note in notes:
            db.session.delete(note)
        db.session.commit()
        return jsonify({"message": f"Folder and {len(notes)} notes deleted"}), 200
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"delete_folder error: {e}")
        return jsonify({"error": "An internal error occurred"}), 500

@app.route('/api/folders/rename', methods=['PUT'])
def rename_folder():
    if 'user_id' not in session:
        return jsonify({"error": "Login required"}), 401

    data = request.json
    if not data:
        return jsonify({"error": "Invalid request"}), 400

    old_name = str(data.get("old_name", ""))[:_FOLDER_NAME_MAX]
    new_name = str(data.get("new_name", ""))[:_FOLDER_NAME_MAX]

    if not old_name or not new_name:
        return jsonify({"error": "Invalid folder names"}), 400

    try:
        notes = (
            Note.query.join(Website)
            .filter(Website.user_id == session['user_id'], Note.folder == old_name)
            .all()
        )
        for note in notes:
            note.folder = new_name
        db.session.commit()
        return jsonify({"message": "Folder renamed"}), 200
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"rename_folder error: {e}")
        return jsonify({"error": "An internal error occurred"}), 500