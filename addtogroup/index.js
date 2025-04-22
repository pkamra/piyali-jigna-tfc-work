const { CognitoIdentityProviderClient, AdminAddUserToGroupCommand } = require("@aws-sdk/client-cognito-identity-provider");
const cognitoClient = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION });


exports.handler = async (event) => {
  console.log('PostConfirmation Event:', JSON.stringify(event, null, 2));

  const userPoolId = event.userPoolId;
  const userName = event.userName;
  const group = event.request.clientMetadata?.group; // Extract group from validation data

  // Ensure group is provided
  if (!group) {
    console.error('No group provided during signup.');
    return event;
  }

  try {
    const command = new AdminAddUserToGroupCommand({
      GroupName: group,
      UserPoolId: userPoolId,
      Username: userName,
    });

    await cognitoClient.send(command);
    console.log(`✅ User ${userName} added to group ${group}`);
  } catch (error) {
    console.error("❌ Error adding user to group:", error);
    throw error;
  }

  return event;
};
