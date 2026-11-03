const API_BASE_URL = 'https://badrat-cafee-api.onrender.com';

// 1. Handle Admin Login & Auto-Save Token
async function handleAdminLogin(event) {
  event.preventDefault();
  
  const usernameInput = document.getElementById('usernameInput').value.trim();
  const passwordInput = document.getElementById('passwordInput').value.trim();

  try {
    const response = await fetch(${API_BASE_URL}/api/admin/login, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: usernameInput, password: passwordInput })
    });

    const data = await response.json();

    if (response.ok && data.success) {
      localStorage.setItem('adminToken', data.token);
      alert('Admin login successful! Token saved.');
    } else {
      alert('Login failed: ' + (data.error || 'Invalid credentials'));
    }
  } catch (err) {
    console.error('Login Error:', err);
    alert('Network error connecting to login server.');
  }
}

// 2. Handle M-Pesa STK Push Trigger
async function triggerMpesaPayment() {
  try {
    const phoneInput = document.getElementById('phoneInput').value.trim();
    const amountInput = document.getElementById('amountInput').value.trim();
    const adminToken = localStorage.getItem('adminToken');

    if (!adminToken) {
      alert('Please log in as Admin first to authorize this payment.');
      return;
    }

    if (!phoneInput || !amountInput) {
      alert('Please enter both phone number and amount.');
      return;
    }

    const response = await fetch(${API_BASE_URL}/api/mpesa/stkpush, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': Bearer 
      },
      body: JSON.stringify({ 
        phone: phoneInput, 
        amount: Number(amountInput) 
      })
    });

    const data = await response.json();
    console.log('STK Response:', data);

    if (data.success) {
      alert('STK Push sent successfully! Check your phone.');
    } else {
      alert('Payment failed: ' + (typeof data.error === 'object' ? JSON.stringify(data.error) : data.error));
    }
  } catch (err) {
    console.error('Payment Error:', err);
    alert('Network error connecting to payment server.');
  }
}

// 3. Logout Function
function handleAdminLogout() {
  localStorage.removeItem('adminToken');
  alert('Logged out successfully. Admin token cleared.');
}
