import os
import json
import boto3

def lambda_handler(event, context):
    """
    Lambda to query Bedrock KB with multi‑LOB support.
    Expects: { "question": "...", "lobs": ["LOB1","LOB2", ...] }
    """
    print("Received event:", json.dumps(event, indent=2))

    # 1) Parse body
    raw = event.get("body") or event
    print("Raw body:", raw)
    if isinstance(raw, str):
        try:
            body = json.loads(raw)
        except json.JSONDecodeError as e:
            print("JSON parse error:", e)
            return {
                "statusCode": 400,
                "body": json.dumps({"error": "Invalid JSON body"})
            }
    else:
        body = raw

    print("Parsed body:", body)
    question = body.get("question")
    lobs     = body.get("lobs", [])

    print(f"Question: {question!r}, LOBs: {lobs}")

    if not question or not isinstance(lobs, list) or not lobs:
        print("Missing required fields")
        return {
            "statusCode": 400,
            "body": json.dumps({
                "error": "Missing required fields. Provide 'question' and a non-empty 'lobs' array."
            })
        }

    # 2) Env & client
    kb_id = os.environ.get("KNOWLEDGE_BASE_ID")
    print("Knowledge Base ID:", kb_id)
    if not kb_id:
        print("Missing KNOWLEDGE_BASE_ID")
        return {
            "statusCode": 500,
            "body": json.dumps({"error": "KNOWLEDGE_BASE_ID not set"})
        }

    model_arn = os.environ.get(
        "MODEL_ARN",
        "arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-v2:1"
    )
    print("Using model ARN:", model_arn)
    bedrock = boto3.client("bedrock-agent-runtime")

    # 3) Build filter
    if len(lobs) == 1:
        filter_expr = { "equals": { "key": "lob", "value": lobs[0] } }
    else:
        filter_expr = { "in": { "key": "lob", "value": lobs } }
    print("Filter expression:", json.dumps(filter_expr))

    # 4) Call retrieve_and_generate
    try:
        resp = bedrock.retrieve_and_generate(
            input={ "text": question },
            retrieveAndGenerateConfiguration={
                "type": "KNOWLEDGE_BASE",
                "knowledgeBaseConfiguration": {
                    "knowledgeBaseId": kb_id,
                    "modelArn": model_arn,
                    "retrievalConfiguration": {
                        "vectorSearchConfiguration": {
                            "numberOfResults": 5,
                            "filter": filter_expr
                        }
                    }
                }
            }
        )
    except Exception as e:
        print("Bedrock API error:", e)
        return {
            "statusCode": 500,
            "body": json.dumps({
                "error": "Error querying the knowledge base",
                "details": str(e)
            })
        }

    print("Raw Bedrock response metadata:", resp.get("ResponseMetadata"))
    answer = resp.get("output", {}).get("text", "")
    print("Extracted answer:", answer)

    # 5) Return
    return {
        "statusCode": 200,
        "body": json.dumps({"answer": answer})
    }
