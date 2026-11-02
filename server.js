const express = require('express');
const mongoose = require('mongoose');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Configure Multer for temporary local storage before cloud upload
const upload = multer({ dest: 'uploads/' });

// Connect to MongoDB Atlas
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB Atlas Connected Successfully to Badrat Database'))
  .catch(err => {
    console.error('❌ MongoDB Connection Error:', err.message);
    process.exit(1);
  });

// --- SCHEMAS ---

// 1. Terminal Schema
const terminalSchema = new mongoose.Schema({
  terminalId: { type: String, required: true, unique: true },
  tier: { type: String, enum: ['Standard', 'Pro Gaming', 'VIP Streamer'], required: true },
  status: { type: String, enum: ['Available', 'Occupied', 'Maintenance'], default: 'Available' },
  currentUser: { type: String, default: null },
  sessionStartTime: { type: Date, default: null }
});
const Terminal = mongoose.model('Terminal', terminalSchema);

// 2. Gallery / Published Pictures Schema
const gallerySchema = new mongoose.Schema({
  title: { type: String, required: true },
  category: { type: String, default: 'General' },
  imageUrl: { type: String, required: true },
  publicId: { type: String },
  createdAt: { type: Date, default: Date.now }
});
const GalleryItem = mongoose.model('GalleryItem', gallerySchema);

// 3. Customer Orders & Requests Schema
const orderSchema = new mongoose.Schema({
  customerName: { type: String, required: true },
  serviceType: { type: String, required: true }, // e.g., Printing, Scanning, Gaming, Snack Bar
  details: { type: String, required: true },
  status: { type: String, enum: ['Pending', 'In Progress', 'Completed', 'Cancelled'], default: 'Pending' },
  adminReply: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});
const Order = mongoose.model('Order', orderSchema);


// --- API ROUTES ---

