require('dotenv').config();

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');

const app = express();

// ==================================================
// 1. CONFIGURATION
// ==================================================

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_USER = process.env.ADMIN_USER || 'BADRAT';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const MPESA_ENV = process.env.MPESA_ENV || 'sandbox';
const MPESA_BASE_URL =
  MPESA_ENV === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';

const RENDER_BACKEND_URL = (
  process.env.RENDER_BACKEND_URL || 'https://badrat-cafee.onrender.com'
).replace(/\/+$/, '');

const CALLBACK_URL =
  process.env.MPESA_CALLBACK_URL ||
  `${RENDER_BACKEND_URL}/api/mpesa/callback`;

const allowedOrigins = [
  process.env.CLIENT_URL,
  process.env.VERCEL_FRONTEND_URL,
  ...(process.env.FRONTEND_URL || '').split(',')
]
  .filter(Boolean)
  .map((url) => url.trim().replace(/\/+$/, ''));

app.use(express.json({ limit: '2mb' }));

app.use(
  cors({
    origin(origin, callback) {
      // Permit server-to-server requests and configured browser origins.
      if (
        !origin ||
        allowedOrigins.length === 0 ||
        allowedOrigins.includes(origin.replace(/\/+$/, ''))
      ) {
        return callback(null, true);
      }

      return callback(
        new Error('This website is not allowed to access the API.')
      );
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  })
);

// ==================================================
// 2. CLOUDINARY CONFIGURATION
// ==================================================

if (
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter(req, file, callback) {
    if (!file.mimetype.startsWith('image/')) {
      return callback(new Error('Only image files are allowed.'));
    }

    callback(null, true);
  }
});

function uploadBufferToCloudinary(buffer) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'badrat-cafee' },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );

    stream.end(buffer);
  });
}

// ==================================================
// 3. MONGODB ATLAS CONNECTION
// ==================================================

async function connectDatabase() {
  const mongoUri = process.env.MONGO_URI;

  if (!mongoUri) {
    throw new Error(
      'MONGO_URI is missing from your environment variables.'
    );
  }

  await mongoose.connect(mongoUri);
  console.log('MongoDB Atlas connected successfully.');
}

// ==================================================
// 4. PAYMENT MODEL
// ==================================================

const paymentSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true },
    amount: { type: Number, required: true },
    orderId: { type: String, default: null },
    merchantRequestId: String,
    checkoutRequestId: {
      type: String,
      unique: true,
      sparse: true
    },
    mpesaReceiptNumber: { type: String, default: null },
    status: {
      type: String,
      enum: ['initiating', 'pending', 'success', 'failed'],
      default: 'initiating',
      index: true
    },
    resultCode: Number,
    resultDescription: String,
    transactionDate: Date,
    callbackReceivedAt: Date
  },
  { timestamps: true }
);

const Payment =
  mongoose.models.BadratPayment ||
  mongoose.model('BadratPayment', paymentSchema);

// ==================================================
// 5. CUSTOMER ORDERS, TERMINALS AND INVENTORY MODELS
// ==================================================

const orderSchema = new mongoose.Schema(
  {
    customerName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100
    },
    serviceType: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80
    },
    details: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000
    },
    status: {
      type: String,
      enum: ['New', 'In Progress', 'Completed', 'Cancelled'],
      default: 'New',
      index: true
    }
  },
  { timestamps: true }
);

const Order =
  mongoose.models.BadratOrder ||
  mongoose.model('BadratOrder', orderSchema);

const terminalSchema = new mongoose.Schema(
  {
    terminalId: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    tier: {
      type: String,
      default: 'Standard',
      trim: true
    },
    status: {
      type: String,
      enum: ['Available', 'Occupied', 'Maintenance'],
      default: 'Available'
    },
    currentUser: {
      type: String,
      default: ''
    }
  },
  { timestamps: true }
);

const Terminal =
  mongoose.models.BadratTerminal ||
  mongoose.model('BadratTerminal', terminalSchema);

const itemSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120
    },
    category: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80
    },
    price: {
      type: Number,
      required: true,
      min: 0
    },
    description: {
      type: String,
      default: '',
      trim: true,
      maxlength: 1000
    },
    imageUrl: {
      type: String,
      default: ''
    },
    imagePublicId: {
      type: String,
      default: ''
    }
  },
  { timestamps: true }
);

