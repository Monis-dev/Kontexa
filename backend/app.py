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
from sqlalchemy import func, text as sa_text




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
# Set EXTENSION_ID in your environment to your published Chrome Web Store ID.
# For local unpacked development, also set EXTENSION_ID_DEV.
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
    id             = db.Column(db.Integer, primary_key=True)
    email          = db.Column(db.String(120), unique=True, nullable=False)
    is_pro         = db.Column(db.Boolean, default=False)
    plan_type      = db.Column(db.String(20), default='free') # 'free', 'monthly', 'lifetime'
    pro_expires_at = db.Column(db.DateTime, nullable=True)
    websites       = db.relationship('Website', backref='user', lazy=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

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

class Feedback(db.Model):
    __tablename__ = 'feedback'
    id         = db.Column(db.Integer, primary_key=True)
    user_id    = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True) 
    email      = db.Column(db.String(255), nullable=True)
    fb_type    = db.Column(db.String(50), default='feature')
    subject    = db.Column(db.String(255), nullable=True)
    message    = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class PricingConfig(db.Model):
    __tablename__      = 'pricing_config'
    id                 = db.Column(db.Integer, primary_key=True)
    plan_type          = db.Column(db.String(20), unique=True, nullable=False) # 'monthly' or 'lifetime'
    base_usd           = db.Column(db.Integer, nullable=False)
    base_inr_paise     = db.Column(db.Integer, nullable=False)
    discount_usd       = db.Column(db.Integer, nullable=True)
    discount_inr_paise = db.Column(db.Integer, nullable=True)
    promo_badge        = db.Column(db.String(100), nullable=True)


# ─── Pricing Config ───────────────────────────────────────────────────────────────────
PRICING_CONFIG = {
    "monthly": {
        "base_usd": 2,
        "base_inr_paise": 18000,  # 180.00 INR
        "discount_usd": None,     # Set to an integer (e.g., 1) to run a sale
        "discount_inr_paise": None, 
        "promo_badge": "Most Popular"
    },
    "lifetime": {
        "base_usd": 40,
        "base_inr_paise": 350000, # 3500.00 INR
        "discount_usd": 25,       # EXAMPLE ACTIVE SALE: Reduced to $25
        "discount_inr_paise": 210000, # Reduced to 2100.00 INR
        "promo_badge": "🔥 Launch Sale!"
    }
}

DEFAULT_PRICING = {
    "monthly": {
        "base_usd": 2, "base_inr_paise": 18000, 
        "discount_usd": None, "discount_inr_paise": None, "promo_badge": "Most Popular"
    },
    "lifetime": {
        "base_usd": 40, "base_inr_paise": 350000, 
        "discount_usd": 25, "discount_inr_paise": 210000, "promo_badge": "🔥 Launch Sale!"
    }
}

def get_pricing_config():
    """Fetches pricing from the DB, falls back to DEFAULT_PRICING if DB is empty."""
    try:
        plans = PricingConfig.query.all()
        if not plans:
            return DEFAULT_PRICING
            
        config = {}
        for p in plans:
            config[p.plan_type] = {
                "base_usd": p.base_usd,
                "base_inr_paise": p.base_inr_paise,
                "discount_usd": p.discount_usd,
                "discount_inr_paise": p.discount_inr_paise,
                "promo_badge": p.promo_badge
            }
        return config
    except Exception as e:
        app.logger.error(f"Error fetching pricing: {e}")
        return DEFAULT_PRICING



# ─── Auth ─────────────────────────────────────────────────────────────────────

google = oauth.register(
    name='google',
    client_id=os.getenv("CLIENT_ID"),
    client_secret=os.getenv("CLIENT_SECRET"),
    server_metadata_url='https://accounts.google.com/.well-known/openid-configuration',
    client_kwargs={'scope': 'openid email profile'}
)

@app.route("/wakeUp")
def wakeUp():
    return jsonify({"message": "Wake UP!!"}), 200

@app.route("/")
def home():
    return render_template("index.html", pricing=get_pricing_config())

@app.route('/privacy')
def privacy():
    return render_template("privacy.html")

@app.route('/sitemap.xml')
def static_from_root():
    return send_from_directory(app.static_folder, 'sitemap.xml')

@app.route("/api/user-count")
def user_count():
    count = db.session.query(User).count()  # adjust to your ORM
    return jsonify({"count": count})

