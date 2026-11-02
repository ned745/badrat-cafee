const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

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

// --- 2. Database Connection ---
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://your_atlas_connection_string';
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('✅ MongoDB Atlas Connected Successfully'))
.catch(err => console.error('❌ MongoDB Connection Error:', err));

// --- 3. Mongoose Schemas & Models ---

// Item Schema (Menu / Services / Merchandise)
const itemSchema = new mongoose.Schema({
  name: { type: String, required: true },
  category: { type: String, required: true },
  price: { type: Number, required: true },
  description: String,
  createdAt: { type: Date, default: Date.now }
});
const Item = mongoose.model('Item', itemSchema);

// Terminal Schema (PC Rigs & Stations)
const terminalSchema = new mongoose.Schema({
  terminalId: { type: String, required: true, unique: true },
  tier: { type: String, required: true },
  status: { type: String, default: 'Available' }, // Available, Occupied, Maintenance
  currentUser: { type: String, default: '' }
});
const Terminal = mongoose.model('Terminal', terminalSchema);

// Customer Order Schema
const orderSchema = new mongoose.Schema({
  customerName: { type: String, required: true },
  serviceType: { type: String, required: true },
  details: { type: String, required: true },
  status: { type: String, default: 'Pending' }, // Pending, In Progress, Completed
  adminReply: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});
const Order = mongoose.model('Order', orderSchema);

// Gallery / Poster Schema
const gallerySchema = new mongoose.Schema({
  title: { type: String, required: true },
  category: { type: String, required: true },
  imageUrl: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});
const GalleryItem = mongoose.model('GalleryItem', gallerySchema);


// --- 4. Admin Authentication Middleware ---
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


// --- 5. API Routes ---

// Admin Login Route
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

// Get Terminals (Public)
app.get('/api/terminals', async (req, res) => {
  try {
    let terminals = await Terminal.find();
    // Initialize default terminals if none exist
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

// Update Terminal Booking/Status (Admin or System)
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

// Get Items (Public)
app.get('/api/items', async (req, res) => {
  try {
    const items = await Item.find().sort({ createdAt: -1 });
    res.json({ success: true, items });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Post Item (Admin Only)
app.post('/api/items', verifyAdmin, async (req, res) => {
  try {
    const newItem = new Item(req.body);
    await newItem.save();
    res.json({ success: true, item: newItem, message: 'Item created successfully' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Delete Item (Admin Only)
app.delete('/api/items/:id', verifyAdmin, async (req, res) => {
  try {
    const deleted = await Item.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, error: 'Item not found' });
    res.json({ success: true, message: 'Item deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get Customer Orders
app.get('/api/orders', async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    res.json({ success: true, orders });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Submit Customer Order
app.post('/api/orders', async (req, res) => {
  try {
    const newOrder = new Order(req.body);
    await newOrder.save();
    res.json({ success: true, order: newOrder });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Update Order Reply / Status
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

// Get Gallery Items
app.get('/api/gallery', async (req, res) => {
  try {
    const items = await GalleryItem.find().sort({ createdAt: -1 });
    res.json({ success: true, items });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Protected M-Pesa STK Push Route (Admin Only)
app.post('/api/mpesa/stkpush', verifyAdmin, async (req, res) => {
  try {
    const { phone, amount } = req.body;
    // Insert your Daraja API STK Push integration logic here
    // For demonstration, simulating successful response:
    console.log(`Processing M-Pesa STK Push of KES ${amount} to ${phone}`);
    res.json({ 
      success: true, 
      mpesaResponse: { ResponseCode: "0", ResultDesc: "Success. Request accepted for processing" } 
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- 6. Server Listener ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Badrat Cafee Backend running on port ${PORT}`);
});