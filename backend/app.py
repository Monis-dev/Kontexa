import os
import re
import hmac
import hashlib
import razorpay
import resend
from datetime import datetime, timedelta
from urllib.parse import unquote, urlparse
from flask import Flask, request, jsonify, session, redirect, url_for, render_template, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.orm import joinedload
from sqlalchemy import func, text as sa_text
from authlib.integrations.flask_client import OAuth
from flask_cors import CORS
from dotenv import load_dotenv
from markupsafe import escape

load_dotenv()

app = Flask(__name__)

# ─── Startup validation ───────────────────────────────────────────────────────
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
app.secret_key = os.environ["SECRET_KEY"]

_EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')

# ─── Resend email setup ───────────────────────────────────────────────────────
resend.api_key = os.getenv("RESEND_API_KEY", "")
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "monisahmed015@gmail.com")
FROM_EMAIL  = "Kontexa <noreply@kontexa.online>"

if not resend.api_key:
    app.logger.warning("RESEND_API_KEY is not set — emails will not send")
else:
    app.logger.info(f"Resend ready — key prefix: {resend.api_key[:6]}...")

# ─── Database ─────────────────────────────────────────────────────────────────
uri = os.getenv("DATABASE_URL", "")
if uri.startswith("postgres://"):
    uri = uri.replace("postgres://", "postgresql://", 1)

app.config["SQLALCHEMY_DATABASE_URI"] = uri
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {
    "pool_pre_ping": True,
    "pool_size": 2,
    "max_overflow": 5,
    "pool_recycle": 300,
    "pool_timeout": 30,
    "connect_args": {
        "sslmode": "require",
        "keepalives": 1,
        "keepalives_idle": 30,
        "keepalives_interval": 10,
        "keepalives_count": 5
    }
}
db = SQLAlchemy(app)

# ─── Razorpay ─────────────────────────────────────────────────────────────────
RAZORPAY_KEY_ID = os.getenv("RAZORPAY_KEY_ID")
RAZORPAY_SECRET = os.getenv("RAZORPAY_SECRET_KEY")
client = razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_SECRET))

# ─── CORS ─────────────────────────────────────────────────────────────────────
EXTENSION_ID     = os.getenv("EXTENSION_ID", "")
EXTENSION_ID_DEV = os.getenv("EXTENSION_ID_DEV", "")