# # ─── Self-ping (keep-alive for Render free tier) ──────────────────────────────
# # Prefer an external uptime monitor (e.g. UptimeRobot) over this thread.
# # If you upgrade to a paid Render plan, delete this block entirely.
# import threading
# import requests
# import time

# _stop_ping = threading.Event()

# def self_ping():
#     while not _stop_ping.wait(600):   # 10 minutes; stops cleanly on shutdown
#         try:
#             requests.get("https://kontexa.online/weakUp", timeout=10)
#             app.logger.info("Self-ping OK")
#         except Exception as e:
#             app.logger.warning(f"Self-ping failed: {e}")
 
# ping_thread = threading.Thread(target=self_ping, daemon=True)
# ping_thread.start()


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


# ─── Admin Dashboard ─────────────────────────────────────────────────────────────────
# 1. Change this string to whatever secret URL you want
@app.route('/CSGO_>_CS2') 
def admin_dashboard():
    # 2. Force the user to log in via Google first
    if 'user_email' not in session:
        return redirect(url_for('login'))
        
    # 3. REPLACE WITH YOUR ACTUAL EMAIL(S)
    ALLOWED_ADMIN_EMAILS = [
        "your_actual_email@gmail.com", 
        "another_admin@gmail.com"
    ]
    
    # 4. Block anyone who isn't you
    if session['user_email'] not in ALLOWED_ADMIN_EMAILS:
        return """
        <h1 style='color:red; text-align:center; margin-top:50px;'>
            Unauthorized Account
        </h1>
        <p style='text-align:center;'>Your email is not authorized to view this page.</p>
        """, 403

    # 5. Only if it is YOU, render the dashboard
    return render_template('admin.html')
@app.route('/api/admin/stats')
def admin_stats():
    if not _admin_token_required():
        return jsonify({"error": "Forbidden"}), 403
 
    try:
        total_users    = User.query.count()
        pro_users      = User.query.filter_by(is_pro=True).count()
        lifetime_users = User.query.filter_by(plan_type='lifetime').count()
        monthly_users  = User.query.filter_by(plan_type='monthly').count()
        free_users     = User.query.filter_by(plan_type='free').count()
        total_notes    = Note.query.count()
        total_websites = Website.query.count()
 
        expired_users = User.query.filter(
            User.plan_type == 'monthly',
            User.pro_expires_at != None,
            User.pro_expires_at < datetime.utcnow()
        ).count()

        db_size_mb  = None
        db_limit_mb = 512  # Neon/Supabase free tier is 512 MB — adjust if you upgrade
 
        try:
            result = db.session.execute(
                sa_text("SELECT pg_database_size(current_database()) AS size")
            ).fetchone()
            if result:
                db_size_mb = round(result.size / (1024 * 1024), 2)
        except Exception as db_err:
            app.logger.warning(f"Could not fetch DB size: {db_err}")
 
        db_days_left = None
        renewal_date_str = os.getenv("DB_RENEWAL_DATE")
        if renewal_date_str:
            try:
                renewal_date = datetime.strptime(renewal_date_str, "%Y-%m-%d")
                delta = renewal_date - datetime.utcnow()
                db_days_left = max(0, delta.days)
            except ValueError:
                pass  # Bad date format in env — ignore
 
        return jsonify({
            "total_users":    total_users,
            "pro_users":      pro_users,
            "lifetime_users": lifetime_users,
            "monthly_users":  monthly_users,
            "free_users":     free_users,
            "expired_users":  expired_users,
            "total_notes":    total_notes,
            "total_websites": total_websites,
            "db_size_mb":     db_size_mb,
            "db_limit_mb":    db_limit_mb,
            "db_days_left":   db_days_left,
        })
 
    except Exception as e:
        app.logger.error(f"admin_stats error: {e}")
        return jsonify({"error": "Internal server error"}), 500
 
 
@app.route('/api/admin/users')
def admin_users():
    if not _admin_token_required():
        return jsonify({"error": "Forbidden"}), 403
 
    try:
        users = User.query.order_by(User.id.desc()).all()
        return jsonify([{
            "id":            u.id,
            "email":         u.email,
            "is_pro":        u.is_pro,
            "plan_type":     u.plan_type,
            "pro_expires_at": u.pro_expires_at.isoformat() if u.pro_expires_at else None,
            "created_at":    u.created_at.isoformat() if u.created_at else None,
        } for u in users])
 
    except Exception as e:
        app.logger.error(f"admin_users error: {e}")
        return jsonify({"error": "Internal server error"}), 500
 
