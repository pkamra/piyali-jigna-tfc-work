exports.handler = async (event) => {
  console.log('PreSignUp Event:', JSON.stringify(event, null, 2));



  // Auto-confirm the user
  event.response.autoConfirmUser = true;
  event.response.autoVerifyEmail = true; // Auto-verify email if it's provided
  // event.response.autoVerifyPhone = true;

  console.log('PreSignUp Event Returned:', JSON.stringify(event, null, 2));
  return event; // Pass the event back to Cognito
};
