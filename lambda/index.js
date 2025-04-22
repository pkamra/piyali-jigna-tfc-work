const { VerifiedPermissionsClient, IsAuthorizedWithTokenCommand } = require('@aws-sdk/client-verifiedpermissions');
const { BedrockAgentRuntimeClient, InvokeAgentCommand } = require('@aws-sdk/client-bedrock-agent-runtime');
const { v4: uuidv4 } = require('uuid');
const { TextDecoder } = require('util');

// Helper: Decode JWT token
function decodeJwt(token) {
    const payload = token.split('.')[1];
    const decoded = Buffer.from(payload, 'base64').toString('utf-8');
    return JSON.parse(decoded);
}
exports.handler = async (event) => {
    try {

        console.log('Received event:', JSON.stringify(event, null, 2));
        // Extract the Authorization header
        const authorizationHeader = event.headers.Authorization || event.headers.authorization;
        if (!authorizationHeader) {
            throw new Error('Authorization header is missing');
        }



        // Extract the Access Token
        const idToken = authorizationHeader.split(' ')[1]; // Bearer <token>


        // Ensure the token is valid
        if (!idToken) {
            throw new Error('AccessToken is missing');
        }
        console.log("idToken :: ",idToken)
        const decoded = decodeJwt(idToken);
        console.log("🧾 Decoded ID token:", JSON.stringify(decoded, null, 2));
        console.log("👥 Groups:", decoded["cognito:groups"]);
        console.log("🏷️  LOB (raw):", decoded["custom:lob"]);

        // 3) Parse user’s custom:lob into an array (JSON or comma-delimited)
        let userLobs = [];
        const rawLob = decoded["custom:lob"] || "";
        try {
        const maybeParsed = JSON.parse(rawLob);
        if (Array.isArray(maybeParsed)) {
            userLobs = maybeParsed;       // e.g. ["MarketResearch","Investments"]
        } else {
            // If it was a single string in JSON
            userLobs = [maybeParsed];
        }
        } catch (err) {
        // fallback: comma-separated or single
        userLobs = rawLob.split(",").map(s => s.trim()).filter(Boolean);
        // e.g. ["Investments","Market Research"]
        }
        console.log("Parsed user LOB array:", userLobs);

        // Initialize Verified Permissions client
        const client = new VerifiedPermissionsClient({});
        const policyStoreId = process.env.POLICY_STORE_ID; // Set your Policy Store ID as an environment variable

        // Define the action and resource for authorization
        const action = {
            actionType: 'ChatApplication::Action',
            actionId: 'View', // Replace with your action ID
        };

        const resource = {
            entityType: 'ChatApplication::Document',
            entityId: 'virtual_doc123', // Replace with your resource ID
        };


        let finalDecision = "ALLOW";   // We want *all* to be ALLOW
        for (const oneUserLob of userLobs) {
            console.log("🔁 Checking AVP with resource lineOfBusiness =", oneUserLob);
          
            // Call IsAuthorizedWithTokenCommand
            const command = new IsAuthorizedWithTokenCommand({
                policyStoreId,
                identityToken: idToken, // Pass the Access Token
                action,
                resource,
                entities: {
                    entityList: [
                    {
                        identifier: {
                        entityType: "ChatApplication::Document",
                        entityId: "virtual_doc123"
                        },
                        attributes: {
                        lineOfBusiness: {
                            string: oneUserLob
                        }
                        }
                    }
                    ]
                }
            });

            const response = await client.send(command);
            console.log("AVP Decision for resource LOB:", oneUserLob, "=", response.decision);
            if (response.decision !== "ALLOW") {
              // If *any* iteration yields DENY, the final is DENY
              finalDecision = "DENY";
              // We do *not* break; we keep going to check them all
            }
        }

        // Check the decision and return appropriate response
        if (finalDecision === 'ALLOW') {
            // then invoke the bedrock agent with the correct prompt in which you specify the user's group who is 
            // asking the question as well as the resource lob/lobs which will be eventually passed to set up
            // filters for the KB resources.
            // return the final answer

            // Parse question from request body
            let body = event.body;
            if (typeof body === 'string') body = JSON.parse(body);
            const question = body.question;
            if (!question) {
                return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Missing "question" in request body' })
                };
            }

            // Build prompt
            const groups = decoded["cognito:groups"] || [];
            const prompt = [
                `Question: ${question}`,
                `Role: ${groups.join(',')}`,
                `LOB: ${userLobs.join(',')}`
            ].join('--') + '\n\n';

            // Invoke Bedrock agent
            const agentClient = new BedrockAgentRuntimeClient({ region: process.env.AWS_REGION });
            const sessionId = uuidv4();
            const invokeCmd = new InvokeAgentCommand({
                agentId: process.env.BEDROCK_AGENT_ID,
                agentAliasId: process.env.BEDROCK_AGENT_ALIAS_ID,
                sessionId,
                inputText: prompt,
                enableTrace: true,
                endSession: true
            });
            const invokeRes = await agentClient.send(invokeCmd);

            // **Fixed**: iterate the right array
            let answer = '';
            if (Array.isArray(invokeRes.events)) {
                // pattern #1
                for (const ev of invokeRes.events) {
                const bytes = ev.event?.chunk?.bytes;
                if (bytes) {
                    answer += new TextDecoder().decode(bytes);
                }
                }
            } else {
                // pattern #2
                for (const chunk of invokeRes.completion?.chunks || []) {
                answer += new TextDecoder().decode(chunk.bytes);
                }
            }
            answer = answer.trim();

            return {
                statusCode: 200,
                body: JSON.stringify({ message: 'Access granted', details: finalDecision }),
            };
        } else {
            return {
                statusCode: 403,
                body: JSON.stringify({ message: 'Access denied', details: finalDecision }),
            };
        }
    } catch (error) {
        console.error('Error:', error.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Internal server error', error: error.message }),
        };
    }
};
