require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const jwt = require('jsonwebtoken');

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_key';

// --- Admin Login Route ---
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  const adminUser = process.env.ADMIN_USER || 'BADRAT';
  const adminPass = process.env.ADMIN_PASSWORD || 'Password$1';

  if (username === adminUser && password === adminPass) {
    const token = jwt.sign({ username: adminUser, role: 'admin' }, JWT_SECRET, { expiresIn: '12h' });
    return res.json({ success: true, token, message: 'Admin login successful' });
  }
  return res.status(401).json({ success: false, error: 'Invalid admin credentials' });
});

// --- Middleware: Verify Admin JWT ---
function verifyAdminToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ success: false, error: 'Access denied. No token provided.' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ success: false, error: 'Invalid or expired token.' });
    }
    req.user = user;
    next();
  });
}

// --- Helper: Generate M-Pesa Access Token with Base64 Encoding ---
async function getMpesaAccessToken() {
  const consumerKey = process.env.MPESA_CONSUMER_KEY;
  const consumerSecret = process.env.MPESA_CONSUMER_SECRET;

  if (!consumerKey || !consumerSecret) {
    throw new Error('M-Pesa Consumer Key or Secret missing in environment variables');
  }

  // Combine key and secret and convert to Base64
  const credentials = `${consumerKey.trim()}:${consumerSecret.trim()}`;
  const auth = Buffer.from(credentials).toString('base64');
  
  const url = 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials';

  try {
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Basic ${auth}`
      }
    });
    return response.data.access_token;
  } catch (error) {
    console.error('M-Pesa OAuth Error Response:', error.response?.data || error.message);
    throw new Error('Failed to generate M-Pesa access token from Safaricom');
  }
}

// --- M-Pesa STK Push Route ---
app.post('/api/mpesa/stkpush', verifyAdminToken, async (req, res) => {
  try {
    const { phone, amount } = req.body;
    
    if (!phone || !amount) {
      return res.status(400).json({ success: false, error: 'Phone number and amount are required' });
    }

    // Format phone number to 2547XXXXXXXX
    let formattedPhone = phone.toString().trim();
    if (formattedPhone.startsWith('0')) {
      formattedPhone = '254' + formattedPhone.slice(1);
    } else if (formattedPhone.startsWith('+')) {
      formattedPhone = formattedPhone.slice(1);
    }

    // Fetch fresh OAuth Access Token
    const accessToken = await getMpesaAccessToken();

    const shortCode = process.env.MPESA_SHORTCODE || '174379';
    const passKey = process.env.MPESA_PASSKEY || 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919';
    
    // Generate Timestamp
    const date = new Date();
    const timestamp = date.getFullYear() +
      String(date.getMonth() + 1).padStart(2, '0') +
      String(date.getDate()).padStart(2, '0') +
      String(date.getHours()).padStart(2, '0') +
      String(date.getMinutes()).padStart(2, '0') +
      String(date.getSeconds()).padStart(2, '0');

    // Generate Password
    const password = Buffer.from(shortCode + passKey + timestamp).toString('base64');
    const stkUrl = 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest';

    const payload = {
      BusinessShortCode: shortCode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Number(amount),
      PartyA: formattedPhone,
      PartyB: shortCode,
      PhoneNumber: formattedPhone,
      CallBackURL: 'https://badrat-cafee-api.onrender.com/api/mpesa/callback',
      AccountReference: 'BadratCafee',
      TransactionDesc: 'Payment for order at Badrat Cafee'
    };

    const response = await axios.post(stkUrl, payload, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    return res.json({ success: true, data: response.data });
  } catch (error) {
    console.error('STK Push API Error:', error.response?.data || error.message);
    return res.status(500).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Badrat Cafee backend running on port ${PORT}`);
});