const Item =
  mongoose.models.BadratItem ||
  mongoose.model('BadratItem', itemSchema);
  // ==================================================
// 5. HEALTH CHECKS
// ==================================================

app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Badrat Cafee API is running'
  });
});

app.get('/health', (req, res) => {
  const connected = mongoose.connection.readyState === 1;
  res.status(connected ? 200 : 503).json({
    success: connected,
    server: 'online',
    database: connected ? 'connected' : 'disconnected'
  });
});

// ==================================================
// 6. ADMIN LOGIN
// ==================================================

app.post('/api/admin/login', (req, res) => {
  try {
    if (!JWT_SECRET || !ADMIN_PASSWORD) {
      return res.status(503).json({
        success: false,
        error: 'Admin authentication is not configured.'
      });
    }

    const { username, password } = req.body || {};

    if (
      typeof username !== 'string' ||
      typeof password !== 'string' ||
      !username.trim() ||
      !password
    ) {
      return res.status(400).json({
        success: false,
        error: 'Username and password are required.'
      });
    }

    if (username.trim() !== ADMIN_USER || password !== ADMIN_PASSWORD) {
      return res.status(401).json({
        success: false,
        error: 'Invalid admin credentials.'
      });
    }

    const token = jwt.sign(
      { username: ADMIN_USER, role: 'admin' },
      JWT_SECRET,
      { expiresIn: '12h' }
    );

    return res.json({
      success: true,
      token,
      message: 'Admin login successful'
    });
  } catch (error) {
    console.error('Admin login error:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Login failed.'
    });
  }
});

// ==================================================
// 7. ADMIN AUTHENTICATION
// ==================================================

function verifyAdminToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'Admin authorization required.'
    });
  }

  if (!JWT_SECRET) {
    return res.status(503).json({
      success: false,
      error: 'Authentication is not configured.'
    });
  }

  jwt.verify(authHeader.substring(7), JWT_SECRET, (error, user) => {
    if (error || !user || user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Invalid or expired token.'
      });
    }

    req.user = user;
    next();
  });
}

// ==================================================
// CUSTOMER ORDERS
// ==================================================

app.post('/api/orders', async (req, res) => {
  try {
    const { customerName, serviceType, details } = req.body || {};

    if (
      typeof customerName !== 'string' || !customerName.trim() ||
      typeof serviceType !== 'string' || !serviceType.trim() ||
      typeof details !== 'string' || !details.trim()
    ) {
      return res.status(400).json({
        success: false,
        error: 'Name, service type and order details are required.'
      });
    }

    const order = await Order.create({
      customerName: customerName.trim(),
      serviceType: serviceType.trim(),
      details: details.trim()
    });

    return res.status(201).json({
      success: true,
      message: 'Your service request has been submitted.',
      order: {
        id: order._id,
        status: order.status,
        createdAt: order.createdAt
      }
    });
  } catch (error) {
    console.error('Order submission error:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Unable to submit your order. Please try again.'
    });
  }
});

app.get('/api/admin/orders', verifyAdminToken, async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 }).limit(200).lean();
    return res.json({ success: true, orders });
  } catch (error) {
    console.error('Order retrieval error:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Unable to retrieve orders.'
    });
  }
});

// ==================================================
// TERMINAL MATRIX
// ==================================================

app.get('/api/terminals', async (req, res) => {
  try {
    const terminals = await Terminal.find().sort({ terminalId: 1 }).lean();
    return res.json({ success: true, terminals });
  } catch (error) {
    console.error('Terminal retrieval error:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Unable to retrieve terminal availability.'
    });
  }
});

app.post('/api/terminals/book', verifyAdminToken, async (req, res) => {
  try {
    const { terminalId, currentUser, status } = req.body || {};
    const allowedStatuses = ['Available', 'Occupied', 'Maintenance'];

    if (!terminalId || !allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'A valid terminal and status are required.'
      });
    }

    const terminal = await Terminal.findOneAndUpdate(
      { terminalId: String(terminalId) },
      {
        $set: {
          status,
          currentUser: status === 'Occupied' ? String(currentUser || '').trim() : ''
        }
      },
      { new: true, runValidators: true }
    );

    if (!terminal) {
      return res.status(404).json({
        success: false,
        error: 'Terminal not found.'
      });
    }

    return res.json({ success: true, terminal });
  } catch (error) {
    console.error('Terminal update error:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Unable to update terminal.'
    });
  }
});
// ==================================================
// INVENTORY
// ==================================================

