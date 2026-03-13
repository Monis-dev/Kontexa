import os
import stripe
from flask import Flask, request, jsonify, session, redirect, url_for, render_template
from flask_sqlalchemy import SQLAlchemy
from urllib.parse import urlparse
from authlib.integrations.flask_client import OAuth
from flask_cors import CORS
from dotenv import load_dotenv
# from ai_agent import get_ai_answer, get_ai_summary

load_dotenv()
app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY", "prod_secret_123")

# DataBase
uri = os.getenv("DATABASE_URL", "sqlite:///local.db")
if uri.startswith("postgres://"): uri = uri.replace("postgres://", "postgresql://", 1)
app.config['SQLALCHEMY_DATABASE_URI'] = uri
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# Stripe
stripe.api_key = os.getenv("STRIPE_SECRET_KEY", "sk_test_123...")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "whsec_123...")
PRICE_MONTHLY_ID = os.getenv("STRIPE_PRICE_MONTHLY", "price_123...")
PRICE_LIFETIME_ID = os.getenv("STRIPE_PRICE_LIFETIME", "price_456...")


CORS(app, supports_credentials=True, resources={r"/*": {"origins": "*"}})

db = SQLAlchemy(app)
oauth = OAuth(app)

# --- Models ---
class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(120), unique=True, nullable=False)
    is_pro = db.Column(db.Boolean, default=False) # DEFAULT IS NOW FALSE (FREE TIER)
    websites = db.relationship('Website', backref='user', lazy=True)

