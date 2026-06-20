require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Resend } = require('resend');
const path = require('path');

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
  img: { type: String, required: true },
  reason: { type: String, enum: ['hookup', 'friendship', 'companionship'], required: true },
  bio: { type: String, default: '' },
  budget: { type: String, default: '' },
  verified: { type: Boolean, default: false },
  category: { type: String, enum: ['match', 'sugar_mummy', 'sugar_daddy', 'premium'], required: true },
  isActive: { type: Boolean, default: true },
  views: { type: Number, default: 0 }
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
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['matches', 'sugar', 'premium', 'live', 'video_basic', 'video_premium', 'video_vip'], required: true },
  amount: { type: Number, required: true },
  status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
  mpesaRef: { type: String, default: '' }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
const Listing = mongoose.model('Listing', listingSchema);
const Message = mongoose.model('Message', messageSchema);
const Video = mongoose.model('Video', videoSchema);
const Payment = mongoose.model('Payment', paymentSchema);

/* =========================
   APP SETUP
   ========================= */
const app = express();
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

const resend = new Resend(process.env.RESEND_API_KEY);
const generateToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });

/* =========================
   MIDDLEWARE
   ========================= */
const protect = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'Not authorized, no token' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id).select('-password');
    if (!req.user) return res.status(401).json({ message: 'User not found' });
    next();
  } catch (error) {
    res.status(401).json({ message: 'Not authorized, invalid token' });
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
    if (password.length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters' });
    const userExists = await User.findOne({ email });
    if (userExists) return res.status(400).json({ message: 'User already exists' });
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const user = await User.create({ name, email, password: hashedPassword });
    try {
      await resend.emails.send({
        from: process.env.EMAIL_FROM || 'onboarding@resend.dev',
        to: email,
        subject: 'Welcome to MsupaChat',
        html: `<h1>Welcome ${name}!</h1><p>Your account has been created successfully. Start exploring premium connections today.</p>`
      });
    } catch (e) { console.log('Email send failed:', e.message); }
    res.status(201).json({
      _id: user._id, name: user.name, email: user.email, role: user.role,
      tier: user.tier, visibility: user.visibility, amountSpent: user.amountSpent,
      bio: user.bio, registrationDate: user.registrationDate,
      token: generateToken(user._id)
    });
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
    const resetUrl = `${process.env.FRONTEND_URL || 'https://msupachat.com'}/reset-password?token=${resetToken}`;
    try {
      await resend.emails.send({
        from: process.env.EMAIL_FROM || 'onboarding@resend.dev',
        to: email,
        subject: 'MsupaChat Password Reset',
        html: `<h1>Password Reset</h1><p>Click <a href="${resetUrl}">here</a> to reset your password. Link expires in 1 hour.</p>`
      });
    } catch (e) { console.log('Email send failed:', e.message); }
    res.json({ message: 'Reset email sent' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!password || password.length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters' });
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

app.get('/api/auth/validate', protect, async (req, res) => {
  try {
    res.json(req.user);
  } catch (error) {
    res.status(401).json({ message: 'Invalid token' });
  }
});

/* =========================
   USER PROFILE ROUTES
   ========================= */
app.get('/api/users/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.patch('/api/users/me', protect, async (req, res) => {
  try {
    const { bio, name, phone, location, age, profilePic } = req.body;
    const updates = {};
    if (bio !== undefined) updates.bio = bio;
    if (name !== undefined) updates.name = name;
    if (phone !== undefined) updates.phone = phone;
    if (location !== undefined) updates.location = location;
    if (age !== undefined) updates.age = age;
    if (profilePic !== undefined) updates.profilePic = profilePic;
    const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true }).select('-password');
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/users/:id', protect, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/* =========================
   LISTING / PROFILE ROUTES
   ========================= */
app.get('/api/listings', async (req, res) => {
  try {
    const { category, limit = 20, page = 1 } = req.query;
    const filter = { isActive: true };
    if (category) filter.category = category;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const listings = await Listing.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit));
    const total = await Listing.countDocuments(filter);
    res.json({ listings, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/listings/:id', async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id);
    if (!listing) return res.status(404).json({ message: 'Listing not found' });
    listing.views += 1;
    await listing.save();
    res.json(listing);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/listings', protect, async (req, res) => {
  try {
    const { name, age, location, img, reason, bio, budget, category } = req.body;
    if (!name || !age || !location || !img || !reason || !category) {
      return res.status(400).json({ message: 'Please provide all required fields' });
    }
    const listing = await Listing.create({
      userId: req.user._id, name, age, location, img, reason, bio, budget, category
    });
    res.status(201).json(listing);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.patch('/api/listings/:id', protect, async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id);
    if (!listing) return res.status(404).json({ message: 'Listing not found' });
    if (listing.userId?.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized' });
    }
    const updates = req.body;
    Object.keys(updates).forEach(key => {
      if (updates[key] !== undefined) listing[key] = updates[key];
    });
    await listing.save();
    res.json(listing);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.delete('/api/listings/:id', protect, async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id);
    if (!listing) return res.status(404).json({ message: 'Listing not found' });
    if (listing.userId?.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized' });
    }
    await Listing.findByIdAndDelete(req.params.id);
    res.json({ message: 'Listing deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/* =========================
   SEED DATA ROUTE
   ========================= */
app.post('/api/seed/listings', adminProtect, async (req, res) => {
  try {
    const seedData = [
      // Matches (20)
      { name: 'Cindy', age: 23, location: 'Nairobi', img: '/assets/images/match/match1.jpg', reason: 'hookup', bio: 'Fun-loving and adventurous. Looking for someone spontaneous.', category: 'match' },
      { name: 'Amina', age: 25, location: 'Mombasa', img: '/assets/images/match/match2.jpg', reason: 'friendship', bio: 'Beach lover and foodie. Let\'s explore the coast together.', category: 'match' },
      { name: 'Grace', age: 22, location: 'Kisumu', img: '/assets/images/match/match3.jpg', reason: 'companionship', bio: 'Quiet evenings and deep conversations are my vibe.', category: 'match' },
      { name: 'Zara', age: 24, location: 'Nakuru', img: '/assets/images/match/match4.jpg', reason: 'hookup', bio: 'Life is too short for boring weekends.', category: 'match' },
      { name: 'Tasha', age: 26, location: 'Nairobi', img: '/assets/images/match/match5.jpg', reason: 'hookup', bio: 'City girl with a wild side. VIP experiences only.', category: 'match' },
      { name: 'Linda', age: 21, location: 'Eldoret', img: '/assets/images/match/match6.jpg', reason: 'friendship', bio: 'Athletic and outgoing. Love morning runs and coffee.', category: 'match' },
      { name: 'Brenda', age: 27, location: 'Thika', img: '/assets/images/match/match7.jpg', reason: 'companionship', bio: 'Mature mind, young soul. Seeking genuine connection.', category: 'match' },
      { name: 'Diana', age: 23, location: 'Nairobi', img: '/assets/images/match/match8.jpg', reason: 'hookup', bio: 'Night owl and party enthusiast. Westlands regular.', category: 'match' },
      { name: 'Fiona', age: 24, location: 'Mombasa', img: '/assets/images/match/match9.jpg', reason: 'friendship', bio: 'Travel bug looking for a partner in crime.', category: 'match' },
      { name: 'Hannah', age: 22, location: 'Kisumu', img: '/assets/images/match/match10.jpg', reason: 'companionship', bio: 'Lake-side serenity and good wine.', category: 'match' },
      { name: 'Ivy', age: 25, location: 'Nakuru', img: '/assets/images/match/match11.jpg', reason: 'hookup', bio: 'Bold, beautiful, and unapologetic.', category: 'match' },
      { name: 'Jackie', age: 23, location: 'Nairobi', img: '/assets/images/match/match12.jpg', reason: 'friendship', bio: 'Creative soul. Photographer and artist.', category: 'match' },
      { name: 'Kate', age: 26, location: 'Eldoret', img: '/assets/images/match/match13.jpg', reason: 'companionship', bio: 'Homebody with a taste for luxury.', category: 'match' },
      { name: 'Leah', age: 21, location: 'Thika', img: '/assets/images/match/match14.jpg', reason: 'hookup', bio: 'Young, free, and living my best life.', category: 'match' },
      { name: 'Megan', age: 24, location: 'Nairobi', img: '/assets/images/match/match15.jpg', reason: 'friendship', bio: 'Corporate by day, fun-loving by night.', category: 'match' },
      { name: 'Naomi', age: 22, location: 'Mombasa', img: '/assets/images/match/match16.jpg', reason: 'hookup', bio: 'Island girl with mainland dreams.', category: 'match' },
      { name: 'Ruth', age: 25, location: 'Nairobi', img: '/assets/images/match/match17.jpg', reason: 'companionship', bio: 'Looking for something real and lasting.', category: 'match' },
      { name: 'Joy', age: 23, location: 'Kisumu', img: '/assets/images/match/match18.jpg', reason: 'friendship', bio: 'Smile enthusiast and positivity spreader.', category: 'match' },
      { name: 'Betty', age: 26, location: 'Nakuru', img: '/assets/images/match/match19.jpg', reason: 'hookup', bio: 'Weekend getaways and fine dining.', category: 'match' },
      { name: 'Sharon', age: 24, location: 'Nairobi', img: '/assets/images/match/match20.jpg', reason: 'companionship', bio: 'Queen looking for her king.', category: 'match' },
      // Sugar Mummies (10)
      { name: 'Wambui', age: 42, location: 'Nairobi', img: '/assets/images/sugarmummy/mummy1.jpg', reason: 'companionship', budget: '50K weekly', bio: 'Established businesswoman. I value discretion and class.', category: 'sugar_mummy' },
      { name: 'Achieng', age: 38, location: 'Mombasa', img: '/assets/images/sugarmummy/mummy2.jpg', reason: 'hookup', budget: '30K weekly', bio: 'Beachfront property owner. Love island vibes.', category: 'sugar_mummy' },
      { name: 'Njoki', age: 45, location: 'Nairobi', img: '/assets/images/sugarmummy/mummy3.jpg', reason: 'friendship', budget: '40K weekly', bio: 'Collector of fine art and finer company.', category: 'sugar_mummy' },
      { name: 'Mutheu', age: 40, location: 'Kisumu', img: '/assets/images/sugarmummy/mummy4.jpg', reason: 'companionship', budget: '35K weekly', bio: 'Lake-view living. Seeking intelligent conversation.', category: 'sugar_mummy' },
      { name: 'Kamene', age: 44, location: 'Nakuru', img: '/assets/images/sugarmummy/mummy5.jpg', reason: 'hookup', budget: '60K weekly', bio: 'High energy, high standards. No time wasters.', category: 'sugar_mummy' },
      { name: 'Wanjiku', age: 41, location: 'Nairobi', img: '/assets/images/sugarmummy/mummy6.jpg', reason: 'friendship', budget: '45K weekly', bio: 'Restaurant owner. Foodie adventures await.', category: 'sugar_mummy' },
      { name: 'Muthoni', age: 39, location: 'Thika', img: '/assets/images/sugarmummy/mummy7.jpg', reason: 'companionship', budget: '55K weekly', bio: 'Farm life meets luxury. Best of both worlds.', category: 'sugar_mummy' },
      { name: 'Wairimu', age: 46, location: 'Nairobi', img: '/assets/images/sugarmummy/mummy8.jpg', reason: 'hookup', budget: '70K weekly', bio: 'International traveler. Passport ready?', category: 'sugar_mummy' },
      { name: 'Nyambura', age: 37, location: 'Mombasa', img: '/assets/images/sugarmummy/mummy9.jpg', reason: 'friendship', budget: '25K weekly', bio: 'Young at heart. Looking for genuine fun.', category: 'sugar_mummy' },
      { name: 'Wangechi', age: 43, location: 'Nairobi', img: '/assets/images/sugarmummy/mummy10.jpg', reason: 'companionship', budget: '65K weekly', bio: 'CEO mindset. Only the ambitious need apply.', category: 'sugar_mummy' },
      // Sugar Daddies (10)
      { name: 'Mr. Kariuki', age: 48, location: 'Nairobi', img: '/assets/images/sugardaddy/daddy1.jpg', reason: 'companionship', budget: '100K monthly', bio: 'Real estate mogul. I take care of those who take care of me.', category: 'sugar_daddy' },
      { name: 'Mr. Omondi', age: 52, location: 'Mombasa', img: '/assets/images/sugardaddy/daddy2.jpg', reason: 'friendship', budget: '80K monthly', bio: 'Shipping industry. Ocean views and ocean-deep pockets.', category: 'sugar_daddy' },
      { name: 'Mr. Ndegwa', age: 45, location: 'Nairobi', img: '/assets/images/sugardaddy/daddy3.jpg', reason: 'hookup', budget: '120K monthly', bio: 'Tech investor. Always ahead of the curve.', category: 'sugar_daddy' },
      { name: 'Mr. Mutua', age: 50, location: 'Eldoret', img: '/assets/images/sugardaddy/daddy4.jpg', reason: 'companionship', budget: '90K monthly', bio: 'Agriculture tycoon. Down to earth but living high.', category: 'sugar_daddy' },
      { name: 'Mr. Wekesa', age: 47, location: 'Kisumu', img: '/assets/images/sugardaddy/daddy5.jpg', reason: 'friendship', budget: '110K monthly', bio: 'Import/export business. Global taste, local roots.', category: 'sugar_daddy' },
      { name: 'Mr. Kamau', age: 49, location: 'Nairobi', img: '/assets/images/sugardaddy/daddy6.jpg', reason: 'hookup', budget: '150K monthly', bio: 'Finance director. Numbers don\'t lie, and neither do I.', category: 'sugar_daddy' },
      { name: 'Mr. Otieno', age: 51, location: 'Mombasa', img: '/assets/images/sugardaddy/daddy7.jpg', reason: 'companionship', budget: '95K monthly', bio: 'Hotel chain owner. Suite life is the only life.', category: 'sugar_daddy' },
      { name: 'Mr. Mwangi', age: 44, location: 'Nairobi', img: '/assets/images/sugardaddy/daddy8.jpg', reason: 'friendship', budget: '130K monthly', bio: 'Startup founder. Young energy, old money.', category: 'sugar_daddy' },
      { name: 'Mr. Kipchoge', age: 53, location: 'Eldoret', img: '/assets/images/sugardaddy/daddy9.jpg', reason: 'hookup', budget: '85K monthly', bio: 'Athletics patron. Speed and stamina matter.', category: 'sugar_daddy' },
      { name: 'Mr. Maina', age: 46, location: 'Nakuru', img: '/assets/images/sugardaddy/daddy10.jpg', reason: 'companionship', budget: '105K monthly', bio: 'Tourism investor. Let me show you the world.', category: 'sugar_daddy' },
      // Premium (6)
      { name: 'Stacy', age: 24, location: 'Nairobi', img: '/assets/images/premium/premium(1).jpg', reason: 'hookup', verified: true, bio: 'Premium verified. Exclusive access only.', category: 'premium' },
      { name: 'Naomi', age: 23, location: 'Mombasa', img: '/assets/images/premium/premium(2).jpg', reason: 'friendship', verified: true, bio: 'High-class companion. Discretion guaranteed.', category: 'premium' },
      { name: 'Ruth', age: 25, location: 'Nairobi', img: '/assets/images/premium/premium(3).jpg', reason: 'companionship', verified: true, bio: 'Model and influencer. Living the dream.', category: 'premium' },
      { name: 'Joy', age: 22, location: 'Kisumu', img: '/assets/images/premium/premium(4).jpg', reason: 'hookup', verified: true, bio: 'Young, wild, and free. Catch me if you can.', category: 'premium' },
      { name: 'Betty', age: 26, location: 'Nakuru', img: '/assets/images/premium/premium(5).jpg', reason: 'friendship', verified: true, bio: 'Entrepreneur by day, party queen by night.', category: 'premium' },
      { name: 'Sharon', age: 24, location: 'Nairobi', img: '/assets/images/premium/premium(6).jpg', reason: 'companionship', verified: true, bio: 'The complete package. See for yourself.', category: 'premium' }
    ];
    await Listing.deleteMany({});
    await Listing.insertMany(seedData);
    res.json({ message: '46 listings seeded successfully', count: seedData.length });
  } catch (error) {
    res.status(500).json({ message: error.message });
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
    await Payment.create({ userId: req.user._id, type: 'matches', amount: 299, status: 'completed' });
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
    await Payment.create({ userId: req.user._id, type: 'sugar', amount: 499, status: 'completed' });
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
    await Payment.create({ userId: req.user._id, type: 'premium', amount: 199, status: 'completed' });
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
    await Payment.create({ userId: req.user._id, type: 'live', amount: 99, status: 'completed' });
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

app.get('/api/billing/payments', protect, async (req, res) => {
  try {
    const payments = await Payment.find({ userId: req.user._id }).sort({ createdAt: -1 });
    res.json(payments);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/* =========================
   CHAT ROUTES
   ========================= */
app.get('/api/messages', protect, async (req, res) => {
  try {
    const { userId } = req.query;
    const messages = await Message.find({
      $or: [
        { senderId: req.user._id, receiverId: userId },
        { senderId: userId, receiverId: req.user._id }
      ]
    }).sort({ createdAt: 1 }).limit(100);
    res.json(messages);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/messages', protect, async (req, res) => {
  try {
    const { receiverId, content } = req.body;
    if (!receiverId || !content) return res.status(400).json({ message: 'Receiver and content required' });
    const message = await Message.create({ senderId: req.user._id, receiverId, content });
    res.status(201).json(message);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/messages/conversations', protect, async (req, res) => {
  try {
    const messages = await Message.find({
      $or: [{ senderId: req.user._id }, { receiverId: req.user._id }]
    }).sort({ createdAt: -1 });
    const conversationMap = new Map();
    messages.forEach(msg => {
      const otherId = msg.senderId.toString() === req.user._id.toString() ? msg.receiverId.toString() : msg.senderId.toString();
      if (!conversationMap.has(otherId)) conversationMap.set(otherId, msg);
    });
    const conversations = Array.from(conversationMap.entries()).map(([userId, lastMsg]) => ({ userId, lastMessage: lastMsg }));
    res.json(conversations);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.patch('/api/messages/read', protect, async (req, res) => {
  try {
    const { senderId } = req.body;
    await Message.updateMany(
      { senderId, receiverId: req.user._id, read: false },
      { read: true }
    );
    res.json({ message: 'Messages marked as read' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/* =========================
   VIDEO ROUTES
   ========================= */
app.get('/api/videos', async (req, res) => {
  try {
    const videos = await Video.find().sort({ createdAt: -1 }).limit(20);
    res.json(videos);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get('/api/videos/:id', async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video) return res.status(404).json({ message: 'Video not found' });
    video.views += 1;
    await video.save();
    res.json(video);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/videos', protect, async (req, res) => {
  try {
    const { title, thumbnail, url, duration, isPremium } = req.body;
    const video = await Video.create({ title, thumbnail, url, duration, isPremium, uploaderId: req.user._id });
    res.status(201).json(video);
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
    const recentPayments = await Payment.find().sort({ createdAt: -1 }).limit(10).populate('userId', 'name email');
    res.json({
      totalUsers, totalListings, liveUsers,
      totalRevenue: totalRevenue[0]?.total || 0,
      tierBreakdown, recentUsers, recentPayments
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

app.get('/api/admin/payments', adminProtect, async (req, res) => {
  try {
    const payments = await Payment.find().sort({ createdAt: -1 }).populate('userId', 'name email');
    res.json(payments);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.patch('/api/admin/users/:id/visibility', adminProtect, async (req, res) => {
  try {
    const { visibility } = req.body;
    const user = await User.findByIdAndUpdate(req.params.id, { visibility }, { new: true }).select('-password');
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.patch('/api/admin/users/:id/tier', adminProtect, async (req, res) => {
  try {
    const { tier } = req.body;
    const user = await User.findByIdAndUpdate(req.params.id, { tier }, { new: true }).select('-password');
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.delete('/api/admin/users/:id', adminProtect, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    await Listing.deleteMany({ userId: req.params.id });
    await Payment.deleteMany({ userId: req.params.id });
    res.json({ message: 'User deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/* =========================
   HEALTH
   ========================= */
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString(), version: '3.0.0' });
});

/* =========================
   CATCH-ALL (SPA fallback)
   ========================= */
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* =========================
   START SERVER
   ========================= */
const PORT = process.env.PORT || 3032;
app.listen(PORT, () => console.log(`MsupaChat v3 server running on port ${PORT}`));
