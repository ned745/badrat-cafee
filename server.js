const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const axios = require('axios');

const app = express();

// --- 1. Middleware Setup ---
app.use(cors({
  origin: [
    'https://badrat-cafee-public.vercel.app', 
    'https://badrat-cafee.vercel.app',
    'http://localhost:3000',
    'http://localhost:5000'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(express.json());

// --- 2. Cloudinary & Multer Setup ---
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const upload = multer({ storage: multer.memoryStorage() });

// --- 3. Database Connection ---
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://nedaol753_db_user:Benjaminned1@cluster0.2v3gnou.mongodb.net/?retryWrites=true&w=majority';
mongoose.connect(MONGODB_URI)
.then(() => console.log('✅ MongoDB Atlas Connected Successfully'))
.catch(err => console.error('❌ MongoDB Connection Error:', err));

// --- 4. Mongoose Schemas & Models ---
const itemSchema = new mongoose.Schema({
  name: { type: String, required: true },
  category: { type: String, required: true },
  price: { type: Number, required: true },
  description: { type: String, default: '' },
  imageUrl: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});
const Item = mongoose.models.Item || mongoose.model('Item', itemSchema);

const terminalSchema = new mongoose.Schema({
  terminalId: { type: String, required: true, unique: true },
  tier: { type: String, required: true },
  status: { type: String, default: 'Available' },
  currentUser: { type: String, default: '' }
});
const Terminal = mongoose.model('Terminal', terminalSchema);

const orderSchema = new mongoose.Schema({
  customerName: { type: String, required: true },
  serviceType: { type: String, required: true },
  details: { type: String, required: true },
  status: { type: String, default: 'Pending' },
  adminReply: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});
const Order = mongoose.model('Order', orderSchema);

const gallerySchema = new mongoose.Schema({
  title: { type: String, required: true },
  category: { type: String, required: true },
  imageUrl: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});
const GalleryItem = mongoose.model('GalleryItem', gallerySchema);


// --- 5. Admin Authentication Middleware ---
const verifyAdmin = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Access denied. No token provided.' });
  }
  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret_key');
    if (decoded.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Access denied. Requires admin privileges.' });
    }
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ success: false, error: 'Invalid or expired token.' });
  }
};


// --- 6. API Routes ---

app.get('/', (req, res) => {
  res.json({ success: true, message: 'Badrat Cafee API is live!' });
});

app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;
  const adminUser = process.env.ADMIN_USER || 'BADRAT';
  const adminPass = process.env.ADMIN_PASSWORD || 'Password$1';

  if (username === adminUser && password === adminPass) {
    const token = jwt.sign(
      { username: adminUser, role: 'admin' }, 
      process.env.JWT_SECRET || 'fallback_secret_key', 
      { expiresIn: '12h' }
    );
    return res.json({ success: true, token, message: 'Admin login successful' });
  }
  res.status(401).json({ success: false, error: 'Invalid admin credentials' });
});

