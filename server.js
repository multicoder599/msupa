require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const axios = require('axios');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

/* =========================
   RESEND (OPTIONAL — won't crash if react/react-dom missing)
   ========================= */
let resend = null;
try {
  const { Resend } = require('resend');
  if (process.env.RESEND_API_KEY && !process.env.RESEND_API_KEY.includes('xxxx')) {
    resend = new Resend(process.env.RESEND_API_KEY);
    console.log('[EMAIL] Resend loaded successfully');
  } else {
    console.warn('[EMAIL] RESEND_API_KEY not set. Emails disabled.');
  }
} catch (err) {
  console.warn('[EMAIL] Resend failed to load. Run: npm install react react-dom');
  console.warn('[EMAIL] Error:', err.message);
}

/* =========================
   STARTUP VALIDATION
   ========================= */
if (!process.env.MONGO_URI) {
  console.error('FATAL: MONGO_URI is not defined in .env');
  process.exit(1);
}
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.includes('CHANGE_THIS')) {
  console.warn('WARNING: JWT_SECRET is using the default placeholder. Update it in production.');
}

/* =========================
   DATABASE CONNECTION
   ========================= */
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
    });
    console.log(`MongoDB Atlas Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`MongoDB Atlas Error: ${error.message}`);
    setTimeout(() => process.exit(1), 3000);
  }
};
connectDB();

/* =========================
   CONSTANTS & HELPERS
   ========================= */
const PORT = process.env.PORT || 3032;
const JWT_SECRET = process.env.JWT_SECRET;
const MEGAPAY_API_KEY = process.env.MEGAPAY_API_KEY;
const MEGAPAY_EMAIL = process.env.MEGAPAY_EMAIL;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const MPESA_CALLBACK_URL = process.env.MPESA_CALLBACK_URL || `${BASE_URL}/api/webhook/megapay`;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Msupa@2026';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;
const PLATFORM_FEE_PERCENT = parseFloat(process.env.PLATFORM_FEE_PERCENT || '20');
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Webhook logging
const webhookLogPath = path.join(__dirname, 'webhook.log');
function logWebhook(msg, data) {
    const line = `[${new Date().toISOString()}] ${msg} | ${JSON.stringify(data)}\n`;
    fs.appendFileSync(webhookLogPath, line);
    console.log(`[WEBHOOK] ${msg}`, data);
}

function formatPhoneMegaPay(phone) {
    let fp = phone.replace(/\D/g, '');
    if (fp.startsWith('0')) fp = '254' + fp.slice(1);
    else if (/^[71]/.test(fp) && fp.length === 10) fp = '254' + fp;
    else if (!fp.startsWith('254') && !fp.startsWith('237')) fp = '254' + fp;
    return fp;
}

async function notifyTelegram(message) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'HTML'
        });
        console.log('[TELEGRAM] Notification sent');
    } catch (e) { console.error('[TELEGRAM] Notify failed:', e.message); }
}

/* =========================
   MODELS
   ========================= */
const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  registrationDate: { type: Date, default: Date.now },
  amountSpent: { type: Number, default: 0 },
  bio: { type: String, default: '' },
  profilePic: { type: String, default: '' },
  phone: { type: String, default: '' },
  location: { type: String, default: '' },
  age: { type: Number, default: 0 },
  visibility: { type: String, enum: ['public', 'live'], default: 'public' },
  tier: { type: String, enum: ['free', 'matches_unlocked', 'sugar_unlocked', 'premium_unlocked'], default: 'free' },
  resetPasswordToken: { type: String, default: null },
  resetPasswordExpires: { type: Date, default: null }
}, { timestamps: true });

const listingSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  name: { type: String, required: true },
  age: { type: Number, required: true },
  location: { type: String, required: true },
  loc: { type: String, trim: true },
  img: { type: String, required: true },
  image: { type: String, default: '' },
  reason: { type: String, enum: ['hookup', 'friendship', 'companionship'], required: true },
  bio: { type: String, default: '' },
  desc: { type: String, default: '' },
  budget: { type: String, default: '' },
  verified: { type: Boolean, default: false },
  isVerified: { type: Boolean, default: false },
  category: { type: String, enum: ['match', 'sugar_mummy', 'sugar_daddy', 'premium'], required: true },
  isActive: { type: Boolean, default: true },
  active: { type: Boolean, default: true },
  views: { type: Number, default: 0 },
  isOnline: { type: Boolean, default: false },
  isPremium: { type: Boolean, default: false },
  gender: { type: String, enum: ['Male', 'Female'], default: 'Female' },
  price: { type: Number, default: 199 },
  phone: { type: String, default: '' },
  hair: { type: String, default: '' },
  faceCard: { type: String, default: '' },
  skinTone: { type: String, default: '' },
  bodyType: { type: String, default: '' },
  breast: { type: String, default: '' },
  waist: { type: String, default: '' },
  thighs: { type: String, default: '' },
  butt: { type: String, default: '' },
  piercings: { type: String, default: '' },
  tattoos: { type: String, default: '' },
  tag: { type: String, default: 'Dating' },
  unlocked: { type: Number, default: 0 },
  unlocks: { type: Number, default: 0 },
  totalEarned: { type: Number, default: 0 },
  status: { type: String, enum: ['pending', 'verified', 'rejected'], default: 'verified' },
  county: { type: String, default: '' }
}, { timestamps: true });

const messageSchema = new mongoose.Schema({
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  receiverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, required: true },
  read: { type: Boolean, default: false }
}, { timestamps: true });

const videoSchema = new mongoose.Schema({
  title: { type: String, required: true },
  thumbnail: { type: String, required: true },
  url: { type: String, required: true },
  duration: { type: String, default: '0:00' },
  views: { type: Number, default: 0 },
  uploaderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  isPremium: { type: Boolean, default: true }
}, { timestamps: true });

const paymentSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  type: { type: String, enum: ['matches', 'sugar', 'premium', 'live', 'video_basic', 'video_premium', 'video_vip', 'profile_unlock', 'deposit'], required: true },
  amount: { type: Number, required: true },
  status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
  mpesaRef: { type: String, default: '' },
  phone: { type: String, default: '' },
  description: { type: String, default: '' },
  profileId: { type: String, default: '' },
  profileName: { type: String, default: '' }
}, { timestamps: true });

const depositSchema = new mongoose.Schema({
  refId: { type: String, required: true, unique: true },
  userPhone: { type: String, required: true },
  amount: { type: Number, required: true },
  description: { type: String, default: '' },
  profileId: { type: String, default: '' },
  profileName: { type: String, default: '' },
  status: { type: String, enum: ['pending', 'success', 'failed', 'cancelled'], default: 'pending' },
  mpesaRef: { type: String, default: '' },
  resultDesc: { type: String, default: '' },
  platformFee: { type: Number, default: 0 },
  profileEarnings: { type: Number, default: 0 },
  checkoutRequestId: { type: String, default: '' },
  merchantRequestId: { type: String, default: '' },
  callbackData: { type: Object, default: {} },
  type: { type: String, enum: ['unlock', 'listing'], default: 'unlock' }
}, { timestamps: true });

const settingsSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed }
});

const User = mongoose.model('User', userSchema);
const Listing = mongoose.model('Listing', listingSchema);
const Message = mongoose.model('Message', messageSchema);
const Video = mongoose.model('Video', videoSchema);
const Payment = mongoose.model('Payment', paymentSchema);
const Deposit = mongoose.model('Deposit', depositSchema);
const Settings = mongoose.model('Settings', settingsSchema);

/* =========================
   APP SETUP
   ========================= */
const app = express();
app.set('trust proxy', 1);

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'https://msupachat.com,https://www.msupachat.com,https://*.msupachat.pages.dev,http://localhost:3000,http://localhost:5500').split(',');
app.use(cors({
  origin: function(origin, callback) {
    if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false, crossOriginResourcePolicy: false }));
app.use(mongoSanitize());

// RAW BODY for webhooks BEFORE JSON parser
app.use('/api/webhook/megapay', express.raw({ type: '*/*', limit: '1mb' }));
app.use('/api/webhook/megapay', (req, res, next) => {
    logWebhook('RAW_HIT', { method: req.method, ip: req.ip, headers: req.headers });
    try { req.body = JSON.parse(req.body); } catch (e) { req.body = req.body ? req.body.toString() : {}; }
    next();
});

app.use('/api/megapay/webhook', express.raw({ type: '*/*', limit: '1mb' }));
app.use('/api/megapay/webhook', (req, res, next) => {
    logWebhook('RAW_HIT_ALT', { method: req.method, ip: req.ip });
    try { req.body = JSON.parse(req.body); } catch (e) { req.body = req.body ? req.body.toString() : {}; }
    next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false, validate: false });
app.use('/api/', limiter);
const strictLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, validate: false });
app.use('/api/admin/login', strictLimiter);
app.use('/api/auth/login', strictLimiter);
app.use('/api/auth/register', strictLimiter);

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, unique + path.extname(file.originalname));
    }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

app.use('/uploads', express.static(uploadDir));

const generateToken = (id) => jwt.sign({ id }, JWT_SECRET, { expiresIn: '30d' });

/* =========================
   MIDDLEWARE
   ========================= */
const protect = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'Not authorized, no token' });
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = await User.findById(decoded.id).select('-password');
    if (!req.user) return res.status(401).json({ message: 'User not found' });
    next();
  } catch (error) { res.status(401).json({ message: 'Not authorized, invalid token' }); }
};

const adminProtect = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'Not authorized' });
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');
    if (!user || user.role !== 'admin') return res.status(403).json({ message: 'Admin access required' });
    req.user = user; next();
  } catch (error) { res.status(401).json({ message: 'Not authorized' }); }
};

function verifyAdmin(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ success: false, message: 'Unauthorized' });
    try {
        const decoded = jwt.verify(auth.split(' ')[1], JWT_SECRET);
        if (decoded.role !== 'admin') return res.status(403).json({ success: false, message: 'Admin only' });
        req.admin = decoded; next();
    } catch (e) { return res.status(401).json({ success: false, message: 'Invalid token' }); }
}

/* =========================
   WEBHOOK PROCESSING
   ========================= */
async function processWebhook(data) {
    try {
        data = data || {};
        logWebhook('PROCESSING', data);
        const responseCode = data.ResponseCode !== undefined ? data.ResponseCode : data.ResultCode;
        const ref = data.reference || data.BillRefNumber || data.refId || data.Reference || data.TransactionReference || '';
        const receipt = data.TransactionReceipt || data.MpesaReceiptNumber || data.receipt || data.transID || data.ReceiptNo || data.TransactionID || '';
        logWebhook('PARSED', { responseCode, ref, receipt });

        if (responseCode != 0 && responseCode !== '0') {
            if (ref) { await Deposit.findOneAndUpdate({ refId: ref }, { status: 'failed', callbackData: data }); logWebhook('MARKED_FAILED', { ref, responseCode }); }
            return;
        }
        if (!receipt || !ref) { logWebhook('MISSING_DATA', { receipt, ref, fullData: data }); return; }

        const tx = await Deposit.findOne({ refId: ref, status: 'pending' });
        if (!tx) { logWebhook('TX_NOT_FOUND', { ref }); return; }

        tx.status = 'success'; tx.mpesaRef = receipt; tx.callbackData = data; await tx.save();
        logWebhook('TX_SUCCESS', { ref, receipt, amount: tx.amount });

        const notifyMsg = `🔥 <b>New Msupa Payment</b>\n\n💰 Amount: KES ${tx.amount}\n📱 Customer: ${tx.userPhone}\n🏷️ Category: ${tx.profileName || tx.description || 'Plan/Unlock'}\n🆔 Ref: ${tx.refId}\n⏰ ${new Date().toLocaleString('en-KE')}`;
        await notifyTelegram(notifyMsg);

        if (tx.profileId && mongoose.Types.ObjectId.isValid(tx.profileId)) {
            const platformFee = Math.floor(tx.amount * PLATFORM_FEE_PERCENT / 100);
            const earnings = tx.amount - platformFee;
            tx.platformFee = platformFee; tx.profileEarnings = earnings; await tx.save();
            await Listing.findByIdAndUpdate(tx.profileId, { $inc: { unlocks: 1, totalEarned: earnings } });
            logWebhook('PROFILE_CREDITED', { profileId: tx.profileId, earnings });
        }
        await Payment.create({ type: 'deposit', amount: tx.amount, status: 'completed', mpesaRef: receipt, phone: tx.userPhone, description: tx.description, profileId: tx.profileId, profileName: tx.profileName });
    } catch (err) { logWebhook('WEBHOOK_ERROR', { error: err.message }); console.error('Webhook error:', err.message); }
}

/* =========================
   ROOT / HEALTH
   ========================= */
app.get('/', (req, res) => {
  res.json({ name: 'MsupaChat API', version: '3.1.0', status: 'running', timestamp: new Date().toISOString() });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString(), version: '3.1.0' });
});

/* =========================
   SETTINGS
   ========================= */
app.get('/api/settings', async (req, res) => {
    try { const s = await Settings.findOne({ key: 'demoMode' }); res.json({ success: true, demoMode: s ? s.value : true }); }
    catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/admin/settings', verifyAdmin, async (req, res) => {
    try { const { demoMode } = req.body; await Settings.findOneAndUpdate({ key: 'demoMode' }, { key: 'demoMode', value: demoMode !== false }, { upsert: true }); res.json({ success: true }); }
    catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

/* =========================
   AUTH ROUTES
   ========================= */
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ message: 'Please provide all fields' });
    if (password.length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters' });
    const userExists = await User.findOne({ email });
    if (userExists) return res.status(400).json({ message: 'User already exists' });
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const user = await User.create({ name, email, password: hashedPassword });
    if (resend) {
      try {
        await resend.emails.send({ from: process.env.EMAIL_FROM || 'onboarding@resend.dev', to: email, subject: 'Welcome to MsupaChat', html: `<h1>Welcome ${name}!</h1><p>Your account has been created successfully.</p>` });
      } catch (e) { console.log('Email send failed:', e.message); }
    }
    res.status(201).json({ _id: user._id, name: user.name, email: user.email, role: user.role, tier: user.tier, visibility: user.visibility, amountSpent: user.amountSpent, bio: user.bio, registrationDate: user.registrationDate, token: generateToken(user._id) });
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (user && (await bcrypt.compare(password, user.password))) {
      res.json({ _id: user._id, name: user.name, email: user.email, role: user.role, tier: user.tier, visibility: user.visibility, amountSpent: user.amountSpent, bio: user.bio, profilePic: user.profilePic, registrationDate: user.registrationDate, token: generateToken(user._id) });
    } else { res.status(401).json({ message: 'Invalid email or password' }); }
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: 'User not found' });
    const resetToken = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '1h' });
    user.resetPasswordToken = resetToken; user.resetPasswordExpires = Date.now() + 3600000; await user.save();
    const resetUrl = `${process.env.FRONTEND_URL || 'https://msupachat.com'}/reset-password?token=${resetToken}`;
    if (resend) {
      try { await resend.emails.send({ from: process.env.EMAIL_FROM || 'onboarding@resend.dev', to: email, subject: 'MsupaChat Password Reset', html: `<h1>Password Reset</h1><p>Click <a href="${resetUrl}">here</a> to reset.</p>` }); }
      catch (e) { console.log('Email send failed:', e.message); }
    }
    res.json({ message: 'Reset email sent' });
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!password || password.length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters' });
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user || user.resetPasswordToken !== token || user.resetPasswordExpires < Date.now()) return res.status(400).json({ message: 'Invalid or expired token' });
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(password, salt); user.resetPasswordToken = null; user.resetPasswordExpires = null; await user.save();
    res.json({ message: 'Password updated successfully' });
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/auth/validate', protect, async (req, res) => {
  try { res.json(req.user); } catch (error) { res.status(401).json({ message: 'Invalid token' }); }
});

/* =========================
   USER PROFILE ROUTES
   ========================= */
app.get('/api/users/me', protect, async (req, res) => {
  try { const user = await User.findById(req.user._id).select('-password'); res.json(user); }
  catch (error) { res.status(500).json({ message: error.message }); }
});

app.patch('/api/users/me', protect, async (req, res) => {
  try {
    const { bio, name, phone, location, age, profilePic } = req.body;
    const updates = {};
    if (bio !== undefined) updates.bio = bio; if (name !== undefined) updates.name = name;
    if (phone !== undefined) updates.phone = phone; if (location !== undefined) updates.location = location;
    if (age !== undefined) updates.age = age; if (profilePic !== undefined) updates.profilePic = profilePic;
    const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true }).select('-password');
    res.json(user);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/users/:id', protect, async (req, res) => {
  try { const user = await User.findById(req.params.id).select('-password'); if (!user) return res.status(404).json({ message: 'User not found' }); res.json(user); }
  catch (error) { res.status(500).json({ message: error.message }); }
});

/* =========================
   PROFILE / LISTING ROUTES
   ========================= */
app.get('/api/profiles', async (req, res) => {
  try {
    const { category, limit = 100, page = 1, gender } = req.query;
    const filter = { isActive: true, status: 'verified' };
    if (category) filter.category = category; if (gender) filter.gender = gender;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const listings = await Listing.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit));
    const total = await Listing.countDocuments(filter);
    res.json({ profiles: listings, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/listings', async (req, res) => {
  try {
    const { category, limit = 20, page = 1, gender } = req.query;
    const filter = { isActive: true, status: 'verified' };
    if (category) filter.category = category; if (gender) filter.gender = gender;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const listings = await Listing.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit));
    const total = await Listing.countDocuments(filter);
    res.json({ listings, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/listings/:id', async (req, res) => {
  try { const listing = await Listing.findById(req.params.id); if (!listing) return res.status(404).json({ message: 'Listing not found' }); listing.views += 1; await listing.save(); res.json(listing); }
  catch (error) { res.status(500).json({ message: error.message }); }
});

app.post('/api/listings', protect, async (req, res) => {
  try {
    const { name, age, location, img, reason, bio, budget, category, gender, price, phone, hair, faceCard, skinTone, bodyType, breast, waist, thighs, butt, piercings, tattoos, tag } = req.body;
    if (!name || !age || !location || !img || !reason || !category) return res.status(400).json({ message: 'Please provide all required fields' });
    const listing = await Listing.create({ userId: req.user._id, name, age, location, loc: location, img, image: img, reason, bio, desc: bio, budget, category, gender: gender || 'Female', price: price || 199, phone: phone || '', hair, faceCard, skinTone, bodyType, breast, waist, thighs, butt, piercings, tattoos, tag, status: 'verified', isVerified: true });
    res.status(201).json(listing);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.patch('/api/listings/:id', protect, async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id);
    if (!listing) return res.status(404).json({ message: 'Listing not found' });
    if (listing.userId?.toString() !== req.user._id.toString() && req.user.role !== 'admin') return res.status(403).json({ message: 'Not authorized' });
    const updates = req.body;
    Object.keys(updates).forEach(key => { if (updates[key] !== undefined) listing[key] = updates[key]; });
    if (updates.location) listing.loc = updates.location; if (updates.bio) listing.desc = updates.bio; if (updates.img) listing.image = updates.img;
    await listing.save(); res.json(listing);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.delete('/api/listings/:id', protect, async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id);
    if (!listing) return res.status(404).json({ message: 'Listing not found' });
    if (listing.userId?.toString() !== req.user._id.toString() && req.user.role !== 'admin') return res.status(403).json({ message: 'Not authorized' });
    await Listing.findByIdAndDelete(req.params.id); res.json({ message: 'Listing deleted' });
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.post('/api/apply', upload.single('photo'), async (req, res) => {
    try {
        const { name, age, location, gender, phone, bio, price, hair, faceCard, skinTone, bodyType, breast, waist, thighs, butt, piercings, tattoos } = req.body;
        if (!name || !phone) return res.status(400).json({ success: false, message: 'Name and phone required' });
        const existing = await Listing.findOne({ phone: phone.trim() });
        if (existing) return res.status(409).json({ success: false, message: 'Phone already registered' });
        const img = req.file ? `/uploads/${req.file.filename}` : '';
        const listing = new Listing({ name: name.trim(), age: parseInt(age) || 21, location: location || 'Nairobi', loc: location || 'Nairobi', bio: bio || '', desc: bio || '', phone: phone.trim(), gender: gender || 'Female', price: parseInt(price) || 199, img, image: img, status: 'pending', isVerified: false, hair, faceCard, skinTone, bodyType, breast, waist, thighs, butt, piercings, tattoos });
        await listing.save();
        res.json({ success: true, message: 'Application submitted. Await admin approval.', profileId: listing._id });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

/* =========================
   MEGAPAY DEPOSIT (AfroLink style)
   ========================= */
app.post('/api/deposit', async (req, res) => {
    try {
        const { userPhone, amount, description, profileId, profileName } = req.body;
        if (!userPhone || !amount || amount < 10) return res.status(400).json({ success: false, message: 'Phone and amount required' });
        const refId = 'MS' + Date.now() + Math.floor(Math.random() * 1000);
        let validProfileId = null;
        if (profileId && mongoose.Types.ObjectId.isValid(profileId)) validProfileId = profileId;
        const tx = new Deposit({ userPhone: userPhone.trim(), profileId: validProfileId, profileName: profileName || '', amount: parseInt(amount), status: 'pending', refId, description: description || 'MsupaChat Payment', type: validProfileId ? 'unlock' : 'listing' });
        await tx.save();

        if (!MEGAPAY_API_KEY || !MEGAPAY_EMAIL) {
            tx.status = 'success'; tx.mpesaRef = 'DEMO' + Date.now(); await tx.save();
            return res.json({ success: true, refId, message: 'Demo mode: Payment auto-resolved' });
        }
        const fp = formatPhoneMegaPay(userPhone);
        const payload = { api_key: MEGAPAY_API_KEY, email: MEGAPAY_EMAIL, amount: parseInt(amount), msisdn: fp, callback_url: MPESA_CALLBACK_URL, description: tx.description, reference: refId };
        console.log('[DEPOSIT] Sending to Megapay:', { refId, amount, msisdn: fp });
        try {
            const mpRes = await axios.post('https://megapay.co.ke/backend/v1/initiatestk', payload, { headers: { 'Content-Type': 'application/json' }, timeout: 15000 });
            const mpData = mpRes.data;
            console.log('[DEPOSIT] Megapay response:', mpData);
            if (mpData.CheckoutRequestID) { tx.checkoutRequestId = mpData.CheckoutRequestID; await tx.save(); }
            if (mpData.MerchantRequestID) { tx.merchantRequestId = mpData.MerchantRequestID; await tx.save(); }
            if (mpData && (mpData.status === false || mpData.success === false || mpData.ResponseCode === '1')) {
                tx.status = 'failed'; await tx.save();
                return res.status(400).json({ success: false, message: mpData.errorMessage || mpData.message || 'Payment failed' });
            }
            res.json({ success: true, refId, message: 'STK push sent to your phone.' });
        } catch (mpErr) {
            console.error('[DEPOSIT] Megapay error:', mpErr.message, mpErr.response?.data);
            tx.status = 'failed'; await tx.save();
            return res.status(502).json({ success: false, message: 'Payment gateway failed' });
        }
    } catch (e) {
        console.error('[DEPOSIT] Server error:', e);
        res.status(500).json({ success: false, message: e.message || 'Payment service error' });
    }
});

app.get('/api/mpesa/status/:refId', async (req, res) => {
    try {
        const tx = await Deposit.findOne({ refId: req.params.refId });
        if (!tx) return res.status(404).json({ success: false, message: 'Not found' });
        res.json({ status: tx.status, tx, message: tx.resultDesc || 'Pending' });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/deposit/check-status', async (req, res) => {
    try {
        const { refId } = req.body;
        if (!refId) return res.status(400).json({ success: false, message: 'refId required' });
        const tx = await Deposit.findOne({ refId });
        if (!tx) return res.status(404).json({ success: false, message: 'Transaction not found' });
        res.json({ success: true, status: tx.status, tx });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/simulate-webhook', async (req, res) => {
    try {
        const { refId, resultCode = '0', receipt = 'SIM' + Date.now() } = req.body;
        if (!refId) return res.status(400).json({ success: false, message: 'refId required' });
        await processWebhook({ reference: refId, ResponseCode: resultCode, TransactionReceipt: receipt });
        res.json({ success: true, message: 'Webhook simulated' });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

/* =========================
   WEBHOOK ENDPOINTS
   ========================= */
app.post('/api/webhook/megapay', async (req, res) => { res.status(200).send('OK'); logWebhook('PRIMARY_POST', { body: req.body, ip: req.ip }); await processWebhook(req.body); });
app.get('/api/webhook/megapay', (req, res) => { logWebhook('PRIMARY_GET', { query: req.query, ip: req.ip }); res.status(200).send('Webhook endpoint is live. Use POST for callbacks.'); });
app.post('/api/megapay/webhook', async (req, res) => { res.status(200).send('OK'); logWebhook('FALLBACK_POST', { body: req.body, ip: req.ip }); await processWebhook(req.body); });
app.get('/api/megapay/webhook', (req, res) => { logWebhook('FALLBACK_GET', { query: req.query, ip: req.ip }); res.status(200).send('Webhook fallback is live.'); });

app.post('/api/mpesa/callback', async (req, res) => {
    try {
        const { Body, reference, status, transaction_id, ResultCode, ResultDesc } = req.body;
        let checkoutId, resultCode, resultDesc;
        if (Body && Body.stkCallback) { checkoutId = Body.stkCallback.CheckoutRequestID; resultCode = Body.stkCallback.ResultCode; resultDesc = Body.stkCallback.ResultDesc; }
        else if (reference || transaction_id) { checkoutId = reference || transaction_id; resultCode = ResultCode || (status === 'success' ? 0 : 1); resultDesc = ResultDesc || status; }
        if (checkoutId) await processWebhook({ reference: checkoutId, ResponseCode: resultCode, TransactionReceipt: checkoutId, ResultDesc: resultDesc });
        res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    } catch (error) { console.error('Callback error:', error); res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' }); }
});

/* =========================
   BILLING ROUTES
   ========================= */
app.post('/api/billing/unlock-matches', protect, async (req, res) => {
  try { const { amount } = req.body; if (amount !== 299) return res.status(400).json({ message: 'Invalid amount' }); req.user.tier = 'matches_unlocked'; req.user.amountSpent += 299; await req.user.save(); await Payment.create({ userId: req.user._id, type: 'matches', amount: 299, status: 'completed' }); res.json({ success: true, message: 'Matches unlocked', tier: req.user.tier }); }
  catch (error) { res.status(500).json({ message: error.message }); }
});

app.post('/api/billing/unlock-sugar', protect, async (req, res) => {
  try { const { amount } = req.body; if (amount !== 499) return res.status(400).json({ message: 'Invalid amount' }); req.user.tier = 'sugar_unlocked'; req.user.amountSpent += 499; await req.user.save(); await Payment.create({ userId: req.user._id, type: 'sugar', amount: 499, status: 'completed' }); res.json({ success: true, message: 'Sugar sections unlocked', tier: req.user.tier }); }
  catch (error) { res.status(500).json({ message: error.message }); }
});

app.post('/api/billing/unlock-premium', protect, async (req, res) => {
  try { const { amount } = req.body; if (amount !== 199) return res.status(400).json({ message: 'Invalid amount' }); req.user.tier = 'premium_unlocked'; req.user.amountSpent += 199; await req.user.save(); await Payment.create({ userId: req.user._id, type: 'premium', amount: 199, status: 'completed' }); res.json({ success: true, message: 'Premium profiles unlocked', tier: req.user.tier }); }
  catch (error) { res.status(500).json({ message: error.message }); }
});

app.post('/api/billing/go-live', protect, async (req, res) => {
  try { const { amount } = req.body; if (amount !== 99) return res.status(400).json({ message: 'Invalid amount' }); req.user.visibility = 'live'; req.user.amountSpent += 99; await req.user.save(); await Payment.create({ userId: req.user._id, type: 'live', amount: 99, status: 'completed' }); res.json({ success: true, message: 'You are now LIVE', visibility: req.user.visibility }); }
  catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/billing/status', protect, async (req, res) => {
  try { res.json({ tier: req.user.tier, visibility: req.user.visibility, amountSpent: req.user.amountSpent }); }
  catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/billing/payments', protect, async (req, res) => {
  try { const payments = await Payment.find({ userId: req.user._id }).sort({ createdAt: -1 }); res.json(payments); }
  catch (error) { res.status(500).json({ message: error.message }); }
});

/* =========================
   CHAT ROUTES
   ========================= */
app.get('/api/messages', protect, async (req, res) => {
  try { const { userId } = req.query; const messages = await Message.find({ $or: [{ senderId: req.user._id, receiverId: userId }, { senderId: userId, receiverId: req.user._id }] }).sort({ createdAt: 1 }).limit(100); res.json(messages); }
  catch (error) { res.status(500).json({ message: error.message }); }
});

app.post('/api/messages', protect, async (req, res) => {
  try { const { receiverId, content } = req.body; if (!receiverId || !content) return res.status(400).json({ message: 'Receiver and content required' }); const message = await Message.create({ senderId: req.user._id, receiverId, content }); res.status(201).json(message); }
  catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/messages/conversations', protect, async (req, res) => {
  try {
    const messages = await Message.find({ $or: [{ senderId: req.user._id }, { receiverId: req.user._id }] }).sort({ createdAt: -1 });
    const conversationMap = new Map();
    messages.forEach(msg => { const otherId = msg.senderId.toString() === req.user._id.toString() ? msg.receiverId.toString() : msg.senderId.toString(); if (!conversationMap.has(otherId)) conversationMap.set(otherId, msg); });
    const conversations = Array.from(conversationMap.entries()).map(([userId, lastMsg]) => ({ userId, lastMessage: lastMsg }));
    res.json(conversations);
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.patch('/api/messages/read', protect, async (req, res) => {
  try { const { senderId } = req.body; await Message.updateMany({ senderId, receiverId: req.user._id, read: false }, { read: true }); res.json({ message: 'Messages marked as read' }); }
  catch (error) { res.status(500).json({ message: error.message }); }
});

/* =========================
   VIDEO ROUTES
   ========================= */
app.get('/api/videos', async (req, res) => {
  try { const videos = await Video.find().sort({ createdAt: -1 }).limit(20); res.json(videos); }
  catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/videos/:id', async (req, res) => {
  try { const video = await Video.findById(req.params.id); if (!video) return res.status(404).json({ message: 'Video not found' }); video.views += 1; await video.save(); res.json(video); }
  catch (error) { res.status(500).json({ message: error.message }); }
});

app.post('/api/videos', protect, async (req, res) => {
  try { const { title, thumbnail, url, duration, isPremium } = req.body; const video = await Video.create({ title, thumbnail, url, duration, isPremium, uploaderId: req.user._id }); res.status(201).json(video); }
  catch (error) { res.status(500).json({ message: error.message }); }
});

/* =========================
   AFROLINK ADMIN ROUTES
   ========================= */
app.post('/api/admin/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (username !== ADMIN_USERNAME) return res.status(401).json({ success: false, message: 'Invalid credentials' });
        let valid = false;
        if (ADMIN_PASSWORD_HASH) valid = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
        else valid = password === ADMIN_PASSWORD;
        if (!valid) return res.status(401).json({ success: false, message: 'Invalid credentials' });
        const token = jwt.sign({ role: 'admin', username }, JWT_SECRET, { expiresIn: '1d' });
        res.json({ success: true, token });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/admin/change-password', verifyAdmin, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        if (!newPassword || newPassword.length < 6) return res.status(400).json({ success: false, message: 'Password must be 6+ chars' });
        let valid = false;
        if (ADMIN_PASSWORD_HASH) valid = await bcrypt.compare(currentPassword, ADMIN_PASSWORD_HASH);
        else valid = currentPassword === ADMIN_PASSWORD;
        if (!valid) return res.status(401).json({ success: false, message: 'Current password incorrect' });
        const newHash = await bcrypt.hash(newPassword, 10);
        res.json({ success: true, message: 'Password changed. Update ADMIN_PASSWORD_HASH in .env to: ' + newHash });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/admin/profiles', verifyAdmin, async (req, res) => {
    try { const profiles = await Listing.find().sort({ createdAt: -1 }); res.json({ success: true, profiles }); }
    catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/admin/profiles', verifyAdmin, upload.single('image'), async (req, res) => {
    try {
        const data = req.body;
        if (req.file) data.img = '/uploads/' + req.file.filename;
        data.image = data.img || ''; data.loc = data.location || data.loc || 'Nairobi'; data.desc = data.bio || data.desc || '';
        data.status = 'verified'; data.isVerified = true;
        const listing = new Listing(data); await listing.save();
        res.json({ success: true, profile: listing });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.put('/api/admin/profiles/:id', verifyAdmin, upload.single('image'), async (req, res) => {
    try {
        const updates = req.body;
        if (req.file) updates.img = '/uploads/' + req.file.filename;
        if (updates.img) updates.image = updates.img; updates.loc = updates.location || updates.loc || 'Nairobi'; updates.desc = updates.bio || updates.desc || '';
        const listing = await Listing.findByIdAndUpdate(req.params.id, updates, { new: true });
        if (!listing) return res.status(404).json({ success: false, message: 'Profile not found' });
        res.json({ success: true, profile: listing });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/admin/approvals', verifyAdmin, async (req, res) => {
    try { const pending = await Listing.find({ status: 'pending' }).sort({ createdAt: -1 }); res.json({ success: true, approvals: pending }); }
    catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/admin/profiles/:id/approve', verifyAdmin, async (req, res) => {
    try { const listing = await Listing.findByIdAndUpdate(req.params.id, { status: 'verified', isVerified: true }, { new: true }); if (!listing) return res.status(404).json({ success: false, message: 'Not found' }); res.json({ success: true, profile: listing }); }
    catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/admin/profiles/:id/reject', verifyAdmin, async (req, res) => {
    try { const listing = await Listing.findByIdAndUpdate(req.params.id, { status: 'rejected' }, { new: true }); if (!listing) return res.status(404).json({ success: false, message: 'Not found' }); res.json({ success: true, profile: listing }); }
    catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.delete('/api/admin/profiles/:id', verifyAdmin, async (req, res) => {
    try { await Listing.findByIdAndDelete(req.params.id); res.json({ success: true }); }
    catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/admin/transactions', verifyAdmin, async (req, res) => {
    try { const txs = await Deposit.find().sort({ createdAt: -1 }).limit(200).populate('profileId', 'name phone'); res.json({ success: true, transactions: txs }); }
    catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/admin/stats', verifyAdmin, async (req, res) => {
    try {
        const totalRevenue = await Deposit.aggregate([{ $match: { status: 'success' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]);
        const todayRevenue = await Deposit.aggregate([{ $match: { status: 'success', createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }, { $group: { _id: null, total: { $sum: '$amount' } } }]);
        const totalUnlocks = await Deposit.countDocuments({ status: 'success', type: 'unlock' });
        const totalListings = await Deposit.countDocuments({ status: 'success', type: 'listing' });
        const activeProfiles = await Listing.countDocuments({ status: 'verified' });
        const pendingProfiles = await Listing.countDocuments({ status: 'pending' });
        const totalProfiles = await Listing.countDocuments();
        const totalTransactions = await Deposit.countDocuments();
        const totalUsers = await User.countDocuments();
        res.json({ success: true, stats: { totalRevenue: totalRevenue[0]?.total || 0, todayRevenue: todayRevenue[0]?.total || 0, totalUnlocks, totalListings, activeProfiles, pendingProfiles, totalProfiles, totalTransactions, totalUsers, platformFee: PLATFORM_FEE_PERCENT } });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

/* =========================
   MSUPA ADMIN ROUTES (compat)
   ========================= */
app.get('/api/admin/dashboard', adminProtect, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments(); const totalListings = await Listing.countDocuments(); const liveUsers = await User.countDocuments({ visibility: 'live' });
    const totalRevenue = await User.aggregate([{ $group: { _id: null, total: { $sum: '$amountSpent' } } }]);
    const tierBreakdown = await User.aggregate([{ $group: { _id: '$tier', count: { $sum: 1 } } }]);
    const recentUsers = await User.find().sort({ createdAt: -1 }).limit(10).select('-password');
    const recentPayments = await Payment.find().sort({ createdAt: -1 }).limit(10).populate('userId', 'name email');
    res.json({ totalUsers, totalListings, liveUsers, totalRevenue: totalRevenue[0]?.total || 0, tierBreakdown, recentUsers, recentPayments });
  } catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/admin/users', adminProtect, async (req, res) => {
  try { const users = await User.find().select('-password').sort({ createdAt: -1 }); res.json(users); }
  catch (error) { res.status(500).json({ message: error.message }); }
});

app.get('/api/admin/payments', adminProtect, async (req, res) => {
  try { const payments = await Payment.find().sort({ createdAt: -1 }).populate('userId', 'name email'); res.json(payments); }
  catch (error) { res.status(500).json({ message: error.message }); }
});

app.patch('/api/admin/users/:id/visibility', adminProtect, async (req, res) => {
  try { const { visibility } = req.body; const user = await User.findByIdAndUpdate(req.params.id, { visibility }, { new: true }).select('-password'); res.json(user); }
  catch (error) { res.status(500).json({ message: error.message }); }
});

app.patch('/api/admin/users/:id/tier', adminProtect, async (req, res) => {
  try { const { tier } = req.body; const user = await User.findByIdAndUpdate(req.params.id, { tier }, { new: true }).select('-password'); res.json(user); }
  catch (error) { res.status(500).json({ message: error.message }); }
});

app.delete('/api/admin/users/:id', adminProtect, async (req, res) => {
  try { await User.findByIdAndDelete(req.params.id); await Listing.deleteMany({ userId: req.params.id }); await Payment.deleteMany({ userId: req.params.id }); res.json({ message: 'User deleted' }); }
  catch (error) { res.status(500).json({ message: error.message }); }
});

/* =========================
   ERROR HANDLING
   ========================= */
app.use((err, req, res, next) => {
    console.error(err.stack);
    if (err instanceof multer.MulterError) return res.status(400).json({ success: false, message: err.message });
    res.status(500).json({ success: false, message: 'Internal server error' });
});

app.use((req, res) => {
    res.status(404).json({ status: 'error', message: 'Route not found', path: req.path, hint: 'This is the MsupaChat API.' });
});

/* =========================
   START SERVER
   ========================= */
app.listen(PORT, () => {
    console.log(`MsupaChat v3.1 API running on port ${PORT}`);
    console.log(`Webhook URLs:`);
    console.log(`  POST ${BASE_URL}/api/webhook/megapay`);
    console.log(`  POST ${BASE_URL}/api/megapay/webhook`);
    console.log(`  POST ${BASE_URL}/api/mpesa/callback`);
});