@app.route('/api/admin/pricing', methods=['POST'])
def admin_update_pricing():
    """Updates the pricing in the database."""
    if not _admin_token_required():
        return jsonify({"error": "Forbidden"}), 403

    data = request.get_json(silent=True)
    if not data or not data.get("plan_type"):
        return jsonify({"error": "Invalid request body. 'plan_type' is required."}), 400

    plan_type = data["plan_type"]
    
    try:
        plan = PricingConfig.query.filter_by(plan_type=plan_type).first()
        
        # FIX: If the row doesn't exist, create it using the correct DEFAULT base prices
        if not plan:
            def_usd = DEFAULT_PRICING.get(plan_type, {}).get("base_usd", 0)
            def_inr = DEFAULT_PRICING.get(plan_type, {}).get("base_inr_paise", 0)
            plan = PricingConfig(plan_type=plan_type, base_usd=def_usd, base_inr_paise=def_inr)
            db.session.add(plan)

        # Apply updates
        if 'base_usd' in data: plan.base_usd = data['base_usd']
        if 'base_inr_paise' in data: plan.base_inr_paise = data['base_inr_paise']
        
        # Null values (for 0% discounts) are allowed
        if 'discount_usd' in data: plan.discount_usd = data['discount_usd']
        if 'discount_inr_paise' in data: plan.discount_inr_paise = data['discount_inr_paise']
        if 'promo_badge' in data: plan.promo_badge = data['promo_badge']

        db.session.commit()
        return jsonify({"ok": True, "message": f"{plan_type} pricing updated successfully!"})

    except Exception as e:
        db.session.rollback()
        app.logger.error(f"admin_update_pricing error: {e}")
        return jsonify({"error": "Internal server error"}), 500
    
 