app.get('/api/terminals', async (req, res) => {
  try {
    let terminals = await Terminal.find();
    if (terminals.length === 0) {
      const defaults = [
        { terminalId: 'PC-01', tier: 'Pro Gaming', status: 'Available' },
        { terminalId: 'PC-02', tier: 'Pro Gaming', status: 'Available' },
        { terminalId: 'PC-03', tier: 'Standard', status: 'Available' },
        { terminalId: 'PC-04', tier: 'Standard', status: 'Available' }
      ];
      terminals = await Terminal.insertMany(defaults);
    }
    res.json({ success: true, terminals });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/terminals/book', async (req, res) => {
  try {
    const { terminalId, currentUser, status } = req.body;
    const updated = await Terminal.findOneAndUpdate(
      { terminalId },
      { currentUser, status },
      { new: true, upsert: true }
    );
    res.json({ success: true, terminal: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/items', async (req, res) => {
  try {
    const items = await Item.find().sort({ createdAt: -1 });
    res.json({ success: true, items });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/items', verifyAdmin, upload.single('image'), async (req, res) => {
  try {
    let imageUrl = req.body.imageUrl || '';
    if (req.file) {
      const uploadResult = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: 'badrat-cafee' },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        );
        stream.end(req.file.buffer);
      });
      imageUrl = uploadResult.secure_url;
    }

    const newItem = new Item({
      name: req.body.name,
      category: req.body.category,
      price: req.body.price,
      description: req.body.description || '',
      imageUrl: imageUrl
    });

    await newItem.save();
    res.json({ success: true, item: newItem, message: 'Item created successfully!' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.delete('/api/items/:id', verifyAdmin, async (req, res) => {
  try {
    const deleted = await Item.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, error: 'Item not found' });
    res.json({ success: true, message: 'Item deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/orders', async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    res.json({ success: true, orders });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    const newOrder = new Order(req.body);
    await newOrder.save();
    res.json({ success: true, order: newOrder });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.put('/api/orders/:id/reply', async (req, res) => {
  try {
    const { status, adminReply } = req.body;
    const updated = await Order.findByIdAndUpdate(
      req.params.id,
      { status, adminReply },
      { new: true }
    );
    res.json({ success: true, order: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/gallery', async (req, res) => {
  try {
    const items = await GalleryItem.find().sort({ createdAt: -1 });
    res.json({ success: true, items });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- M-Pesa STK Push Route ---
app.post('/api/mpesa/stkpush', verifyAdmin, async (req, res) => {
  try {
    let { phone, amount } = req.body;
    phone = phone.replace(/^0/, '254').replace(/^\+/, '');
    
    const consumerKey = process.env.MPESA_CONSUMER_KEY;
    const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
    const shortCode = process.env.MPESA_SHORTCODE || '174379';
    const passKey = process.env.MPESA_PASSKEY;
    const env = process.env.MPESA_ENV || 'sandbox';

    if (!consumerKey || !consumerSecret || !passKey) {
      return res.status(400).json({ success: false, error: 'M-Pesa credentials not configured on server.' });
    }

    const authUrl = env === 'production' 
      ? 'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials'
      : 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials';

    const stkUrl = env === 'production'
      ? 'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest'
      : 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest';

    const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
    const tokenRes = await axios.get(authUrl, {
      headers: { Authorization: `Basic ${auth}` }
    });
    const accessToken = tokenRes.data.access_token;

    const date = new Date();
    const timestamp = date.getFullYear() +
      String(date.getMonth() + 1).padStart(2, '0') +
      String(date.getDate()).padStart(2, '0') +
      String(date.getHours()).padStart(2, '0') +
      String(date.getMinutes()).padStart(2, '0') +
      String(date.getSeconds()).padStart(2, '0');

    const password = Buffer.from(`${shortCode}${passKey}${timestamp}`).toString('base64');

    const stkPayload = {
      BusinessShortCode: shortCode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Number(amount),
      PartyA: phone,
      PartyB: shortCode,
      PhoneNumber: phone,
      CallBackURL: `${process.env.BACKEND_URL || 'https://badrat-cafee-api.onrender.com'}/api/mpesa/callback`,
      AccountReference: 'BadratCafee',
      TransactionDesc: 'Terminal & Cafe Payment'
    };

    const stkRes = await axios.post(stkUrl, stkPayload, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    res.json({ success: true, message: 'STK push triggered successfully', data: stkRes.data });
  } catch (err) {
    console.error('❌ M-Pesa STK Detailed Error:', err.response?.data || err.message);
    res.status(500).json({ success: false, error: err.response?.data || err.message });
  }
});

// --- M-Pesa Callback Endpoint ---
app.post('/api/mpesa/callback', async (req, res) => {
  try {
    const callbackData = req.body.Body.stkCallback;
    console.log('M-Pesa Callback Received:', JSON.stringify(callbackData, null, 2));
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (err) {
    console.error('Callback error:', err.message);
    res.status(500).json({ ResultCode: 1, ResultDesc: 'Rejected' });
  }
});

// --- 7. Server Listener ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Badrat Cafee Backend running on port ${PORT}`);
});