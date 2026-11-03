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
  process.env.RENDER_BACKEND_URL ||
  'https://badrat-cafee.onrender.com'
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
  .map(url => url.trim().replace(/\/+$/, ''));

app.use(express.json({ limit: '2mb' }));

app.use(cors({
  origin(origin, callback) {
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
}));

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
  limits: {
    fileSize: 10 * 1024 * 1024
  },
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
    throw new Error('MONGO_URI is missing from your environment variables.');
  }

  await mongoose.connect(mongoUri);

  console.log('MongoDB Atlas connected successfully.');
}

// ==================================================
// 4. PAYMENT MODEL
// ==================================================

const paymentSchema = new mongoose.Schema(
  {
    phone: {
      type: String,
      required: true
    },

    amount: {
      type: Number,
      required: true
    },

    orderId: {
      type: String,
      default: null
    },

    merchantRequestId: String,

    checkoutRequestId: {
      type: String,
      unique: true,
      sparse: true
    },

    mpesaReceiptNumber: {
      type: String,
      default: null
    },

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
  {
    timestamps: true
  }
);

const Payment =
  mongoose.models.BadratPayment ||
  mongoose.model('BadratPayment', paymentSchema);

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

    if (
      username.trim() !== ADMIN_USER ||
      password !== ADMIN_PASSWORD
    ) {
      return res.status(401).json({
        success: false,
        error: 'Invalid admin credentials.'
      });
    }

    const token = jwt.sign(
      {
        username: ADMIN_USER,
        role: 'admin'
      },
      JWT_SECRET,
      {
        expiresIn: '12h'
      }
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

  jwt.verify(
    authHeader.substring(7),
    JWT_SECRET,
    (error, user) => {
      if (error || !user || user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          error: 'Invalid or expired token.'
        });
      }

      req.user = user;
      next();
    }
  );
}

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
        headers: {
          Authorization: `Basic ${auth}`
        },
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
  let number = String(phone)
    .trim()
    .replace(/[\s-]/g, '');

  if (number.startsWith('+')) {
    number = number.substring(1);
  }

  if (number.startsWith('0')) {
    number = `254${number.substring(1)}`;
  }

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

  const part = type =>
    parts.find(item => item.type === type).value;

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

app.post(
  '/api/mpesa/stkpush',
  verifyAdminToken,
  async (req, res) => {
    let payment;

    try {
      const { phone, amount, orderId } = req.body || {};

      if (
        !phone ||
        amount === undefined ||
        amount === null ||
        amount === ''
      ) {
        return res.status(400).json({
          success: false,
          error: 'Phone number and amount are required.'
        });
      }

      const numericAmount = Number(amount);

      if (
        !Number.isSafeInteger(numericAmount) ||
        numericAmount < 1
      ) {
        return res.status(400).json({
          success: false,
          error: 'Enter a valid positive whole-number amount.'
        });
      }

      const formattedPhone = formatPhoneNumber(phone);

      const shortCode = process.env.MPESA_SHORTCODE;
      const passKey = process.env.MPESA_PASSKEY;

      if (!shortCode || !passKey) {
        throw new Error('M-Pesa shortcode or passkey is missing.');
      }

      if (!CALLBACK_URL.startsWith('https://')) {
        throw new Error('A valid HTTPS M-Pesa callback URL is required.');
      }

      const accessToken = await getMpesaAccessToken();

      const timestamp = getNairobiTimestamp();

      const password = Buffer.from(
        `${shortCode}${passKey}${timestamp}`
      ).toString('base64');

      // Save payment before sending request.

      payment = await Payment.create({
        phone: formattedPhone,
        amount: numericAmount,
        orderId: orderId ? String(orderId) : null,
        status: 'initiating'
      });

      const payload = {
        BusinessShortCode: shortCode,
        Password: password,
        Timestamp: timestamp,

        TransactionType:
          process.env.MPESA_TRANSACTION_TYPE ||
          'CustomerPayBillOnline',

        Amount: numericAmount,
        PartyA: formattedPhone,
        PartyB: shortCode,
        PhoneNumber: formattedPhone,

        CallBackURL: CALLBACK_URL,

        AccountReference: 'BADRATCAFE',
        TransactionDesc: 'Payment for Badrat Cafee order'
      };

      const response = await axios.post(
        `${MPESA_BASE_URL}/mpesa/stkpush/v1/processrequest`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      const data = response.data || {};

      if (String(data.ResponseCode) !== '0') {
        payment.status = 'failed';

        payment.resultDescription =
          data.ResponseDescription || 'STK Push rejected.';

        await payment.save();

        return res.status(400).json({
          success: false,
          error: payment.resultDescription,
          data
        });
      }

      payment.merchantRequestId = data.MerchantRequestID;
      payment.checkoutRequestId = data.CheckoutRequestID;
      payment.status = 'pending';

      await payment.save();

      return res.json({
        success: true,
        message: 'STK Push sent successfully. Check your phone.',
        data,
        paymentId: payment._id,
        status: payment.status
      });

    } catch (error) {
      console.error(
        'STK Push error:',
        error.response?.data || error.message
      );

      // A timeout does not prove that Safaricom rejected
      // the request. Keep uncertain transactions pending.

      if (payment) {
        payment.status = error.response ? 'failed' : 'pending';

        payment.resultDescription = error.message;

        await payment.save().catch(saveError => {
          console.error(
            'Could not update payment record:',
            saveError.message
          );
        });
      }

      return res.status(error.response?.status || 500).json({
        success: false,
        error: error.response?.data || error.message,
        paymentId: payment?._id || null
      });
    }
  }
);

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

    const getValue = name =>
      items.find(item => item.Name === name)?.Value;

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
      {
        $set: update
      },
      {
        new: true
      }
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

app.get(
  '/api/admin/payments',
  verifyAdminToken,
  async (req, res) => {
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
  }
);

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

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Badrat Cafee API running on port ${PORT}`);
      console.log(`M-Pesa environment: ${MPESA_ENV}`);
      console.log(
        `Allowed frontend origins: ${
          allowedOrigins.join(', ') || 'all origins'
        }`
      );
    });

  } catch (error) {
    console.error('Server startup failed:', error.message);
    process.exit(1);
  }
}

startServer();