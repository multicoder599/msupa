require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Resend } = require('resend');

/* =========================
   DATABASE CONNECTION
   ========================= */
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};
connectDB();

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
  visibility: { type: String, enum: ['public', 'live'], default: 'public' },
  tier: { type: String, enum: ['free', 'matches_unlocked', 'sugar_unlocked', 'premium_unlocked'], default: 'free' },
  resetPasswordToken: { type: String, default: null },
  resetPasswordExpires: { type: Date, default: null }
}, { timestamps: true });

const listingSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  photosArray: { type: [String], default: [] },
  reason: { type: String, enum: ['hookup', 'friendship', 'companionship'], required: true },
  description: { type: String, default: '' },
  isLive: { type: Boolean, default: false },
  category: { type: String, enum: ['match', 'sugar_mummy', 'sugar_daddy', 'premium'], required: true }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
const Listing = mongoose.model('Listing', listingSchema);

/* =========================
   APP SETUP
   ========================= */
const app = express();
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const resend = new Resend(process.env.RESEND_API_KEY);
const generateToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });

/* =========================
   MIDDLEWARE
   ========================= */
const protect = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'Not authorized' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id).select('-password');
    if (!req.user) return res.status(401).json({ message: 'User not found' });
    next();
  } catch (error) {
    res.status(401).json({ message: 'Not authorized' });
  }
};

const adminProtect = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'Not authorized' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');
    if (!user || user.role !== 'admin') return res.status(403).json({ message: 'Admin access required' });
    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ message: 'Not authorized' });
  }
};

/* =========================
   AUTH ROUTES
   ========================= */
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ message: 'Please provide all fields' });
    const userExists = await User.findOne({ email });
    if (userExists) return res.status(400).json({ message: 'User already exists' });
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const user = await User.create({ name, email, password: hashedPassword });
    await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to: email,
      subject: 'Welcome to MsupaChat',
      html: `<h1>Welcome ${name}!</h1><p>Your account has been created successfully. Start exploring premium connections today.</p>`
    });
    res.status(201).json({ _id: user._id, name: user.name, email: user.email, role: user.role, token: generateToken(user._id) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (user && (await bcrypt.compare(password, user.password))) {
      res.json({
        _id: user._id, name: user.name, email: user.email, role: user.role,
        tier: user.tier, visibility: user.visibility, amountSpent: user.amountSpent,
        bio: user.bio, profilePic: user.profilePic, registrationDate: user.registrationDate,
        token: generateToken(user._id)
      });
    } else {
      res.status(401).json({ message: 'Invalid email or password' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: 'User not found' });
    const resetToken = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = Date.now() + 3600000;
    await user.save();
    const resetUrl = `https://msupachat.com/reset-password?token=${resetToken}`;
    await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to: email,
      subject: 'MsupaChat Password Reset',
      html: `<h1>Password Reset</h1><p>Click <a href="${resetUrl}">here</a> to reset your password. Link expires in 1 hour.</p>`
    });
    res.json({ message: 'Reset email sent' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user || user.resetPasswordToken !== token || user.resetPasswordExpires < Date.now()) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(password, salt);
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;
    await user.save();
    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/auth/validate', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'No token' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (error) {
    res.status(401).json({ message: 'Invalid token' });
  }
});

/* =========================
   BILLING ROUTES
   ========================= */
app.post('/api/billing/unlock-matches', protect, async (req, res) => {
  try {
    const { amount } = req.body;
    if (amount !== 299) return res.status(400).json({ message: 'Invalid amount' });
    req.user.tier = 'matches_unlocked';
    req.user.amountSpent += 299;
    await req.user.save();
    res.json({ success: true, message: 'Matches unlocked', tier: req.user.tier });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/billing/unlock-sugar', protect, async (req, res) => {
  try {
    const { amount } = req.body;
    if (amount !== 499) return res.status(400).json({ message: 'Invalid amount' });
    req.user.tier = 'sugar_unlocked';
    req.user.amountSpent += 499;
    await req.user.save();
    res.json({ success: true, message: 'Sugar sections unlocked', tier: req.user.tier });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/billing/unlock-premium', protect, async (req, res) => {
  try {
    const { amount } = req.body;
    if (amount !== 199) return res.status(400).json({ message: 'Invalid amount' });
    req.user.tier = 'premium_unlocked';
    req.user.amountSpent += 199;
    await req.user.save();
    res.json({ success: true, message: 'Premium profiles unlocked', tier: req.user.tier });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/billing/go-live', protect, async (req, res) => {
  try {
    const { amount } = req.body;
    if (amount !== 99) return res.status(400).json({ message: 'Invalid amount' });
    req.user.visibility = 'live';
    req.user.amountSpent += 99;
    await req.user.save();
    res.json({ success: true, message: 'You are now LIVE', visibility: req.user.visibility });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/billing/status', protect, async (req, res) => {
  try {
    res.json({ tier: req.user.tier, visibility: req.user.visibility, amountSpent: req.user.amountSpent });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/* =========================
   ADMIN ROUTES
   ========================= */
app.get('/api/admin/dashboard', adminProtect, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalListings = await Listing.countDocuments();
    const liveUsers = await User.countDocuments({ visibility: 'live' });
    const totalRevenue = await User.aggregate([{ $group: { _id: null, total: { $sum: '$amountSpent' } } }]);
    const tierBreakdown = await User.aggregate([{ $group: { _id: '$tier', count: { $sum: 1 } } }]);
    const recentUsers = await User.find().sort({ createdAt: -1 }).limit(10).select('-password');
    res.json({
      totalUsers, totalListings, liveUsers,
      totalRevenue: totalRevenue[0]?.total || 0,
      tierBreakdown, recentUsers
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/admin/users', adminProtect, async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.patch('/api/admin/users/:id/visibility', adminProtect, async (req, res) => {
  try {
    const { visibility } = req.body;
    const user = await User.findByIdAndUpdate(req.params.id, { visibility }, { new: true });
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/* =========================
   HEALTH
   ========================= */
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

/* =========================
   START SERVER
   ========================= */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`MsupaChat server running on port ${PORT}`));