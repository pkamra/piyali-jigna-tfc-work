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
    # question = body.get("question")
    # lobs     = body.get("lobs", [])

    # after you’ve parsed `body`…
    props = (
        body
        .get("requestBody", {})
        .get("content", {})
        .get("application/json", {})
        .get("properties", [])
    )

    # pull out the two values
    question = None
    raw_lobs = None
    region = None
    for p in props:
        if p.get("name") == "question":
            question = p.get("value")
        elif p.get("name") == "lobs":
            raw_lobs = p.get("value")
        elif p.get("name") == "region":
            region =  p.get("value")

    # now normalize raw_lobs into a Python list
    if raw_lobs is None:
        lobs = []
    else:
        # try JSON first (in case it really was '["A","B"]')
        try:
            parsed = json.loads(raw_lobs)
            lobs = parsed if isinstance(parsed, list) else [parsed]
        except Exception:
            # fallback: strip brackets and comma‐split
            trimmed = raw_lobs.strip("[]")
            lobs = [item.strip() for item in trimmed.split(",") if item.strip()]

    print(f"Question: {question!r}, LOBs: {lobs}, Region: {region!r}")


    if not question or not region or not isinstance(lobs, list) or not lobs:
        print("Missing required fields")
        return {
            "statusCode": 400,
            "body": json.dumps({
                "error": "Missing required fields. Provide 'question' and a 'region' and a non-empty 'lobs' array."
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
        lob_clause = { "equals": { "key": "lob", "value": lobs[0] } }
    else:
        lob_clause = { "in": { "key": "lob", "value": lobs } }

    # 4) Region clause — allow region-specific docs **or** those tagged Global
    region_clause = {
        "equals": { "key": "region", "value": region }   # e.g. "Americas"
    }

    # ---------- combine them ----------
    filter_expr = {
        "andAll": [ lob_clause, region_clause ]
    }
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

    response_body = {
        'application/json': {
            'body': {
                'answer': answer
            }
        }
    }

    return {
        'messageVersion': '1.0',
        'response': {
            'actionGroup': event['actionGroup'],
            'apiPath': event['apiPath'],
            'httpMethod': event['httpMethod'],
            'httpStatusCode': 200,
            'responseBody': response_body
        }
    }