app.get('/api/items', async (req, res) => {
  try {
    const items = await Item.find().sort({ createdAt: -1 }).lean();
    return res.json({ success: true, items });
  } catch (error) {
    console.error('Inventory retrieval error:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Unable to retrieve inventory.'
    });
  }
});

app.post(
  '/api/items',
  verifyAdminToken,
  upload.single('image'),
  async (req, res) => {
    try {
      const { name, category, price, description = '' } = req.body || {};
      const numericPrice = Number(price);

      if (
        typeof name !== 'string' || !name.trim() ||
        typeof category !== 'string' || !category.trim() ||
        price === undefined || price === '' ||
        !Number.isFinite(numericPrice) || numericPrice < 0
      ) {
        return res.status(400).json({
          success: false,
          error: 'Item name, category and a valid price are required.'
        });
      }

      let imageUrl = '';
      let imagePublicId = '';

      if (req.file) {
        if (
          !process.env.CLOUDINARY_CLOUD_NAME ||
          !process.env.CLOUDINARY_API_KEY ||
          !process.env.CLOUDINARY_API_SECRET
        ) {
          return res.status(503).json({
            success: false,
            error: 'Image upload is not configured. Add Cloudinary credentials to Render.'
          });
        }

        const uploaded = await uploadBufferToCloudinary(req.file.buffer);
        imageUrl = uploaded.secure_url;
        imagePublicId = uploaded.public_id;
      }

      const item = await Item.create({
        name: name.trim(),
        category: category.trim(),
        price: numericPrice,
        description: String(description).trim(),
        imageUrl,
        imagePublicId
      });

      return res.status(201).json({
        success: true,
        message: 'Item added to inventory.',
        item
      });
    } catch (error) {
      console.error('Item creation error:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Unable to add item.'
      });
    }
  }
);

app.delete('/api/items/:id', verifyAdminToken, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid item ID.'
      });
    }

    const item = await Item.findByIdAndDelete(req.params.id);

    if (!item) {
      return res.status(404).json({
        success: false,
        error: 'Item not found.'
      });
    }

    if (item.imagePublicId && process.env.CLOUDINARY_API_SECRET) {
      await cloudinary.uploader.destroy(item.imagePublicId).catch((error) => {
        console.error('Cloudinary image cleanup failed:', error.message);
      });
    }

    return res.json({ success: true, message: 'Item deleted.' });
  } catch (error) {
    console.error('Item deletion error:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Unable to delete item.'
    });
  }
});

// ==================================================
// 8. CLOUDINARY IMAGE UPLOAD
// ==================================================

app.post(
  '/api/admin/upload',
  verifyAdminToken,
  upload.single('image'),
  async (req, res) => {
    try {
      if (
        !process.env.CLOUDINARY_CLOUD_NAME ||
        !process.env.CLOUDINARY_API_KEY ||
        !process.env.CLOUDINARY_API_SECRET
      ) {
        return res.status(503).json({
          success: false,
          error: 'Cloudinary is not configured.'
        });
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'Choose an image to upload.'
        });
      }

      const result = await uploadBufferToCloudinary(req.file.buffer);

      return res.status(201).json({
        success: true,
        message: 'Image uploaded successfully.',
        image: {
          url: result.secure_url,
          publicId: result.public_id
        }
      });
    } catch (error) {
      console.error('Cloudinary upload error:', error.message);
      return res.status(500).json({
        success: false,
        error: 'Image upload failed.'
      });
    }
  }
);
// ==================================================
// 9. M-PESA ACCESS TOKEN
// ==================================================