@app.route('/api/admin/users/<int:user_id>/access', methods=['PATCH'])
def admin_set_access(user_id):
    if not _admin_token_required():
        return jsonify({"error": "Forbidden"}), 403
 
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Invalid request body"}), 400
 
    user = db.session.get(User, user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404
 
    try:
        is_pro    = bool(data.get("is_pro", user.is_pro))
        plan_type = str(data.get("plan_type", user.plan_type))
 
        if plan_type not in ("free", "monthly", "lifetime"):
            return jsonify({"error": "Invalid plan_type"}), 400
 
        user.is_pro    = is_pro
        user.plan_type = plan_type
 
        if plan_type == "monthly" and is_pro:
            # Grant 30 days from now
            user.pro_expires_at = datetime.utcnow() + timedelta(days=30)
        elif plan_type in ("lifetime", "free"):
            user.pro_expires_at = None
 
        db.session.commit()
        app.logger.info(f"Admin updated user {user_id}: is_pro={is_pro}, plan={plan_type}")
 
        return jsonify({
            "ok": True,
            "user_id":    user.id,
            "is_pro":     user.is_pro,
            "plan_type":  user.plan_type,
        })
 
    except Exception as e:
        db.session.rollback()
        app.logger.error(f"admin_set_access error: {e}")
        return jsonify({"error": "Internal server error"}), 500



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
    user = User.query.filter_by(email=user_info['email']).first()

    if not user:
        total_users = User.query.count()
        if total_users < 100:
            user = User(
                email=user_info['email'], 
                is_pro=True, 
                plan_type='lifetime'
            )
            app.logger.info(f"Early Bird User Created! ({total_users + 1}/100): {user_info['email']}")
        else:
            user = User(
                email=user_info['email'], 
                is_pro=False, 
                plan_type='free'
            )
            
        db.session.add(user)
        db.session.commit()

    session['user_id']    = user.id
    session['user_email'] = user.email
    session.permanent     = True

    origin = session.pop("login_origin", "desktop")
    email  = user_info['email']  # Jinja2 auto-escapes in templates

    template = "auth_success_mobile.html" if origin == "mobile" else "auth_success_desktop.html"
    return render_template(template, email=email)

@app.route('/api/me')
def get_me():
    if 'user_id' not in session:
        return jsonify({"error": "Not logged in"}), 401
        
    user = db.session.get(User, session['user_id'])
    days_left = None
    if user.is_pro and user.plan_type == 'monthly' and user.pro_expires_at:
        if datetime.utcnow() > user.pro_expires_at:
            user.is_pro = False
            user.plan_type = 'free'
            db.session.commit()
        else:
            delta = user.pro_expires_at - datetime.utcnow()
            days_left = delta.days

    return jsonify({
        'email': session['user_email'], 
        'is_pro': user.is_pro,
        'plan_type': user.plan_type,
        'days_left': days_left
    })

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

    return render_template('pricing.html', email=user.email, razorpay_key_id=RAZORPAY_KEY_ID, pricing=get_pricing_config())

@app.route('/create-order', methods=['POST'])
def create_order():
    if 'user_id' not in session:
        return jsonify({"error": "Login required"}), 401
    user_id = session['user_id']
    data = request.json
    if not data:
        return jsonify({"error": "Invalid request"}), 400
    
    plan_type = data.get("plan_type")
    
    # FETCH DYNAMIC PRICING HERE
    current_pricing = get_pricing_config()
    plan_data = current_pricing.get(plan_type)
    
    if not plan_data:
        return jsonify({"error": "Invalid plan"}), 400

    # It is safer to check 'is not None' in case discount is exactly 0
    if plan_data["discount_inr_paise"] is not None:
        amount = plan_data["discount_inr_paise"]
    else:
        amount = plan_data["base_inr_paise"]
        
    currency = "INR"

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

        user = db.session.get(User, session_user_id)
        if user:
            plan_type = order["notes"].get("plan_type", "lifetime")
            user.is_pro = True
            
            if plan_type == "monthly":
                if user.plan_type == 'monthly' and user.pro_expires_at and user.pro_expires_at > datetime.utcnow():
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
    return """
    <div style="text-align:center;font-family:sans-serif;margin-top:50px;">
        <h1 style="color:#4f46e5;">Payment Successful! &#127881;</h1>
        <p>Your account has been upgraded to Kontexa Pro.</p>
        <p><b>Close this tab and click 'Account &rarr; Sync' in your extension to activate.</b></p>
    </div>"""


@app.route('/test/time-travel/<int:days_left>')
def time_travel(days_left):
    if 'user_id' not in session:
        return "Please log in first."
    
    user = db.session.get(User, session['user_id'])
    if not user:
        return "User not found."
    
    # Fast-forward time so the subscription expires in 'X' days
    user.pro_expires_at = datetime.utcnow() + timedelta(days=days_left)
    db.session.commit()
    
    return f"Time travel successful! Your account now expires in {days_left} days."


# ─── FeedBack ────────────────────────────────────────────────────────────────

@app.route('/api/feedback', methods=['POST'])
def submit_feedback():
    try:
        data    = request.get_json(silent=True) or {}
        
        fb_type = str(escape(data.get('type', 'feature')))
        subject = str(escape(data.get('subject', '')))
        message = str(escape(data.get('message', '')))

        if not message:
            return jsonify({'error': 'Message is required'}), 400

        email = None
        user_id = session.get('user_id')

        if user_id:
            user  = db.session.get(User, user_id)
            email = user.email if user else None

        feedback = Feedback(
            user_id = user_id,
            email   = email,
            fb_type = fb_type,
            subject = subject,
            message = message,
        )
        
        db.session.add(feedback)
        db.session.commit()
        return jsonify({'ok': True}), 201

    except Exception as e:
        # 3. FIX: Rollback the database if it crashes, otherwise your server locks up
        db.session.rollback()
        app.logger.error(f"Feedback error: {e}")
        return jsonify({'error': 'Internal Server Error'}), 500
    
@app.route('/api/admin/feedback-digest', methods=['GET'])
def feedback_digest():
    # Simple secret check — add ADMIN_SECRET to your Render env vars
    secret = request.args.get('secret')
    if secret != os.environ.get('ADMIN_SECRET'):
        return jsonify({'error': 'Unauthorized'}), 401

    one_week_ago = datetime.utcnow() - timedelta(days=7)
    rows = Feedback.query.filter(
        Feedback.created_at >= one_week_ago
    ).order_by(Feedback.created_at.desc()).all()

    return jsonify([{
        'id':         f.id,
        'email':      f.email or 'Anonymous',
        'type':       f.fb_type,
        'subject':    f.subject,
        'message':    f.message,
        'created_at': f.created_at.isoformat(),
    } for f in rows])


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
    
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    
    # Run DB init inside the app context so it doesn't 
    # block the server process from initializing
    with app.app_context():
        try:
            db.create_all()
            print("Database tables verified.")
        except Exception as e:
            print(f"Database connection skipped or failed: {e}")

    app.run(host='0.0.0.0', port=port)