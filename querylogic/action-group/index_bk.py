import os
import json
import boto3

def lambda_handler(event, context):
    """
    Lambda function to query the Bedrock Knowledge Base.

    Supports two invocation styles:
    1) Direct API Gateway payload:
       { "question": "...", "userRole": "...", "lob": "..." }
    2) Bedrock Agent Runtime payload, which embeds
       your slots in event['requestBody'].content['application/json'].properties.

    Environment Variables:
      - KNOWLEDGE_BASE_ID: the ID of your Bedrock KB
      - MODEL_ARN (optional): ARN of the Bedrock model (defaults to anthropic.claude-v2)
    """
    # === 1) Unwrap the incoming body ===
    # Bedrock Agent pattern:
    if 'requestBody' in event and isinstance(event.get('requestBody'), dict):
        props = (
            event['requestBody']
                 .get('content', {})
                 .get('application/json', {})
                 .get('properties', [])
        )
        # turn [{name,value},…] into {"name":value,…}
        body = { p['name']: p['value'] for p in props if 'name' in p and 'value' in p }
    else:
        # direct API Gateway
        raw = event.get('body') or event
        if isinstance(raw, str):
            try:
                body = json.loads(raw)
            except json.JSONDecodeError:
                return {
                    "statusCode": 400,
                    "body": json.dumps({"error": "Invalid JSON body"})
                }
        else:
            body = raw

    # === 2) Extract and validate ===

    question  = body.get('question')
    # user_role = body.get('userRole')
    lob       = body.get('lob')

    print(f"Body:: {body}")
    print(f"Event:: {event}")
    if not (question  and lob):
        return {
            "statusCode": 400,
            "body": json.dumps({
                "error": "Missing required fields. Provide 'question',  and 'lob'."
            })
        }

    # === 3) Env vars & Bedrock client ===
    knowledge_base_id = os.environ.get("KNOWLEDGE_BASE_ID")
    if not knowledge_base_id:
        return {
            "statusCode": 500,
            "body": json.dumps({"error": "KNOWLEDGE_BASE_ID not set"})
        }

    model_arn = os.environ.get(
        "MODEL_ARN",
        "arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-v2:1"
    )

    bedrock_agent = boto3.client("bedrock-agent-runtime")

    # === 4) Call retrieve_and_generate ===
    try:
        resp = bedrock_agent.retrieve_and_generate(
            input={"text": question},
            retrieveAndGenerateConfiguration={
                "type": "KNOWLEDGE_BASE",
                "knowledgeBaseConfiguration": {
                    "knowledgeBaseId": knowledge_base_id,
                    "modelArn": model_arn,
                    "retrievalConfiguration": {
                        "vectorSearchConfiguration": {
                            "numberOfResults": 100,
                            "filter": {
                                "equals": {
                                    "key": "lob",
                                    "value": lob
                                }
                            }
                        }
                    }
                }
            }
        )
    except Exception as e:
        print(e)
        return {
            "statusCode": 500,
            "body": json.dumps({
                "error": "Error querying the knowledge base",
                "details": str(e)
            })
        }
    print(f"Response:: {resp}")
    generated_text = resp['output']['text']
    print(f"Generated response: {generated_text}")

    # Build response
    response_body = {
        "application/json": {
            "body": json.dumps({
                "answer": generated_text
            })
        }
    }

    return {
        "messageVersion": "1.0",
        "response": {
            "actionGroup": event.get("actionGroup", ""),
            "apiPath": event.get("apiPath", ""),
            "httpMethod": event.get("httpMethod", ""),
            "httpStatusCode": 200,
            "responseBody": response_body
        },
        "sessionAttributes": event.get("sessionAttributes", {}),
        "promptSessionAttributes": event.get("promptSessionAttributes", {})
    }