class Website(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    url = db.Column(db.String(500), nullable=False)
    domain = db.Column(db.String(200))
    custom_name = db.Column(db.String(255), nullable=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    notes = db.relationship('Note', backref='website', lazy=True, cascade="all, delete-orphan")

class Note(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    local_id = db.Column(db.String(50), nullable=False)
    title = db.Column(db.String(255), nullable=False, default="Untitled")
    content = db.Column(db.Text, nullable=True)
    selection = db.Column(db.Text)
    pinned = db.Column(db.Boolean, default=False)
    image_data = db.Column(db.Text, nullable=True)
    timestamp = db.Column(db.String(20), nullable=True)
    folder = db.Column(db.String(100), nullable=True)
    website_id = db.Column(db.Integer, db.ForeignKey('website.id'), nullable=False)

with app.app_context(): db.create_all()

# --- Auth ---
google = oauth.register(
    name='google', client_id=os.getenv("CLIENT_ID"), client_secret=os.getenv("CLIENT_SECRET"),
    server_metadata_url='https://accounts.google.com/.well-known/openid-configuration',
    client_kwargs={'scope': 'openid email profile'}
)

@app.route("/login")
def login(): return google.authorize_redirect(url_for('authorize', _external=True))

@app.route('/authorize')
def authorize():
    token = google.authorize_access_token()
    user_info = token.get('userinfo')
    user = User.query.filter_by(email=user_info['email']).first()
    if not user:
        # Create user as FREE tier by default
        user = User(email=user_info['email'], is_pro=False) 
        db.session.add(user)
        db.session.commit()
    session['user_id'] = user.id
    session['user_email'] = user.email
    session.permanent = True
    return """<html><body><h2 style="text-align:center;margin-top:50px;">Logged in! ✅<br>Close this tab.</h2><script>setTimeout(()=>window.close(),2000);</script></body></html>"""

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

# --- PAYMENT SIMULATION (For Testing) ---
# @app.route('/api/upgrade', methods=['POST'])
# def upgrade_user():
#     if 'user_id' not in session: return jsonify({"error": "Login required"}), 401
#     user = db.session.get(User, session['user_id'])
#     user.is_pro = True
#     db.session.commit()
#     return jsonify({"message": "Upgraded to Pro"}), 200

# --- TESTING ROUTE: REVOKE PRO STATUS ---
@app.route("/revoke")
def revoke():
    if 'user_id' not in session: 
        return jsonify({"error": "Login required. Please open your extension dashboard first."}), 401
        
    user = db.session.get(User, session['user_id'])
    
    if user:
        user.is_pro = False
        db.session.commit()
        return """
        <html>
            <body style="font-family:sans-serif; text-align:center; margin-top:50px;">
                <h2 style="color:#e11d48;">Access Revoked ❌</h2>
                <p>Your account (<b>{}</b>) is now on the Free Tier.</p>
                <p>Close this tab and reload your extension dashboard to test.</p>
                <script>setTimeout(()=>window.close(), 3000);</script>
            </body>
        </html>
        """.format(user.email)
        
    return jsonify({"error": "User not found"}), 404

@app.route("/grant")
def grant():
    if 'user_id' not in session: 
        return jsonify({"error": "Login required. Please open your extension dashboard first."}), 401
        
    user = db.session.get(User, session['user_id'])
    
    if user:
        user.is_pro = True
        db.session.commit()
        return """
        <html>
            <body style="font-family:sans-serif; text-align:center; margin-top:50px;">
                <h2 style="color:#e11d48;">Access Granted</h2>
                <p>Your account (<b>{}</b>) is now on the Pro Tier.</p>
                <p>Close this tab and reload your extension dashboard to test.</p>
                <script>setTimeout(()=>window.close(), 3000);</script>
            </body>
        </html>
        """.format(user.email)
        
    return jsonify({"error": "User not found"}), 404

# --- PRICING PAGE ---
@app.route('/pricing')
def pricing():
    # Force login if they somehow landed here logged out
    if 'user_id' not in session:
        return redirect(url_for('login'))
    
    user = db.session.get(User, session['user_id'])
    
    # If they are already Pro, don't let them buy it again!
    if user.is_pro:
        return "<h2>You are already a Pro user! 🎉 Close this tab and enjoy the extension.</h2>"
        
    # DO NOT set is_pro = True here! That is what the webhook is for!
    return render_template('pricing.html', email=user.email)

# --- CREATE CHECKOUT SESSION ---
@app.route('/create-checkout-session', methods=['POST'])
def create_checkout_session():
    print("--- CHECKOUT BUTTON CLICKED ---")
    
    if 'user_id' not in session:
        print("Error: User not logged in.")
        return redirect(url_for('login'))

    user_id = session['user_id']
    user_email = session['user_email']
    plan_type = request.form.get('plan_type')

    print(f"User Email: {user_email} | Plan Selected: {plan_type}")

    # Fetching securely from your .env file
    price_id = os.getenv("STRIPE_PRICE_LIFETIME")
    mode = 'payment'

    print(f"Using Price ID: {price_id}")

    try:
        checkout_session = stripe.checkout.Session.create(
            customer_email=user_email,
            client_reference_id=str(user_id), # Crucial for the webhook
            payment_method_types=['card'],
            line_items=[{'price': price_id, 'quantity': 1}],
            mode=mode,
            success_url=request.host_url + 'success',
            cancel_url=request.host_url + 'pricing',
        )
        print("Stripe Session Created! Redirecting...")
        return redirect(checkout_session.url, code=303)
    
    except Exception as e:
        print(f"STRIPE ERROR: {str(e)}")
        return f"""
        <div style="font-family: sans-serif; padding: 40px; text-align: center;">
            <h2 style="color: red;">Stripe Error</h2>
            <p><b>{str(e)}</b></p>
            <p>Check your Flask terminal for more details.</p>
            <a href="/pricing">Go Back</a>
        </div>
        """, 400

# --- SUCCESS PAGE ---
@app.route('/success')
def success():
    return """
    <div style="text-align:center; font-family:sans-serif; margin-top:50px;">
        <h1 style="color:#4f46e5;">Payment Successful! 🎉</h1>
        <p>Your account has been upgraded to ContextNote Pro.</p>
        <p><b>Please close this tab and click 'Account' -> 'Sync' in your extension to activate your features!</b></p>
    </div>
    """

# --- STRIPE WEBHOOK (THE MAGIC GATEKEEPER) ---
@app.route('/webhook', methods=['POST'])
def webhook():
    payload = request.data
    sig_header = request.headers.get('Stripe-Signature')

    try:
        event = stripe.Webhook.construct_event(payload, sig_header, STRIPE_WEBHOOK_SECRET)
    except ValueError as e:
        return 'Invalid payload', 400
    except stripe.error.SignatureVerificationError as e:
        return 'Invalid signature', 400

    # Handle the checkout.session.completed event
    if event['type'] == 'checkout.session.completed':
        session_data = event['data']['object']
        
        # Grab the user_id we passed in client_reference_id
        user_id = session_data.get('client_reference_id')
        print(f"WEBHOOK RECEIVED: Payment successful for User ID: {user_id}")
        if user_id:
            user = db.session.get(User, int(user_id))
            if user:
                user.is_pro = True # UPGRADE THE USER!
                db.session.commit()
                print(f"Successfully upgraded user {user.email}")

    # If subscription is canceled or fails later, downgrade them
    elif event['type'] in ['customer.subscription.deleted', 'invoice.payment_failed']:
        # Note: Handling subscription deletion requires mapping Stripe Customer ID to your User table.
        # For MVP, just getting them upgraded is the priority!
        pass

    return '', 200

# --- Sync (Pro Only Gate) ---
@app.route('/api/sync', methods=['POST'])
def sync_notes():
    if 'user_id' not in session: return jsonify({"error": "Login required"}), 401
    
    user = db.session.get(User, session['user_id'])
    if not user.is_pro: return jsonify({"error": "Pro upgrade required"}), 403

    for note in request.json:
        local_id = str(note.get('id'))
        existing = Note.query.join(Website).filter(Website.user_id == user.id, Note.local_id == local_id).first()
        if existing: continue
        
        site = Website.query.filter_by(url=note['url'], user_id=user.id).first()
        if not site:
            site = Website(url=note['url'], domain=note.get('domain', urlparse(note['url']).netloc), user_id=user.id)
            db.session.add(site)
            db.session.commit()
            
        db.session.add(Note(
            local_id=local_id, 
            title=note.get('title', 'Untitled'), 
            content=note.get('content', ''), 
            selection=note.get('selection', ''), 
            pinned=note.get('pinned', False),
            timestamp=note.get('timestamp', ''),
            image_data=note.get('image_data', ''),
            folder=note.get('folder', ''),
            website_id=site.id
        ))
    db.session.commit()
    return jsonify({"message": "Sync complete"}), 200

@app.route('/api/notes', methods=['GET'])
def get_notes():
    if 'user_id' not in session: return jsonify([]), 401
    user = db.session.get(User, session['user_id'])
    
    # If they aren't pro, we shouldn't even send them data (Double security)
    if not user.is_pro: return jsonify([]), 403 

    websites = Website.query.filter_by(user_id=user.id).all()
    result = []
    for s in websites:
        result.append({
            "domain": s.domain, "url": s.url, "custom_name": s.custom_name,
            "notes": [{
                "id": n.local_id, "title": n.title, "content": n.content, 
                "selection": n.selection, "pinned": n.pinned,
                "timestamp": n.timestamp, "folder":n.folder,"image_data": n.image_data
            } for n in s.notes]
        })
    return jsonify(result)

@app.route('/api/notes/<string:local_id>', methods=['PUT'])
def update_note(local_id):
    if 'user_id' not in session: 
        return jsonify({"error": "Login required"}), 401
    
    # 1. Fetch note
    note = Note.query.join(Website).filter(
        Website.user_id == session['user_id'], 
        Note.local_id == local_id
    ).first()
    
    if not note: 
        return jsonify({"error": "Note not found"}), 404
    
    # 2. Get data safely
    data = request.json
    
    # 3. Update fields (this avoids the dictionary syntax error)
    if 'title' in data:
        note.title = data['title']
    if 'content' in data:
        note.content = data['content']
    if 'pinned' in data:
        note.pinned = data['pinned'] # This is now safe
    if 'folder' in data:
        note.folder = data['folder']
        
    db.session.commit()
    return jsonify({"message": "Updated successfully"})

@app.route('/api/notes/<string:local_id>', methods=['DELETE'])
def delete_note(local_id):
    if 'user_id' not in session: return jsonify({"error": "Login required"}), 401
    
    # 1. Look for the note that belongs to this user AND matches the local_id string
    note = Note.query.join(Website).filter(
        Website.user_id == session['user_id'], 
        Note.local_id == local_id
    ).first()
    
    if note:
        db.session.delete(note)
        db.session.commit()
        return '', 204
        
    return jsonify({"error": "Note not found or Unauthorized"}), 404

@app.route('/api/websites/rename', methods=['PUT'])
def rename_website():
    if 'user_id' not in session: return jsonify({"error": "Login required"}), 401
    
    data = request.json
    url = data.get('url')
    custom_name = data.get('custom_name')
    
    # Find the website associated with this user and URL
    site = Website.query.filter_by(url=url, user_id=session['user_id']).first()
    
    if site:
        site.custom_name = custom_name
        db.session.commit()
        return jsonify({"message": "Renamed successfully"})
        
    return jsonify({"error": "Website not found"}), 404

if __name__ == '__main__': app.run(debug=True, port=5000)