async function getMpesaAccessToken() {
  const consumerKey = process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET;

  if (!consumerKey || !consumerSecret) {
    throw new Error('M-Pesa credentials are missing.');
  }

  const auth = Buffer.from(
    `${consumerKey.trim()}:${consumerSecret.trim()}`
  ).toString('base64');

  try {
    const response = await axios.get(
      `${MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
      {
        headers: { Authorization: `Basic ${auth}` },
        timeout: 25000
      }
    );

    if (!response.data || !response.data.access_token) {
      throw new Error('Safaricom did not return an access token.');
    }

    return response.data.access_token;
  } catch (error) {
    console.error(
      'M-Pesa OAuth error:',
      error.response?.data || error.message
    );
    throw new Error('Unable to authenticate with Safaricom.');
  }
}

// ==================================================
// 10. PHONE NUMBER FORMATTING
// ==================================================

function formatPhoneNumber(phone) {
  let number = String(phone).trim().replace(/[\s-]/g, '');

  if (number.startsWith('+')) number = number.substring(1);
  if (number.startsWith('0')) number = `254${number.substring(1)}`;

  if (!/^254[71]\d{8}$/.test(number)) {
    throw new Error('Enter a valid Kenyan M-Pesa phone number.');
  }

  return number;
}

function getNairobiTimestamp() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date());

  const part = (type) => parts.find((item) => item.type === type).value;

  return (
    part('year') +
    part('month') +
    part('day') +
    part('hour') +
    part('minute') +
    part('second')
  );
}

// ==================================================
// 11. M-PESA STK PUSH
// ==================================================

app.post('/api/mpesa/stkpush', verifyAdminToken, async (req, res) => {
  let payment;

  try {
    const { phone, amount, orderId } = req.body || {};

    if (!phone || amount === undefined || amount === null || amount === '') {
      return res.status(400).json({
        success: false,
        error: 'Phone number and amount are required.'
      });
    }

    const numericAmount = Number(amount);

    if (!Number.isSafeInteger(numericAmount) || numericAmount < 1) {
      return res.status(400).json({
        success: false,
        error: 'Enter a valid positive whole-number amount.'
      });
    }

    const formattedPhone = formatPhoneNumber(phone);
    const shortCode = process.env.MPESA_SHORTCODE;
    const passKey = process.env.MPESA_PASSKEY;

    if (!shortCode || !passKey) {
      return res.status(503).json({
        success: false,
        error: 'M-Pesa shortcode or passkey is missing.'
      });
    }

    const timestamp = getNairobiTimestamp();
    const password = Buffer.from(
      `${shortCode}${passKey}${timestamp}`
    ).toString('base64');

    payment = await Payment.create({
      phone: formattedPhone,
      amount: numericAmount,
      orderId: orderId || null,
      status: 'initiating'
    });

    const accessToken = await getMpesaAccessToken();

    const response = await axios.post(
      `${MPESA_BASE_URL}/mpesa/stkpush/v1/processrequest`,
      {
        BusinessShortCode: shortCode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: numericAmount,
        PartyA: formattedPhone,
        PartyB: shortCode,
        PhoneNumber: formattedPhone,
        CallBackURL: CALLBACK_URL,
        AccountReference: 'BADRATCAFE',
        TransactionDesc: 'Badrat Cafee Payment'
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    const data = response.data || {};

    if (data.ResponseCode !== '0' || !data.CheckoutRequestID) {
      throw new Error(
        data.ResponseDescription ||
        data.errorMessage ||
        'Safaricom did not accept the STK request.'
      );
    }

    payment.merchantRequestId = data.MerchantRequestID;
    payment.checkoutRequestId = data.CheckoutRequestID;
    payment.status = 'pending';
    await payment.save();

    return res.json({
      success: true,
      message: 'STK push sent. Ask the customer to check their phone.',
      checkoutRequestId: data.CheckoutRequestID,
      merchantRequestId: data.MerchantRequestID,
      paymentId: payment._id
    });
  } catch (error) {
    console.error(
      'STK push error:',
      error.response?.data || error.message
    );

    if (payment) {
      payment.status = 'failed';
      payment.resultDescription = error.message;
      await payment.save().catch(() => {});
    }

    return res.status(400).json({
      success: false,
      error: error.message || 'Unable to initiate M-Pesa payment.'
    });
  }
});
// ==================================================
// 12. M-PESA CALLBACK
// ==================================================

app.post('/api/mpesa/callback', async (req, res) => {
  try {
    const callback = req.body?.Body?.stkCallback;

    if (!callback || !callback.CheckoutRequestID) {
      return res.status(400).json({
        ResultCode: 1,
        ResultDesc: 'Invalid callback'
      });
    }

    const resultCode = Number(callback.ResultCode);
    const items = callback.CallbackMetadata?.Item || [];

    const getValue = (name) =>
      items.find((item) => item.Name === name)?.Value;

    const receipt = getValue('MpesaReceiptNumber');
    const transactionDate = getValue('TransactionDate');

    const update = {
      status: resultCode === 0 ? 'success' : 'failed',
      resultCode,
      resultDescription: callback.ResultDesc || '',
      callbackReceivedAt: new Date()
    };

    if (receipt) {
      update.mpesaReceiptNumber = receipt;
    }

    if (transactionDate) {
      const match = String(transactionDate).match(
        /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/
      );

      if (match) {
        update.transactionDate = new Date(
          `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}+03:00`
        );
      }
    }

    const payment = await Payment.findOneAndUpdate(
      {
        checkoutRequestId: callback.CheckoutRequestID,
        status: { $ne: 'success' }
      },
      { $set: update },
      { new: true }
    );

    if (!payment) {
      const existing = await Payment.findOne({
        checkoutRequestId: callback.CheckoutRequestID
      });

      if (existing && existing.status === 'success') {
        return res.json({
          ResultCode: 0,
          ResultDesc: 'Callback already processed'
        });
      }

      console.error(
        'Unknown payment callback:',
        callback.CheckoutRequestID
      );

      return res.status(404).json({
        ResultCode: 1,
        ResultDesc: 'Payment record not found'
      });
    }

    console.log('M-Pesa callback processed:', {
      paymentId: payment._id,
      status: payment.status,
      receipt: receipt || null
    });

    return res.json({
      ResultCode: 0,
      ResultDesc: 'Callback processed successfully'
    });

  } catch (error) {
    console.error('M-Pesa callback error:', error.message);

    return res.status(500).json({
      ResultCode: 1,
      ResultDesc: 'Callback processing failed'
    });
  }
});

// ==================================================
// 13. ADMIN PAYMENT HISTORY
// ==================================================

app.get('/api/admin/payments', verifyAdminToken, async (req, res) => {
  try {
    const payments = await Payment.find()
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    return res.json({
      success: true,
      count: payments.length,
      payments
    });

  } catch (error) {
    console.error('Payment history error:', error.message);

    return res.status(500).json({
      success: false,
      error: 'Unable to retrieve payment history.'
    });
  }
});

// ==================================================
// 14. ERROR HANDLING
// ==================================================

app.use((error, req, res, next) => {
  console.error('API error:', error.message);

  if (error instanceof multer.MulterError) {
    return res.status(400).json({
      success: false,
      error: error.message
    });
  }

  return res.status(400).json({
    success: false,
    error: error.message || 'Request failed.'
  });
});

// ==================================================
// 15. START SERVER
// ==================================================

async function startServer() {
  try {
    if (!JWT_SECRET || JWT_SECRET.length < 32) {
      throw new Error(
        'JWT_SECRET must be at least 32 characters.'
      );
    }

    if (!ADMIN_PASSWORD) {
      throw new Error('ADMIN_PASSWORD is missing.');
    }

    await connectDatabase();

    // Create starter terminals only if the collection is empty.
    if (await Terminal.countDocuments() === 0) {
      const starterTerminals = Array.from(
        { length: 8 },
        (_, index) => ({
          terminalId: `PC-${String(index + 1).padStart(2, '0')}`,
          tier: index < 4 ? 'Standard' : 'Gaming',
          status: 'Available',
          currentUser: ''
        })
      );

      await Terminal.insertMany(starterTerminals);

      console.log('Starter terminal records created.');
    }

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Badrat Cafee API running on port ${PORT}`);
      console.log(`M-Pesa environment: ${MPESA_ENV}`);
      console.log(
        `Allowed frontend origins: ${
          allowedOrigins.join(', ') || 'all origins (no origins configured)'
        }`
      );
    });

  } catch (error) {
    console.error('Server startup failed:', error.message);
    process.exit(1);
  }
}

startServer();