_allowed_origins = [
    "https://www.kontexa.online",
    "https://kontexa.online",
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
    """Returns True if the request carries a valid admin token.
    The token must be sent as the X-Admin-Token header and must match
    the ADMIN_SECRET environment variable."""
    secret = os.getenv("ADMIN_SECRET", "")
    if not secret:
        return False
    provided = request.headers.get("X-Admin-Token", "")
    # Constant-time comparison to prevent timing attacks
    return hmac.compare_digest(provided, secret)


def _sanitize_folder(raw) -> str | None:
    """Normalize a folder value — returns None for empty/None/invalid strings."""
    if not raw:
        return None
    cleaned = str(raw).strip()[:_FOLDER_NAME_MAX]
    if cleaned.lower() in ("", "none", "null", "undefined"):
        return None
    return cleaned


def _sanitize_timestamp(raw) -> str | None:
    """Normalize a timestamp value — returns None for empty/None/invalid strings."""
    if not raw:
        return None
    cleaned = str(raw).strip()[:20]
    if cleaned.lower() in ("", "none", "null", "undefined"):
        return None
    return cleaned


_NOTE_MAX_COUNT   = 500
_NOTE_TITLE_MAX   = 255
_NOTE_CONTENT_MAX = 100_000   # 100 KB
_NOTE_IMAGE_MAX   = 2_000_000 # 2 MB base64
_FOLDER_NAME_MAX  = 100


# ─── Models ───────────────────────────────────────────────────────────────────

class User(db.Model):
    id             = db.Column(db.Integer, primary_key=True)
    email          = db.Column(db.String(120), unique=True, nullable=False)
    is_pro         = db.Column(db.Boolean, default=False)
    plan_type      = db.Column(db.String(20), default='free')
    pro_expires_at = db.Column(db.DateTime, nullable=True)
    websites       = db.relationship('Website', backref='user', lazy=True)
    created_at     = db.Column(db.DateTime, default=datetime.utcnow)

class Website(db.Model):
    id          = db.Column(db.Integer, primary_key=True)
    url         = db.Column(db.String(500), nullable=False, index=True)
    domain      = db.Column(db.String(200))
    custom_name = db.Column(db.String(255), nullable=True)
    user_id     = db.Column(db.Integer, db.ForeignKey('user.id', ondelete="CASCADE"), nullable=False, index=True)
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
    website_id = db.Column(db.Integer, db.ForeignKey('website.id', ondelete="CASCADE"), nullable=False)
    deleted    = db.Column(db.Boolean, default=False)
    deleted_at = db.Column(db.DateTime, nullable=True)

class Feedback(db.Model):
    __tablename__ = 'feedback'
    id            = db.Column(db.Integer, primary_key=True)
    user_id       = db.Column(db.Integer, db.ForeignKey('user.id', ondelete="SET NULL"), nullable=True)
    email         = db.Column(db.String(255), nullable=True)
    fb_type       = db.Column(db.String(50), default='feature')
    subject       = db.Column(db.String(255), nullable=True)
    message       = db.Column(db.Text, nullable=False)
    created_at    = db.Column(db.DateTime, default=datetime.utcnow)

class PricingConfig(db.Model):
    __tablename__      = 'pricing_config'
    id                 = db.Column(db.Integer, primary_key=True)
    plan_type          = db.Column(db.String(20), unique=True, nullable=False)
    base_usd           = db.Column(db.Integer, nullable=False)
    base_inr_paise     = db.Column(db.Integer, nullable=False)
    discount_usd       = db.Column(db.Integer, nullable=True)
    discount_inr_paise = db.Column(db.Integer, nullable=True)
    promo_badge        = db.Column(db.String(100), nullable=True)


# ─── Pricing Config ───────────────────────────────────────────────────────────

DEFAULT_PRICING = {
    "monthly": {
        "base_usd": 2,
        "base_inr_paise": 18000,
        "discount_usd": None,
        "discount_inr_paise": None,
        "promo_badge": "Most Popular",
        "badge": "Most Popular"
    },
    "lifetime": {
        "base_usd": 40,
        "base_inr_paise": 350000,
        "discount_usd": 25,
        "discount_inr_paise": 210000,
        "promo_badge": "🔥 Launch Sale!",
        "badge": "🔥 Launch Sale!"
    }
}

def get_pricing_config():
    """Fetches pricing from DB, falls back to DEFAULT_PRICING if table missing or empty."""
    try:
        plans = PricingConfig.query.all()
        config = {k: v.copy() for k, v in DEFAULT_PRICING.items()}
        for p in plans:
            if p.plan_type in config:
                config[p.plan_type] = {
                    "base_usd":           p.base_usd,
                    "base_inr_paise":     p.base_inr_paise,
                    "discount_usd":       p.discount_usd,
                    "discount_inr_paise": p.discount_inr_paise,
                    "promo_badge":        p.promo_badge,
                    "badge":              p.promo_badge,
                }
        return config
    except Exception as e:
        app.logger.warning(f"get_pricing_config fell back to defaults: {e}")
        return {k: v.copy() for k, v in DEFAULT_PRICING.items()}


# ─── Auth ─────────────────────────────────────────────────────────────────────

google = oauth.register(
    name='google',
    client_id=os.getenv("CLIENT_ID"),
    client_secret=os.getenv("CLIENT_SECRET"),
    server_metadata_url='https://accounts.google.com/.well-known/openid-configuration',
    client_kwargs={'scope': 'openid email profile'}
)


# ─── Routes: Public ───────────────────────────────────────────────────────────

@app.route("/")
def home():
    return render_template("index.html", pricing=get_pricing_config())

@app.route('/privacy')
def privacy():
    return render_template("privacy.html")

@app.route('/sitemap.xml')
def static_from_root():
    return send_from_directory(app.static_folder, 'sitemap.xml')

@app.route('/support')
def support():
    return render_template('support.html')

# FIX: expose both /wakeUp and /api/wakeUp so both server and dashboard.js work
@app.route("/wakeUp")
@app.route("/api/wakeUp")
def wakeUp():
    return jsonify({"status": "ok"}), 200

@app.route("/api/user-count")
def user_count():
    count = db.session.query(User).count()
    return jsonify({"count": count})


# ─── Routes: Email test (admin only) ─────────────────────────────────────────

@app.route("/test-email")
def test_email():
    if not _admin_token_required():
        return jsonify({"error": "Forbidden"}), 403
    try:
        result = resend.Emails.send({
            "from": FROM_EMAIL,
            "to": [os.getenv("ADMIN_EMAIL", "your@gmail.com")],
            "subject": "Resend test from Kontexa",
            "html": "<p>If you see this, Resend is working correctly.</p>"
        })
        return jsonify({"ok": True, "result": str(result)}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ─── Routes: Admin Dashboard ──────────────────────────────────────────────────

@app.route('/hq-admin-panel')
def admin_dashboard():
    return render_template("admin.html")

@app.route('/api/admin/stats')
def admin_stats():
    if not _admin_token_required():
        return jsonify({"error": "Forbidden"}), 403
    try:
        s = {
            "total_users":    User.query.count(),
            "pro_users":      User.query.filter_by(is_pro=True).count(),
            "lifetime_users": User.query.filter_by(plan_type='lifetime').count(),
            "monthly_users":  User.query.filter_by(plan_type='monthly').count(),
            "free_users":     User.query.filter_by(plan_type='free').count(),
            "total_notes":    Note.query.count(),
            "total_websites": Website.query.count(),
            "expired_users":  User.query.filter(
                User.plan_type == 'monthly',
                User.pro_expires_at < datetime.utcnow()
            ).count()
        }
        try:
            res = db.session.execute(sa_text("SELECT pg_database_size(current_database())")).fetchone()
            s["db_size_mb"] = round(res[0] / (1024 * 1024), 2) if res else 0
        except:
            s["db_size_mb"] = 0
        s["db_limit_mb"] = 512
        return jsonify(s)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/admin/users')
def admin_users():
    if not _admin_token_required():
        return jsonify({"error": "Forbidden"}), 403
    users = User.query.order_by(User.id.desc()).all()
    return jsonify([{
        "id":            u.id,
        "email":         u.email,
        "is_pro":        u.is_pro,
        "plan_type":     u.plan_type,
        "pro_expires_at": u.pro_expires_at.isoformat() if u.pro_expires_at else None,
        "created_at":    u.created_at.isoformat() if u.created_at else None,
    } for u in users])

@app.route('/api/admin/users/<int:user_id>', methods=['DELETE'])
def admin_delete_user(user_id):
    if not _admin_token_required():
        return jsonify({"error": "Forbidden"}), 403
    try:
        user = db.session.get(User, user_id)
        if not user:
            return jsonify({"error": "User not found"}), 404
        db.session.delete(user)
        db.session.commit()
        return jsonify({"ok": True, "message": f"User {user_id} deleted"}), 200
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"admin_delete_user error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/admin/pricing', methods=['POST'])
def admin_update_pricing():
    if not _admin_token_required():
        return jsonify({"error": "Forbidden"}), 403
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Invalid request"}), 400
    plan_type = data.get("plan_type")
    if plan_type not in ("monthly", "lifetime"):
        return jsonify({"error": "Invalid plan type"}), 400
    try:
        plan = PricingConfig.query.filter_by(plan_type=plan_type).first()
        if not plan:
            plan = PricingConfig(plan_type=plan_type, base_usd=0, base_inr_paise=0)
            db.session.add(plan)
        if 'base_usd'           in data: plan.base_usd           = int(data['base_usd'])
        if 'base_inr_paise'     in data: plan.base_inr_paise     = int(data['base_inr_paise'])
        plan.discount_usd       = int(data['discount_usd'])       if data.get('discount_usd')       is not None else None
        plan.discount_inr_paise = int(data['discount_inr_paise']) if data.get('discount_inr_paise') is not None else None
        plan.promo_badge        = str(data.get('promo_badge', ''))[:100] if data.get('promo_badge') else None
        db.session.commit()
        return jsonify({"ok": True})
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500

# Single, secure admin feedback endpoint (header-based auth only)
@app.route('/api/admin/feedback-digest', methods=['GET'])
def admin_feedback():
    if not _admin_token_required():
        return jsonify({"error": "Forbidden"}), 403
    week_ago = datetime.utcnow() - timedelta(days=7)
    rows = Feedback.query.filter(Feedback.created_at >= week_ago).all()
    return jsonify([{
        "id":         f.id,
        "email":      f.email,
        "type":       f.fb_type,
        "subject":    f.subject,
        "message":    f.message,
        "created_at": f.created_at.isoformat()
    } for f in rows])


# ─── Routes: Mobile PWA ───────────────────────────────────────────────────────

@app.route("/mobile")
def mobile_redirect():
    return redirect("/mobile/", code=301)

@app.route("/mobile/")
def mobile_app():
    return send_from_directory(MOBILE_DIR, 'index.html')

@app.route("/mobile/<path:filename>")
def mobile_static(filename):
    return send_from_directory(MOBILE_DIR, filename)


# ─── Routes: Login / OAuth ────────────────────────────────────────────────────

@app.route("/login")
def login():
    mobile = request.args.get("mobile", "0")
    session["login_origin"] = "mobile" if mobile == "1" else "desktop"
    return google.authorize_redirect(url_for('authorize', _external=True))

@app.route('/authorize')
def authorize():
    token     = google.authorize_access_token()
    user_info = token.get('userinfo')
    if not user_info or not user_info.get('email'):
        return redirect(url_for('home'))

    user = User.query.filter_by(email=user_info['email']).first()
    is_new_user = False

    if not user:
        is_new_user = True
        total_users = User.query.count()
        if total_users < 100:
            user = User(
                email=user_info['email'],
                is_pro=True,
                plan_type='lifetime'
            )
            app.logger.info(f"Early Bird User ({total_users + 1}/100): {user_info['email']}")
        else:
            user = User(
                email=user_info['email'],
                is_pro=False,
                plan_type='free'
            )
        db.session.add(user)
        db.session.commit()

        if user.is_pro:
            try:
                email_html = render_template(
                    'welcome_pro_email.html',
                    email=user_info['email'],
                    logo_url=url_for('static', filename='images/logo.png', _external=True)
                )
                resend.Emails.send({
                    "from": FROM_EMAIL,
                    "to": [user_info['email']],
                    "subject": "🎉 You're in — Kontexa Lifetime Pro is yours, free",
                    "html": email_html
                })
                app.logger.info(f"Welcome email sent to {user_info['email']}")
            except Exception as mail_err:
                app.logger.error(f"Welcome email failed: {mail_err}")

    session['user_id']    = user.id
    session['user_email'] = user.email
    session.permanent     = True

    # FIX: use login_origin to pick correct template, not is_new_user
    origin   = session.pop("login_origin", "desktop")
    template = "auth_success_mobile.html" if origin == "mobile" else "auth_success_desktop.html"
    return render_template(template, email=user.email)

@app.route('/api/me')
def get_me():
    if 'user_id' not in session:
        return jsonify({"error": "Not logged in"}), 401

    user = db.session.get(User, session['user_id'])
    if not user:
        session.clear()
        return jsonify({"error": "User not found"}), 401

    days_left = None
    if user.is_pro and user.plan_type == 'monthly' and user.pro_expires_at:
        if datetime.utcnow() > user.pro_expires_at:
            user.is_pro    = False
            user.plan_type = 'free'
            db.session.commit()
        else:
            delta     = user.pro_expires_at - datetime.utcnow()
            days_left = delta.days

    return jsonify({
        'email':     session['user_email'],
        'is_pro':    user.is_pro,
        'plan_type': user.plan_type,
        'days_left': days_left
    })

@app.route('/api/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({"message": "Logged out"}), 200


# ─── Routes: Database init (admin only) ───────────────────────────────────────

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


# ─── Routes: Pricing & Razorpay ───────────────────────────────────────────────

@app.route('/pricing')
def pricing():
    if 'user_id' not in session:
        return redirect(url_for('login'))
    user = db.session.get(User, session['user_id'])
    if not user:
        session.clear()
        return redirect(url_for('login'))
    return render_template(
        'pricing.html',
        email=user.email,
        razorpay_key_id=RAZORPAY_KEY_ID,
        pricing=get_pricing_config()
    )

@app.route('/create-order', methods=['POST'])
def create_order():
    if 'user_id' not in session:
        return jsonify({"error": "Login required"}), 401

    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Invalid request body"}), 400

    plan_type = data.get("plan_type")
    if plan_type not in ("monthly", "lifetime"):
        return jsonify({"error": "Invalid plan type"}), 400

    try:
        current_pricing = get_pricing_config()
        plan_data       = current_pricing.get(plan_type)

        if not plan_data:
            app.logger.error(f"Plan '{plan_type}' not found in pricing config")
            return jsonify({"error": "Plan configuration not found"}), 500

        # FIX: use discount if active, otherwise base price — never None or 0
        amount = plan_data.get("discount_inr_paise") or plan_data.get("base_inr_paise")

        if not amount or not isinstance(amount, int) or amount <= 0:
            app.logger.error(f"Invalid amount for plan {plan_type}: {amount!r}")
            return jsonify({"error": "Invalid pricing configuration — contact support"}), 500

        user_id = session['user_id']

        order = client.order.create({
            "amount":          amount,
            "currency":        "INR",
            "payment_capture": 1,
            "notes": {
                "user_id":   str(user_id),
                "plan_type": plan_type
            }
        })

        if not order.get("id"):
            app.logger.error(f"Razorpay returned order without ID: {order}")
            return jsonify({"error": "Order creation failed"}), 500

        return jsonify(order)

    except razorpay.errors.BadRequestError as e:
        app.logger.error(f"Razorpay bad request for plan={plan_type}: {e}")
        return jsonify({"error": "Payment provider rejected the request"}), 400
    except Exception as e:
        app.logger.error(f"create_order error: {e}", exc_info=True)
        return jsonify({"error": "Order creation failed — please try again"}), 500

@app.route('/verify-payment', methods=['POST'])
def verify_payment():
    if 'user_id' not in session:
        return jsonify({"error": "Login required"}), 401

    data = request.get_json(silent=True)
    if not data:
        return jsonify({"status": "failed", "error": "Invalid request"}), 400

    razorpay_order_id   = data.get('razorpay_order_id')
    razorpay_payment_id = data.get('razorpay_payment_id')
    razorpay_signature  = data.get('razorpay_signature')

    if not all([razorpay_order_id, razorpay_payment_id, razorpay_signature]):
        return jsonify({"status": "failed", "error": "Missing payment fields"}), 400

    try:
        # 1. Verify cryptographic signature first
        client.utility.verify_payment_signature({
            'razorpay_order_id':   razorpay_order_id,
            'razorpay_payment_id': razorpay_payment_id,
            'razorpay_signature':  razorpay_signature
        })

        # 2. Fetch order and extract stored user_id
        order           = client.order.fetch(razorpay_order_id)
        order_user_id   = int(order["notes"]["user_id"])
        session_user_id = session['user_id']

        # 3. TOCTOU guard — logged-in user must match order owner
        if order_user_id != session_user_id:
            app.logger.warning(
                f"Payment user mismatch: order owner {order_user_id} "
                f"vs session user {session_user_id}"
            )
            return jsonify({"status": "failed", "error": "User mismatch"}), 403

        user = db.session.get(User, session_user_id)
        if user:
            plan_type    = order["notes"].get("plan_type", "lifetime")
            user.is_pro  = True
            if plan_type == "monthly":
                if (user.plan_type == 'monthly'
                        and user.pro_expires_at
                        and user.pro_expires_at > datetime.utcnow()):
                    # Extend existing subscription
                    user.pro_expires_at = user.pro_expires_at + timedelta(days=30)
                else:
                    user.pro_expires_at = datetime.utcnow() + timedelta(days=30)
            else:
                user.pro_expires_at = None
            user.plan_type = plan_type
            db.session.commit()

        return jsonify({"status": "success"})

    except Exception as e:
        app.logger.error(f"verify-payment error: {e}")
        return jsonify({"status": "failed"}), 400

@app.route('/success')
def success():
    email = session.get('user_email', 'Pro User')
    return render_template("auth_success_desktop.html", email=email)

@app.route('/test/time-travel/<int:days_left>')
def time_travel(days_left):
    if 'user_id' not in session:
        return "Please log in first."
    user = db.session.get(User, session['user_id'])
    if not user:
        return "User not found."
    user.pro_expires_at = datetime.utcnow() + timedelta(days=days_left)
    db.session.commit()
    return f"Time travel successful! Your account now expires in {days_left} days."


# ─── Routes: Feedback ────────────────────────────────────────────────────────

@app.route('/api/feedback', methods=['POST'])
def submit_feedback():
    try:
        data    = request.get_json(silent=True) or {}
        fb_type = str(escape(data.get('type',    'feature')))[:50]
        subject = str(escape(data.get('subject', '')))[:255]
        message = str(escape(data.get('message', '')))[:5000]

        if not message:
            return jsonify({'error': 'Message is required'}), 400

        email   = None
        user_id = session.get('user_id')
        if user_id:
            user  = db.session.get(User, user_id)
            email = user.email if user else None

        feedback = Feedback(
            user_id=user_id,
            email=email,
            fb_type=fb_type,
            subject=subject,
            message=message,
        )
        db.session.add(feedback)
        db.session.commit()
        return jsonify({'ok': True}), 201

    except Exception as e:
        db.session.rollback()
        app.logger.error(f"Feedback error: {e}")
        return jsonify({'error': 'Internal Server Error'}), 500


# ─── Routes: Support ─────────────────────────────────────────────────────────

@app.route('/api/support', methods=['POST'])
def support_contact():
    try:
        data    = request.get_json(silent=True) or {}
        email   = str(data.get('email',   '')).strip()[:255]
        fb_type = str(data.get('type',    'general')).strip()[:50]
        subject = str(data.get('subject', '')).strip()[:255]
        message = str(data.get('message', '')).strip()[:2000]

        if not email or not _EMAIL_RE.match(email):
            return jsonify({'error': 'A valid email address is required.'}), 400
        if not message:
            return jsonify({'error': 'Message is required.'}), 400

        existing_user = User.query.filter_by(email=email).first()
        feedback = Feedback(
            user_id=existing_user.id if existing_user else None,
            email=email,
            fb_type=str(escape(fb_type)),
            subject=str(escape(subject)),
            message=str(escape(message)),
        )
        db.session.add(feedback)
        db.session.commit()

        try:
            resend.Emails.send({
                "from":     FROM_EMAIL,
                "to":       [ADMIN_EMAIL],
                "reply_to": [email],
                "subject":  f"[Kontexa Support] {fb_type} — {subject}",
                "html": f"""
<div style="font-family:Arial,sans-serif;max-width:520px;padding:24px;color:#0d0f12;">
<h2 style="margin:0 0 16px;font-size:18px;">New Support Message</h2>
<table style="width:100%;border-collapse:collapse;">
  <tr><td style="padding:8px 0;color:#767b87;width:80px;">From</td><td style="padding:8px 0;font-weight:600;">{email}</td></tr>
  <tr><td style="padding:8px 0;color:#767b87;">Topic</td><td style="padding:8px 0;">{fb_type}</td></tr>
  <tr><td style="padding:8px 0;color:#767b87;">Subject</td><td style="padding:8px 0;">{subject}</td></tr>
</table>
<div style="background:#f7f7f5;border-radius:8px;padding:16px;margin-top:16px;font-size:14px;line-height:1.7;white-space:pre-wrap;">{message}</div>
<p style="font-size:12px;color:#9ca3af;margin-top:20px;">Hit Reply to respond directly to {email}</p>
</div>"""
            })
            resend.Emails.send({
                "from":    FROM_EMAIL,
                "to":      [email],
                "subject": "We got your message — Kontexa Support",
                "html": f"""<!DOCTYPE html>
<html><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f7f7f5;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f7f5;padding:40px 0;">
<tr><td align="center">
  <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;border:1px solid #e8e8e4;overflow:hidden;">
  <tr><td style="background:#0d0f12;padding:24px 36px;">
    <table cellpadding="0" cellspacing="0"><tr>
    <td style="width:28px;height:28px;background:#4f46e5;border-radius:5px;text-align:center;vertical-align:middle;">
      <span style="color:#fff;font-size:15px;font-weight:700;">K</span>
    </td>
    <td style="padding-left:10px;font-size:15px;font-weight:600;color:#fff;">Kontexa</td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:32px 36px;">
    <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0d0f12;">We got your message ✅</p>
    <p style="margin:0 0 24px;font-size:14px;color:#767b87;line-height:1.7;">
    Thanks for reaching out! We typically reply within 24 hours.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f7f5;border-radius:10px;margin-bottom:24px;">
    <tr><td style="padding:16px 20px;">
      <p style="margin:0 0 6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#767b87;">Your message</p>
      <p style="margin:0 0 12px;font-size:13px;color:#767b87;"><strong style="color:#0d0f12;">Topic:</strong> {fb_type} &nbsp;·&nbsp; <strong style="color:#0d0f12;">Subject:</strong> {subject}</p>
      <p style="margin:0;font-size:14px;color:#0d0f12;line-height:1.7;white-space:pre-wrap;">{message}</p>
    </td></tr>
    </table>
    <p style="margin:0;font-size:13px;color:#767b87;line-height:1.7;">
    We'll reply to <strong style="color:#0d0f12;">{email}</strong>.</p>
  </td></tr>
  <tr><td style="padding:16px 36px;border-top:1px solid #e8e8e4;">
    <p style="margin:0;font-size:12px;color:#9ca3af;">
    Kontexa · <a href="https://kontexa.online" style="color:#4f46e5;text-decoration:none;">kontexa.online</a></p>
  </td></tr>
  </table>
</td></tr>
</table>
</body></html>"""
            })
        except Exception as mail_err:
            app.logger.error(f"Support email failed: {mail_err}")

        return jsonify({'ok': True}), 201

    except Exception as e:
        db.session.rollback()
        app.logger.error(f"support_contact error: {e}")
        return jsonify({'error': 'Internal server error.'}), 500


# ─── Routes: Notes API ────────────────────────────────────────────────────────

@app.route('/api/sync', methods=['POST'])
def sync_notes():
    if 'user_id' not in session:
        return jsonify({"error": "Login required"}), 401
    user = db.session.get(User, session['user_id'])
    if not user or not user.is_pro:
        return jsonify({"error": "Pro upgrade required"}), 403

    notes = request.get_json(silent=True)
    if not isinstance(notes, list):
        return jsonify({"error": "Invalid payload"}), 400
    if len(notes) > _NOTE_MAX_COUNT:
        return jsonify({"error": f"Sync limit is {_NOTE_MAX_COUNT} notes per request"}), 400

    existing_ids = {
        n.local_id for n in
        Note.query.join(Website).filter(Website.user_id == user.id).all()
    }
    sites_cache = {s.url: s for s in Website.query.filter_by(user_id=user.id).all()}
    new_notes   = []

    for note in notes:
        local_id = str(note.get("id", ""))[:50]
        if not local_id:
            continue

        if note.get("deleted"):
            existing_note = (
                Note.query.join(Website)
                .filter(Website.user_id == user.id, Note.local_id == local_id)
                .first()
            )
            if existing_note:
                db.session.delete(existing_note)
            continue

        if local_id in existing_ids:
            continue

        # Validate and sanitize fields
        title      = str(note.get("title", "Untitled") or "Untitled")[:_NOTE_TITLE_MAX]
        content    = str(note.get("content", "") or "")[:_NOTE_CONTENT_MAX]
        image_data = str(note.get("image_data", "") or "")
        if len(image_data) > _NOTE_IMAGE_MAX:
            image_data = ""

        # FIX: sanitize folder and timestamp — never store "None"/"null" strings
        folder_val    = _sanitize_folder(note.get("folder"))
        timestamp_val = _sanitize_timestamp(note.get("timestamp"))

        raw_url = str(note.get("url", ""))[:500]
        site    = sites_cache.get(raw_url)
        if not site:
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
            selection=str(note.get("selection", "") or "")[:5000],
            pinned=bool(note.get("pinned", False)),
            timestamp=timestamp_val,
            image_data=image_data,
            folder=folder_val,
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
    if not user or not user.is_pro:
        return jsonify([]), 403

    websites = (
        Website.query
        .options(joinedload(Website.notes))
        .filter_by(user_id=user.id)
        .all()
    )
    result = []
    for s in websites:
        # Skip general notes — served by /api/general-notes
        if s.url in ("general://notes", "folder://notes"):
            continue
        filtered_notes = [{
            "id":         n.local_id,
            "title":      n.title,
            "content":    n.content,
            "selection":  n.selection,
            "pinned":     n.pinned,
            "timestamp":  n.timestamp,
            "folder":     n.folder,
            "image_data": n.image_data,
            "tags":       n.tags.split(",") if n.tags else [],
            "deleted":    n.deleted
        } for n in s.notes if not n.deleted]
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
    if not user or not user.is_pro:
        return jsonify([]), 403

    # FIX: check both URL variants so nothing is missed
    sites = Website.query.filter(
        Website.user_id == user.id,
        Website.url.in_(["general://notes", "folder://notes"])
    ).all()

    notes = []
    for site in sites:
        for n in site.notes:
            if n.deleted:
                continue
            notes.append({
                "id":         n.local_id,
                "title":      n.title,
                "content":    n.content,
                "selection":  n.selection,
                "pinned":     n.pinned,
                "timestamp":  n.timestamp,
                "folder":     n.folder,
                "image_data": n.image_data,
                "tags":       n.tags.split(",") if n.tags else [],
                "deleted":    n.deleted,
                "url":        "general://notes",
                "domain":     "general",
                "_synced":    True
            })
    return jsonify(notes)

@app.route('/api/notes/<string:local_id>', methods=['PUT'])
def update_note(local_id):
    if 'user_id' not in session:
        return jsonify({"error": "Login required"}), 401

    note = (
        Note.query.join(Website)
        .filter(Website.user_id == session['user_id'], Note.local_id == local_id)
        .first()
    )
    if not note:
        return jsonify({"error": "Note not found"}), 404

    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Invalid request"}), 400

    if 'title'   in data: note.title   = str(data['title'])[:_NOTE_TITLE_MAX]
    if 'content' in data: note.content = str(data['content'])[:_NOTE_CONTENT_MAX]
    if 'pinned'  in data: note.pinned  = bool(data['pinned'])
    if 'folder'  in data: note.folder  = _sanitize_folder(data['folder'])
    if 'tags'    in data: note.tags    = data['tags']
    if 'deleted' in data: note.deleted = bool(data['deleted'])

    db.session.commit()
    return jsonify({"message": "Updated successfully"})

@app.route('/api/notes/<string:local_id>', methods=['DELETE'])
def delete_note(local_id):
    if 'user_id' not in session:
        return jsonify({"error": "Login required"}), 401
    try:
        note = (
            Note.query.join(Website)
            .filter(Website.user_id == session['user_id'], Note.local_id == local_id)
            .first()
        )
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
    if not user or not user.is_pro:
        return jsonify({"error": "Pro required"}), 403

    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "No data"}), 400

    updated_count = 0
    for item in data:
        local_id = str(item.get("id", ""))[:50]
        new_tags = item.get("tags", [])
        note = (
            Note.query.join(Website)
            .filter(Website.user_id == user.id, Note.local_id == local_id)
            .first()
        )
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

    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Invalid request"}), 400

    url         = str(data.get("url", ""))[:500]
    custom_name = data.get("custom_name")

    if not url:
        return jsonify({"error": "URL is required"}), 400

    if custom_name is not None:
        custom_name = str(custom_name).strip()[:255]
        if not custom_name:
            custom_name = None

    try:
        website = Website.query.filter_by(user_id=session['user_id'], url=url).first()
        if website:
            website.custom_name = custom_name
            db.session.commit()
            return jsonify({"message": "Source renamed successfully"}), 200
        else:
            domain   = urlparse(url).netloc[:200] if "://" in url else url[:200]
            new_site = Website(
                url=url,
                domain=domain,
                custom_name=custom_name,
                user_id=session['user_id']
            )
            db.session.add(new_site)
            db.session.commit()
            return jsonify({"message": "Source tracked and renamed"}), 200
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"rename_website error: {e}")
        return jsonify({"error": "An internal error occurred"}), 500

