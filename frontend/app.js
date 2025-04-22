const apiUrl = 'https://xx.execute-api.us-west-2.amazonaws.com/prod/invoke-lambda'; // Replace <API_ENDPOINT> with the API Gateway URL
const userPoolId = 'us-west-2_xx'; // Replace with your Cognito User Pool ID
const clientId = 'zzzzvnd52vhtouc1xxxx'; // Replace with your Cognito App Client ID
const region = 'us-west-2'; // Replace with your AWS region
let idToken = null;

// Switch to Sign-Up section
document.getElementById('switch-to-signup').addEventListener('click', () => {
  document.getElementById('login-section').style.display = 'none';
  document.getElementById('signup-section').style.display = 'block';
});

// Switch to Login section
document.getElementById('switch-to-login').addEventListener('click', () => {
  document.getElementById('signup-section').style.display = 'none';
  document.getElementById('login-section').style.display = 'block';
});

// Handle user sign-up
document.getElementById('signup-button').addEventListener('click', async () => {
  const email = document.getElementById('signup-email').value;
  const password = document.getElementById('signup-password').value;
  const group = document.getElementById('signup-group').value;

  // Retrieve custom attribute(s); for example, LOB.
  const lob = document.getElementById('signup-lob').value;

  // Input validation
  if (!email || !password || !group || !lob) {
    alert('Please fill out all fields including your Line of Business.');
    return;
  }

  // Sign-up with Cognito
  try {
    const response = await fetch(`https://cognito-idp.${region}.amazonaws.com/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'AWSCognitoIdentityProviderService.SignUp',
      },
      body: JSON.stringify({
        ClientId: clientId,
        Username: email,
        Password: password,
        UserAttributes: [
          { Name: 'email', Value: email },
          { Name: 'custom:lob', Value: lob } ,// Pass the custom LOB attribute. 
          // { Name: 'group', Value: group },
        ],
        // ValidationData: [
        //   { Name: 'group', Value: group }, // Pass group as metadata, not as a custom attribute
        // ],
        ClientMetadata: { group }, // ✅ ONLY HERE
      }),
    });

    const data = await response.json();
    if (data.UserConfirmed) {
      alert('Sign-up successful! Please log in.');
      document.getElementById('signup-section').style.display = 'none';
      document.getElementById('login-section').style.display = 'block';
    } else {
      alert('Sign-up successful! Please check your email to confirm your account.');
    }
  } catch (error) {
    console.error('Error signing up:', error);
    alert('Sign-up failed. Please try again.');
  }
});

// Handle user login
document.getElementById('login-button').addEventListener('click', async () => {
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;

  if (!username || !password) {
    alert('Please enter both email and password.');
    return;
  }

  try {
    const response = await fetch(`https://cognito-idp.${region}.amazonaws.com/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth',
      },
      body: JSON.stringify({
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: clientId,
        AuthParameters: {
          USERNAME: username,
          PASSWORD: password,
        },
      }),
    });

    const data = await response.json();
    if (data.AuthenticationResult) {
      idToken = data.AuthenticationResult.IdToken;
      document.getElementById('login-section').style.display = 'none';
      document.getElementById('chat-section').style.display = 'block';
    } else {
      alert('Login failed. Please check your credentials.');
    }
  } catch (error) {
    console.error('Error logging in:', error);
    alert('Login failed. Please try again.');
  }
});

// Send message
document.getElementById('send-button').addEventListener('click', async () => {
  const question = document.getElementById('question-input').value;

  if (!idToken) {
    alert('You must log in first.');
    return;
  }

  if (!question) {
    alert('Please enter a question.');
    return;
  }

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ question }),
    });

    const data = await response.json();
    if (response.ok) {
      const messages = document.getElementById('messages');
      messages.innerHTML += `<div><strong>You:</strong> ${question}</div>`;
      messages.innerHTML += `<div><strong>Bot:</strong> ${data.message} (User ID: ${data.userId})</div>`;
      document.getElementById('question-input').value = '';
    } else {
      alert('Failed to send message. Please try again.');
    }
  } catch (error) {
    console.error('Error sending message:', error);
    alert('Failed to send message. Please try again.');
  }
});