// System Health Check
app.get('/api/status', async (req, res) => {
  try {
    const dbState = mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected';
    res.json({
      success: true,
      service: 'Badrat Cafee API',
      status: 'Operational',
      mongodb: dbState,
      cloudinary: process.env.CLOUDINARY_CLOUD_NAME ? 'Configured' : 'Pending'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Terminals Routes
app.get('/api/terminals', async (req, res) => {
  try {
    let terminals = await Terminal.find();
    if (terminals.length === 0) {
      const initialTerminals = [];
      for (let i = 1; i <= 16; i++) {
        initialTerminals.push({
          terminalId: `PC-${i < 10 ? '0' + i : i}`,
          tier: i <= 8 ? 'Standard' : i <= 14 ? 'Pro Gaming' : 'VIP Streamer',
          status: 'Available'
        });
      }
      terminals = await Terminal.insertMany(initialTerminals);
    }
    res.json({ success: true, terminals });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/terminals/book', async (req, res) => {
  try {
    const { terminalId, status, currentUser } = req.body;
    const terminal = await Terminal.findOneAndUpdate(
      { terminalId },
      { 
        status, 
        currentUser: currentUser || null,
        sessionStartTime: status === 'Occupied' ? new Date() : null 
      },
      { new: true, upsert: true }
    );
    res.json({ success: true, message: `Terminal ${terminalId} updated`, terminal });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Gallery & Picture Posting Routes (Multer + Cloudinary)
app.get('/api/gallery', async (req, res) => {
  try {
    const items = await GalleryItem.find().sort({ createdAt: -1 });
    res.json({ success: true, items });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/gallery/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image file provided' });
    }

    // Upload to Cloudinary
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: 'badrat_gallery'
    });

    const newItem = new GalleryItem({
      title: req.body.title || 'Untitled Exhibit',
      category: req.body.category || 'General',
      imageUrl: result.secure_url,
      publicId: result.public_id
    });

    await newItem.save();
    res.json({ success: true, message: 'Picture published successfully', item: newItem });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Customer Orders & Admin Reply Routes
app.get('/api/orders', async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    res.json({ success: true, orders });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    const { customerName, serviceType, details } = req.body;
    const newOrder = new Order({ customerName, serviceType, details });
    await newOrder.save();
    res.json({ success: true, message: 'Order submitted successfully', order: newOrder });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/orders/:id/reply', async (req, res) => {
  try {
    const { status, adminReply } = req.body;
    const updatedOrder = await Order.findByIdAndUpdate(
      req.params.id,
      { status, adminReply },
      { new: true }
    );
    res.json({ success: true, message: 'Order updated & replied', order: updatedOrder });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 Badrat Cafee backend running on port ${PORT}`);
});
// 4. M-Pesa Transaction Schema
const mpesaTransactionSchema = new mongoose.Schema({
  phoneNumber: { type: String, required: true },
  amount: { type: Number, required: true },
  merchantRequestID: { type: String },
  checkoutRequestID: { type: String },
  mpesaReceiptNumber: { type: String, default: null },
  status: { type: String, enum: ['Pending', 'Success', 'Failed'], default: 'Pending' },
  createdAt: { type: Date, default: Date.now }
});
const MpesaTransaction = mongoose.model('MpesaTransaction', mpesaTransactionSchema);

// Helper function to generate Safaricom Daraja OAuth Token
async function getAccessToken(req, res, next) {
  const consumerKey = process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');

  try {
    const response = await fetch('https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
      method: 'GET',
      headers: { Authorization: `Basic ${auth}` }
    });
    const data = await response.json();
    req.token = data.access_token;
    next();
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to generate M-Pesa access token' });
  }
}

// 5. STK Push Payment Route
app.post('/api/mpesa/stkpush', getAccessToken, async (req, res) => {
  const { phone, amount } = req.body; // phone format: 2547XXXXXXXX
  
  const shortCode = process.env.MPESA_SHORTCODE;
  const passKey = process.env.MPESA_PASSKEY;
  const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, -3);
  const password = Buffer.from(`${shortCode}${passKey}${timestamp}`).toString('base64');

  const url = 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest';

  const payload = {
    BusinessShortCode: shortCode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: amount,
    PartyA: phone,
    PartyB: shortCode,
    PhoneNumber: phone,
    CallBackURL: process.env.MPESA_CALLBACK_URL || 'https://mydomain.com/api/mpesa/callback',
    AccountReference: 'Badrat Cafee',
    TransactionDesc: 'Terminal Session Payment'
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${req.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (data.ResponseCode === "0") {
      // Save pending transaction to MongoDB Atlas
      const transaction = new MpesaTransaction({
        phoneNumber: phone,
        amount: amount,
        merchantRequestID: data.MerchantRequestID,
        checkoutRequestID: data.CheckoutRequestID,
        status: 'Pending'
      });
      await transaction.save();
    }

    res.json({ success: true, mpesaResponse: data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 6. M-Pesa Callback Endpoint (Receives payment status from Safaricom)
app.post('/api/mpesa/callback', async (req, res) => {
  try {
    const callbackData = req.body.Body.stkCallback;
    const checkoutRequestID = callbackData.CheckoutRequestID;
    const resultCode = callbackData.ResultCode;

    const transaction = await MpesaTransaction.findOne({ checkoutRequestID });
    if (!transaction) {
      return res.json({ result: 'Transaction not found' });
    }

    if (resultCode === 0) {
      // Payment Successful
      const items = callbackData.CallbackMetadata.Item;
      const receiptItem = items.find(i => i.Name === 'MpesaReceiptNumber');
      
      transaction.status = 'Success';
      transaction.mpesaReceiptNumber = receiptItem ? receiptItem.Value : 'N/A';
      await transaction.save();
    } else {
      // Payment Failed or Cancelled by User
      transaction.status = 'Failed';
      await transaction.save();
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
// Add these schemas and middleware in your server.js

const itemSchema = new mongoose.Schema({
  name: { type: String, required: true },
  category: { type: String, required: true },
  price: { type: Number, required: true },
  description: String,
  image: String,
  createdAt: { type: Date, default: Date.now }
});
const Item = mongoose.model('Item', itemSchema);

// Admin Authentication Middleware
const verifyAdmin = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Access denied. No token provided.' });
  }
  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Access denied. Requires admin privileges.' });
    }
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ success: false, error: 'Invalid or expired token.' });
  }
};

// 1. Admin Login Route
app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;
  // Use environment variables for admin credentials securely
  const adminUser = process.env.ADMIN_USER || 'admin';
  const adminPass = process.env.ADMIN_PASSWORD || 'badrat2026!';

  if (username === adminUser && password === adminPass) {
    const token = jwt.sign({ username: adminUser, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '12h' });
    return res.json({ success: true, token, message: 'Admin login successful' });
  }
  res.status(401).json({ success: false, error: 'Invalid admin credentials' });
});

// 2. Protected M-Pesa STK Push Route (Admin Only)
app.post('/api/mpesa/stkpush', verifyAdmin, async (req, res) => {
  // Your existing Daraja STK Push logic here...
});

// 3. Public Item Fetch Route
app.get('/api/items', async (req, res) => {
  try {
    const items = await Item.find().sort({ createdAt: -1 });
    res.json({ success: true, items });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Protected Item Create Route (Admin Only)
app.post('/api/items', verifyAdmin, async (req, res) => {
  try {
    const newItem = new Item(req.body);
    await newItem.save();
    res.json({ success: true, item: newItem, message: 'Item created successfully' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 5. Protected Item Delete Route (Admin Only)
app.delete('/api/items/:id', verifyAdmin, async (req, res) => {
  try {
    const deletedItem = await Item.findByIdAndDelete(req.params.id);
    if (!deletedItem) return res.status(404).json({ success: false, error: 'Item not found' });
    res.json({ success: true, message: 'Item deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
// Admin Login Route in server.js
app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;
  
  // Updated credentials: BADRAT and Password$1
  const adminUser = process.env.ADMIN_USER || 'BADRAT';
  const adminPass = process.env.ADMIN_PASSWORD || 'Password$1';

  if (username === adminUser && password === adminPass) {
    const token = jwt.sign(
      { username: adminUser, role: 'admin' }, 
      process.env.JWT_SECRET, 
      { expiresIn: '12h' }
    );
    return res.json({ success: true, token, message: 'Admin login successful' });
  }
  
  res.status(401).json({ success: false, error: 'Invalid admin credentials' });
});