@app.route('/api/folders/<string:folder_name>', methods=['DELETE'])
def delete_folder(folder_name):
    if 'user_id' not in session:
        return jsonify({"error": "Login required"}), 401

    folder_name = _sanitize_folder(unquote(folder_name))
    if not folder_name:
        return jsonify({"error": "Invalid folder name"}), 400

    try:
        notes = (
            Note.query.join(Website)
            .filter(Website.user_id == session['user_id'], Note.folder == folder_name)
            .all()
        )
        # FIX: unassign notes from folder instead of deleting them
        for note in notes:
            note.folder = None
        db.session.commit()
        return jsonify({"message": f"Folder removed, {len(notes)} notes unassigned"}), 200
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"delete_folder error: {e}")
        return jsonify({"error": "An internal error occurred"}), 500

@app.route('/api/folders/rename', methods=['PUT'])
def rename_folder():
    if 'user_id' not in session:
        return jsonify({"error": "Login required"}), 401

    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Invalid request"}), 400

    old_name = _sanitize_folder(data.get("old_name", ""))
    new_name = _sanitize_folder(data.get("new_name", ""))

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
        return jsonify({"message": f"Folder renamed, {len(notes)} notes updated"}), 200
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"rename_folder error: {e}")
        return jsonify({"error": "An internal error occurred"}), 500


# ─── Startup ──────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    with app.app_context():
        try:
            db.create_all()
            print("Database tables verified.")
        except Exception as e:
            print(f"Database connection skipped or failed: {e}")
    app.run(host='0.0.0.0', port=port)